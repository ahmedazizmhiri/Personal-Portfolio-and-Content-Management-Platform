import { describe, expect, it } from "vitest";
import { applyContentMutation, type ContentState } from "@/lib/firebase/mutations";

const updatedAt = "2026-11-04T08:00:00.000Z";
const initialState = (): ContentState => ({
  admins: [{ user_id: "admin" }],
  projects: [{ id: "project", title: "Example", slug: "example", summary: "Project evidence", status: "draft", published: false, deletion_status: "active", updated_at: updatedAt, tags: ["Analytics"], type: "Professional" }],
  project_sections: [{ id: "section", project_id: "project", title: "Evidence", body: "Verified findings", bullets: [], is_visible: true, is_archived: false, sort_order: 1, updated_at: updatedAt }],
  project_section_items: [], project_media: [], project_links: [], project_uploads: [], project_slug_history: [],
  pages: [], page_sections: [], page_section_items: [], uploads: [],
});
const change = (state: ContentState, extra: Record<string, unknown>) => applyContentMutation(state, "mutate_cms_content", { p_actor_user_id: "admin", p_table: "projects", p_operation: "update", p_record_id: "project", p_expected_updated_at: updatedAt, p_values: { title: "Changed title" }, ...extra });

describe("Firestore CMS transaction behavior", () => {
  it("records the content and immutable revision together", () => {
    const state = initialState();
    const result = change(state, {});
    expect(state.projects[0].title).toBe("Changed title");
    expect(result.revisionRecorded).toBe(true);
    expect(state.cms_content_revisions).toHaveLength(1);
    expect(state.cms_content_revisions[0]).toMatchObject({ actor_user_id: "admin", previous_values: { title: "Example" }, next_values: { title: "Changed title" } });
  });
  it("saves a legacy timestamp while preserving the historical creation date", () => {
    const state = initialState();
    const legacyUpdated = "2026-11-04 08:00:00";
    const legacyCreated = "2020-06-10 11:15:00";
    state.projects[0].updated_at = legacyUpdated;
    state.projects[0].created_at = legacyCreated;
    const result = change(state, { p_expected_updated_at: legacyUpdated });
    expect(result.row.title).toBe("Changed title");
    expect(state.projects[0].created_at).toBe(legacyCreated);
    expect(state.projects[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isFinite(Date.parse(state.projects[0].updated_at))).toBe(true);
    expect(() => change(state, { p_expected_updated_at: legacyUpdated })).toThrowError("cms_edit_conflict");
  });
  it("compares unparseable legacy timestamps exactly", () => {
    const state = initialState();
    state.projects[0].updated_at = "legacy-source-timestamp";
    expect(() => change(state, { p_expected_updated_at: "other-legacy-timestamp" })).toThrowError("cms_edit_conflict");
    expect(() => change(state, { p_expected_updated_at: "legacy-source-timestamp" })).not.toThrow();
  });
  it("rejects stale edits and unauthorized actors", () => {
    expect(() => change(initialState(), { p_expected_updated_at: "2026-11-03T08:00:00.000Z" })).toThrowError("cms_edit_conflict");
    expect(() => change(initialState(), { p_actor_user_id: "visitor" })).toThrowError("cms_invalid_actor");
  });
  it("preserves the published project evidence boundary", () => {
    const state = initialState();
    state.project_sections[0].body = "";
    expect(() => change(state, { p_values: { published: true, status: "published" } })).toThrowError("cms_project_incomplete");
  });
  it("rejects a public page link when a project is unpublished", () => {
    const state = initialState();
    state.pages.push({ id: "page", is_published: true });
    state.page_sections.push({ id: "public-section", page_id: "page", is_visible: true, is_archived: false, cta_href: "/projects/example" });
    expect(() => change(state, {})).toThrowError("cms_public_project_link_conflict");
  });
  it("reserves old slugs and returns a canonical redirect target", () => {
    const state = initialState();
    const renamed = applyContentMutation(state, "rename_project_slug", { p_actor_user_id: "admin", p_project_id: "project", p_expected_updated_at: updatedAt, p_new_slug: "new-example" });
    expect(renamed).toMatchObject({ previousSlug: "example", newSlug: "new-example", slugChanged: true });
    expect(state.project_slug_history).toContainEqual(expect.objectContaining({ old_slug: "example", project_id: "project" }));
    expect(() => applyContentMutation(state, "rename_project_slug", { p_actor_user_id: "admin", p_project_id: "project", p_expected_updated_at: state.projects[0].updated_at, p_new_slug: "example" })).toThrowError("cms_slug_reserved");
  });
  it("duplicates child items exactly once for an idempotency key", () => {
    const state = initialState();
    state.project_section_items.push({ id: "item", project_section_id: "section", value: "Result", is_visible: true });
    const args = { p_actor_user_id: "admin", p_table: "project_sections", p_action: "duplicate", p_record_id: "section", p_expected_updated_at: updatedAt, p_idempotency_key: "request-one" };
    const first = applyContentMutation(state, "mutate_cms_builder_action", args);
    const second = applyContentMutation(state, "mutate_cms_builder_action", args);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].is_visible).toBe(false);
    expect(first.children).toHaveLength(1);
    expect(second.replayed).toBe(true);
    expect(state.project_sections).toHaveLength(2);
    expect(state.project_section_items).toHaveLength(2);
    expect(() => applyContentMutation(state, "mutate_cms_builder_action", { ...args, p_record_id: first.rows[0].id })).toThrowError("cms_idempotency_conflict");
  });
  it("stages deletion with a typed upload inventory and retains retry state", () => {
    const state = initialState();
    state.projects[0].status = "archived";
    state.uploads.push({ id: "upload", bucket: "project-images", path: "cover.png", deletion_status: "active" });
    state.project_uploads.push({ project_id: "project", upload_id: "upload", usage: "cover", ownership: "owned" });
    const prepared = applyContentMutation(state, "prepare_project_hard_delete", { p_actor_user_id: "admin", p_project_id: "project", p_expected_updated_at: updatedAt, p_confirm_slug: "example" });
    expect(prepared.uploads).toEqual([expect.objectContaining({ uploadId: "upload", exclusiveToProject: true, projectReferenceCount: 1 })]);
    expect(() => applyContentMutation(state, "finalize_project_hard_delete", { p_actor_user_id: "admin", p_project_id: "project", p_confirm_slug: "example" })).toThrowError("cms_storage_cleanup_incomplete");
    state.uploads = [];
    const finalized = applyContentMutation(state, "finalize_project_hard_delete", { p_actor_user_id: "admin", p_project_id: "project", p_confirm_slug: "example" });
    expect(finalized.phase).toBe("deleted");
    expect(state.projects).toHaveLength(0);
    expect(state.project_sections).toHaveLength(0);
    expect(state.project_slug_history).toContainEqual(expect.objectContaining({ old_slug: "example", project_id: null }));
  });
});
