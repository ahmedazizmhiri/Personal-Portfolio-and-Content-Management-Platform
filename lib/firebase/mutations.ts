import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { firestore } from "./core";
import { collectionNames, defaultsFor, loadCollection, rowKey, type Row, type DataResult } from "./database";
import { getProjectCompleteness } from "@/lib/content-completeness";
import { cmsUploadReferences, parsePublicStorageReference } from "@/lib/security/upload-lifecycle";
import { isEditableCmsTable } from "@/lib/security/validation";

export type ContentState = Record<string, Row[]>;
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const stamp = (previous?: Row) => new Date(Math.max(Date.now(), Date.parse(previous?.updated_at ?? "") + 1 || 0)).toISOString();
const contentCollections = collectionNames.filter((name) => !["contact_messages", "admin_audit_logs", "admin_remembered_devices", "admin_security_preferences", "cms_content_revisions"].includes(name));
const parentRelations: Record<string, [string, string]> = {
  project_sections: ["projects", "project_id"], project_links: ["projects", "project_id"],
  project_media: ["projects", "project_id"], page_sections: ["pages", "page_id"],
  page_section_items: ["page_sections", "page_section_id"], project_section_items: ["project_sections", "project_section_id"],
};

const find = (state: ContentState, table: string, id: unknown) => state[table]?.find((row) => row.id === id);
const lock = (row: Row | undefined, expected: unknown) => {
  if (!row) fail("CMS03", "cms_content_not_found");
  if (!expected) fail("CMS01", "cms_optimistic_lock_required");
  if (Date.parse(row!.updated_at) !== Date.parse(String(expected))) fail("CMS02", "cms_edit_conflict");
  return row!;
};
const replace = (state: ContentState, table: string, next: Row) => {
  state[table] = (state[table] ?? []).filter((row) => rowKey(table, row) !== rowKey(table, next));
  state[table].push(next);
};
const remove = (state: ContentState, table: string, id: unknown) => { state[table] = (state[table] ?? []).filter((row) => row.id !== id); };

const syncProjectUploads = (state: ContentState) => {
  const managedUsages = new Set(["card", "cover", "open_graph", "gallery", "document", "video"]);
  const previous = state.project_uploads ?? [];
  const next = previous.filter((relation) => !managedUsages.has(relation.usage));
  const associate = (projectId: string, usage: string, url: unknown) => {
    if (typeof url !== "string" || !url) return;
    const upload = (state.uploads ?? []).find((row) => row.public_url === url);
    if (!upload) return;
    if (next.some((row) => row.project_id === projectId && row.upload_id === upload.id && row.usage === usage)) return;
    next.push(previous.find((row) => row.project_id === projectId && row.upload_id === upload.id && row.usage === usage) ?? { project_id: projectId, upload_id: upload.id, usage, ownership: "owned", created_at: stamp() });
  };
  for (const project of state.projects ?? []) {
    // Preserve inventory while a staged deletion is being reconciled.
    if (project.deletion_status !== "active") {
      for (const relation of previous.filter((row) => row.project_id === project.id && managedUsages.has(row.usage))) next.push(relation);
      continue;
    }
    for (const [usage, field] of [["card", "card_image_url"], ["cover", "cover_image_url"], ["open_graph", "open_graph_image"]]) associate(project.id, usage, project[field]);
    for (const media of (state.project_media ?? []).filter((row) => row.project_id === project.id)) associate(project.id, media.media_type === "image" ? "gallery" : media.media_type, media.media_url);
  }
  state.project_uploads = next.map((relation) => ({ ...relation, ownership: new Set(next.filter((other) => other.upload_id === relation.upload_id).map((other) => other.project_id)).size > 1 ? "shared" : "owned" }));
};

export const validateContentState = (state: ContentState) => {
  for (const [table, [parent, field]] of Object.entries(parentRelations)) {
    for (const row of state[table] ?? []) if (!find(state, parent, row[field])) fail("23503", "cms_parent_missing");
  }
  for (const media of state.project_media ?? []) {
    if (media.project_section_id && find(state, "project_sections", media.project_section_id)?.project_id !== media.project_id) fail("23503", "cms_media_section_scope");
  }
  for (const [table, key] of [["projects", "slug"], ["pages", "slug"], ["pages", "page_key"], ["social_links", "slug"], ["project_section_definitions", "section_key"]]) {
    const seen = new Set<string>();
    for (const row of state[table] ?? []) {
      if (!row[key]) continue;
      if (seen.has(row[key])) fail("23505", "cms_unique_key_conflict");
      seen.add(row[key]);
    }
  }
  for (const project of state.projects ?? []) {
    if (project.published !== (project.status === "published")) fail("CMS05", "cms_project_publication_state_mismatch");
    if ((state.project_slug_history ?? []).some((history) => history.old_slug === project.slug)) fail("23505", "cms_slug_reserved");
    if (project.published) {
      if (project.deletion_status !== "active") fail("CMS05", "cms_project_deletion_in_progress");
      const sections = (state.project_sections ?? []).filter((section) => section.project_id === project.id).map((section) => ({
        ...section,
        items: (state.project_section_items ?? []).filter((item) => item.project_section_id === section.id && item.is_visible),
        media: section.section_type === "media_gallery" ? (state.project_media ?? []).filter((media) => media.project_section_id === section.id && media.is_visible) : [],
      }));
      if (!getProjectCompleteness(project, sections).publishable) fail("CMS05", "cms_project_incomplete");
    }
  }
  for (const field of ["home_featured_order", "projects_page_order"]) {
    const seen = new Set<number>();
    for (const project of state.projects ?? []) {
      if (!project.published || project[field] == null || (field === "home_featured_order" && !project.featured)) continue;
      if (seen.has(project[field])) fail("23505", "cms_public_order_conflict");
      seen.add(project[field]);
    }
  }
  const publicPageIds = new Set((state.pages ?? []).filter((row) => row.is_published).map((row) => row.id));
  const publicSections = new Set((state.page_sections ?? []).filter((row) => publicPageIds.has(row.page_id) && row.is_visible && !row.is_archived).map((row) => row.id));
  const publicPaths = new Set((state.projects ?? []).filter((row) => row.published && row.deletion_status === "active").map((row) => `/projects/${row.slug}`));
  for (const history of state.project_slug_history ?? []) {
    const target = find(state, "projects", history.project_id);
    if (target?.published && target.deletion_status === "active") publicPaths.add(`/projects/${history.old_slug}`);
  }
  const checkLink = (url: unknown) => {
    if (typeof url === "string" && /^\/projects\/[^/?#]+/.test(url) && !publicPaths.has(url.split(/[?#]/)[0].replace(/\/$/, ""))) fail("CMS06", "cms_public_project_link_conflict");
  };
  for (const row of state.page_sections ?? []) if (publicSections.has(row.id)) { checkLink(row.cta_href); checkLink(row.secondary_cta_href); }
  for (const row of state.page_section_items ?? []) if (publicSections.has(row.page_section_id) && row.is_visible) checkLink(row.link_url);
  for (const table of Object.keys(state)) {
    if (!isEditableCmsTable(table)) continue;
    for (const row of state[table]) for (const reference of cmsUploadReferences(table, row)) {
      const parsed = parsePublicStorageReference(reference);
      const upload = (state.uploads ?? []).find((item) => item.public_url === reference || (parsed && item.bucket === parsed.bucket && item.path === parsed.path));
      if (upload && upload.deletion_status !== "active") fail("CMS07", "cms_upload_unavailable");
    }
  }
};

// Apply mutations to a transaction-local state. Firestore receives only changed
// documents after every invariant passes, with revisions in the same commit.
export const applyContentMutation = (state: ContentState, name: string, args: Row): Row => {
  const actor = args.p_actor_user_id;
  if (!(state.admins ?? []).some((row) => row.user_id === actor)) fail("CMS01", "cms_invalid_actor");
  state.cms_content_revisions ??= [];
  const revise = (table: string, operation: string, previous: Row | null, next: Row | null) => {
    const id = randomUUID(), requestId = randomUUID();
    state.cms_content_revisions.push({ id, request_id: requestId, actor_user_id: actor, table_name: table, record_id: String(next?.id ?? previous?.id), operation, changed_fields: Object.keys({ ...previous, ...next }).filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key])), previous_values: previous, next_values: next, created_at: stamp() });
    return { revisionRecorded: true, revisionId: id, requestId };
  };
  const mutate = (table: string, operation: string, id: unknown, expected: unknown, values: Row = {}) => {
    if (!isEditableCmsTable(table)) fail("CMS07", "cms_invalid_table");
    const previous = operation === "create" ? null : lock(find(state, table, id), expected);
    if (previous && parentRelations[table]) {
      const [, field] = parentRelations[table];
      if (field in values && values[field] !== previous[field]) fail("CMS04", "cms_parent_change_unsupported");
    }
    const candidate = { ...previous, ...values };
    const parentProjectId = ["project_sections", "project_media"].includes(table) ? candidate.project_id
      : table === "project_section_items" ? find(state, "project_sections", candidate.project_section_id)?.project_id : null;
    if (parentProjectId && find(state, "projects", parentProjectId)?.deletion_status !== "active") fail("CMS01", "cms_project_deletion_in_progress");
    if (table === "projects" && previous && previous.deletion_status !== "active") fail("CMS01", "cms_project_deletion_in_progress");
    if (table === "projects" && previous && values.slug && values.slug !== previous.slug) fail("CMS07", "cms_use_slug_rename");
    if (operation === "delete") {
      if (table === "projects") fail("CMS07", "cms_use_staged_project_delete");
      if (table === "project_sections") {
        state.project_section_items = (state.project_section_items ?? []).filter((row) => row.project_section_id !== id);
        state.project_media = (state.project_media ?? []).map((row) => row.project_section_id === id ? { ...row, project_section_id: null, updated_at: stamp(row) } : row);
      }
      if (table === "page_sections") state.page_section_items = (state.page_section_items ?? []).filter((row) => row.page_section_id !== id);
      if (table === "pages") {
        const sectionIds = new Set((state.page_sections ?? []).filter((row) => row.page_id === id).map((row) => row.id));
        state.page_sections = (state.page_sections ?? []).filter((row) => row.page_id !== id);
        state.page_section_items = (state.page_section_items ?? []).filter((row) => !sectionIds.has(row.page_section_id));
      }
      remove(state, table, id);
      return { row: null, operation, ...revise(table, operation, previous, null) };
    }
    let row: Row = { ...defaultsFor(table), ...previous, ...values, id: previous?.id ?? randomUUID(), updated_at: stamp(previous ?? undefined) };
    if (operation === "archive") {
      if (["page_sections", "project_sections"].includes(table)) row = { ...row, is_visible: false, is_archived: true };
      else if (["page_section_items", "project_section_items", "project_media"].includes(table)) row.is_visible = false;
      else if (table === "pages") row.is_published = false;
      else row = { ...row, published: false, ...(table === "projects" ? { status: "archived", archived_at: stamp(), featured: false, home_featured_order: null, projects_page_order: null } : {}) };
    }
    if (table === "projects" && row.status === "archived") row.archived_at ??= stamp();
    replace(state, table, row);
    return { row, operation, ...revise(table, operation, previous, row) };
  };

  let response: Row;
  if (name === "mutate_cms_content") {
    response = mutate(args.p_table, args.p_operation, args.p_record_id, args.p_expected_updated_at, args.p_values);
  } else if (name === "mutate_cms_builder_action") {
    const table = args.p_table;
    if (!["page_sections", "project_sections"].includes(table)) fail("CMS07", "cms_invalid_builder_table");
    const identity = createHash("sha256").update(JSON.stringify([actor, table, args.p_record_id, args.p_expected_updated_at, args.p_action])).digest("hex");
    const previousRequest = (state.cms_builder_action_requests ?? []).find((row) => row.actor_user_id === actor && row.idempotency_key === args.p_idempotency_key);
    if (args.p_action === "duplicate" && previousRequest) {
      if (previousRequest.fingerprint !== identity) fail("CMS08", "cms_idempotency_conflict");
      return { ...previousRequest.response_payload, replayed: true };
    }
    const previous = lock(find(state, table, args.p_record_id), args.p_expected_updated_at);
    const parentField = table === "page_sections" ? "page_id" : "project_id";
    const orderField = table === "page_sections" ? "display_order" : "sort_order";
    const childTable = table === "page_sections" ? "page_section_items" : "project_section_items";
    const childField = table === "page_sections" ? "page_section_id" : "project_section_id";
    const mutations: Row[] = [], children: Row[] = [];
    if (args.p_action === "duplicate") {
      if (!args.p_idempotency_key) fail("CMS07", "cms_idempotency_key_required");
      const siblingOrders = (state[table] ?? []).filter((row) => row[parentField] === previous[parentField]).map((row) => Number(row[orderField]) || 0);
      const parent = mutate(table, "create", null, null, { ...previous, title: `${previous.title} (copy)`, is_visible: false, [orderField]: Math.max(0, ...siblingOrders) + 1 });
      mutations.push(parent);
      for (const child of [...state[childTable] ?? []].filter((row) => row[childField] === previous.id)) {
        const result = mutate(childTable, "create", null, null, { ...child, [childField]: parent.row!.id });
        mutations.push(result); children.push(result.row!);
      }
    } else if (args.p_action === "move") {
      const related = lock(find(state, table, args.p_related_record_id), args.p_related_expected_updated_at);
      if (related.id === previous.id || related[parentField] !== previous[parentField]) fail("CMS04", "cms_invalid_move_parent");
      const siblings = (state[table] ?? []).filter((row) => row[parentField] === previous[parentField] && !row.is_archived).sort((a, b) => a[orderField] - b[orderField] || String(a.id).localeCompare(String(b.id)));
      const index = siblings.findIndex((row) => row.id === previous.id);
      const delta = args.p_direction === "up" ? -1 : args.p_direction === "down" ? 1 : 0;
      if (!delta || siblings[index + delta]?.id !== related.id) fail("CMS02", "cms_move_neighbor_changed");
      const previousOrder = previous[orderField], relatedOrder = related[orderField];
      mutations.push(mutate(table, "update", previous.id, previous.updated_at, { [orderField]: relatedOrder }));
      mutations.push(mutate(table, "update", related.id, related.updated_at, { [orderField]: previousOrder }));
    } else fail("CMS07", "cms_invalid_builder_action");
    response = { action: args.p_action, table, idempotencyKey: args.p_action === "duplicate" ? args.p_idempotency_key : null, replayed: false, rows: mutations.filter((item) => item.row && state[table].some((row) => row.id === item.row.id)).map((item) => item.row), children, childTable: args.p_action === "duplicate" ? childTable : null, revisionRecorded: true, revisionIds: mutations.map((item) => item.revisionId), requestIds: mutations.map((item) => item.requestId) };
    if (args.p_action === "duplicate") (state.cms_builder_action_requests ??= []).push({ id: randomUUID(), actor_user_id: actor, idempotency_key: args.p_idempotency_key, fingerprint: identity, response_payload: response, created_at: stamp() });
  } else if (name === "mutate_project_workspace") {
    const previous = lock(find(state, "projects", args.p_project_id), args.p_expected_updated_at);
    const links: Row[] = (args.p_links as Row[]).map((link) => ({ ...defaultsFor("project_links"), ...link, id: randomUUID(), project_id: previous.id }));
    state.project_links = [...(state.project_links ?? []).filter((row) => row.project_id !== previous.id), ...links];
    const linkUrl = (type: string) => links.find((link) => link.link_type === type && link.is_visible)?.url ?? "";
    const result = mutate("projects", "update", previous.id, args.p_expected_updated_at, { ...args.p_values, github_url: linkUrl("github"), linkedin_url: linkUrl("linkedin"), demo_url: linkUrl("demo"), case_study_url: linkUrl("case_study"), published_at: args.p_values.published ? previous.published_at ?? stamp() : previous.published_at, archived_at: args.p_values.status === "archived" ? previous.archived_at ?? stamp() : null });
    response = { project: result.row, links, revisionRecorded: true, revisionId: result.revisionId, requestId: result.requestId };
  } else if (name === "mutate_project_media") {
    const project = find(state, "projects", args.p_project_id);
    if (!project || project.deletion_status !== "active") fail("CMS03", "cms_project_not_active");
    const previous = args.p_action === "create" ? null : find(state, "project_media", args.p_media_id);
    if (previous && previous.project_id !== args.p_project_id) fail("CMS03", "cms_media_not_found");
    response = mutate("project_media", args.p_action, args.p_media_id, args.p_expected_updated_at, { ...args.p_values, project_id: args.p_project_id });
  } else if (name === "rename_project_slug") {
    const previous = lock(find(state, "projects", args.p_project_id), args.p_expected_updated_at);
    if (previous.deletion_status !== "active") fail("CMS01", "cms_project_deletion_in_progress");
    const slug = String(args.p_new_slug ?? "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 200) fail("CMS07", "cms_invalid_project_slug");
    if (slug === previous.slug) fail("CMS07", "cms_slug_unchanged");
    (state.project_slug_history ??= []).push({ id: randomUUID(), project_id: previous.id, old_slug: previous.slug, created_at: stamp() });
    const next = { ...previous, slug, updated_at: stamp(previous) };
    replace(state, "projects", next);
    response = { project: next, previousSlug: previous.slug, newSlug: slug, slugChanged: true, ...revise("projects", "update", previous, next) };
  } else if (["prepare_project_hard_delete", "mark_project_hard_delete_failed", "finalize_project_hard_delete"].includes(name)) {
    const previous = find(state, "projects", args.p_project_id);
    if (!previous) fail("CMS03", "cms_content_not_found");
    const project = previous!;
    if (project.published || project.status !== "archived") fail("CMS07", "cms_archive_before_delete");
    if (name !== "mark_project_hard_delete_failed" && args.p_confirm_slug !== project.slug) fail("CMS07", "cms_slug_confirmation_mismatch");
    if (name === "finalize_project_hard_delete") {
      if (project.deletion_status !== "pending") fail("CMS07", "cms_project_delete_not_pending");
      const relations = (state.project_uploads ?? []).filter((row) => row.project_id === project.id);
      const affectedUploadIds = relations.map((row) => row.upload_id);
      // The route has completed external cleanup. Refuse finalization while an
      // owned upload still exists, so a failed cleanup remains retryable.
      if (relations.some((relation) => new Set((state.project_uploads ?? []).filter((other) => other.upload_id === relation.upload_id).map((other) => other.project_id)).size === 1 && find(state, "uploads", relation.upload_id))) fail("CMS07", "cms_storage_cleanup_incomplete");
      const sectionIds = new Set((state.project_sections ?? []).filter((row) => row.project_id === project.id).map((row) => row.id));
      for (const table of ["project_sections", "project_links", "project_media", "project_uploads"]) state[table] = (state[table] ?? []).filter((row) => row.project_id !== project.id);
      state.project_uploads = state.project_uploads.map((relation) => ({ ...relation, ownership: new Set(state.project_uploads.filter((other) => other.upload_id === relation.upload_id).map((other) => other.project_id)).size > 1 ? "shared" : "owned" }));
      state.project_section_items = (state.project_section_items ?? []).filter((row) => !sectionIds.has(row.project_section_id));
      state.project_slug_history = (state.project_slug_history ?? []).map((row) => row.project_id === project.id ? { ...row, project_id: null } : row);
      if (!state.project_slug_history.some((row) => row.old_slug === project.slug)) state.project_slug_history.push({ id: randomUUID(), old_slug: project.slug, project_id: null, created_at: stamp() });
      remove(state, "projects", project.id);
      response = { projectId: project.id, deletedSlug: project.slug, phase: "deleted", affectedUploadIds, ...revise("projects", "delete", project, null) };
    } else {
      if (name === "prepare_project_hard_delete") lock(project, args.p_expected_updated_at);
      else if (!["pending", "failed"].includes(project.deletion_status)) fail("CMS07", "cms_project_delete_not_pending");
      const phase = name === "prepare_project_hard_delete" ? "pending" : "failed";
      const next = { ...project, deletion_status: phase, deletion_requested_at: project.deletion_requested_at ?? stamp(), deletion_error_code: phase === "failed" ? String(args.p_error_code ?? "cleanup_failed").slice(0, 120) : null, updated_at: stamp(project) };
      replace(state, "projects", next);
      const uploadIds = new Set((state.project_uploads ?? []).filter((row) => row.project_id === project.id).map((row) => row.upload_id));
      const uploads = [...uploadIds].flatMap((uploadId) => {
        const upload = find(state, "uploads", uploadId);
        if (!upload) return [];
        const count = new Set((state.project_uploads ?? []).filter((row) => row.upload_id === uploadId).map((row) => row.project_id)).size;
        return [{ uploadId, bucket: upload.bucket, path: upload.path, publicUrl: upload.public_url ?? null, mimeType: upload.mime_type ?? null, deletionStatus: upload.deletion_status, projectReferenceCount: count, exclusiveToProject: count === 1 }];
      });
      response = { project: next, phase, uploads, ...revise("projects", "update", project, next) };
    }
  } else fail("CMS07", "Unknown Firebase mutation.");
  syncProjectUploads(state);
  validateContentState(state);
  return response!;
};

export const runMutation = async (name: string, args: Row): Promise<DataResult<Row>> => {
  try {
    if (name === "consume_rate_limit") {
      const key = createHash("sha256").update(`${args.p_scope}\0${args.p_key_hash}`).digest("hex");
      const ref = firestore().collection("rate_limit_buckets").doc(key);
      const result = await firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot.data();
        const now = Date.now();
        const resetAt = previous && previous.reset_at > now ? previous.reset_at : now + args.p_window_seconds * 1000;
        const count = previous && previous.reset_at > now ? Number(previous.count) : 0;
        const allowed = count < args.p_limit;
        transaction.set(ref, { count: allowed ? count + 1 : count, reset_at: resetAt, expires_at: new Date(resetAt) });
        return { allowed, remaining: Math.max(0, args.p_limit - count - (allowed ? 1 : 0)), reset_at: new Date(resetAt).toISOString() };
      });
      return { data: result, error: null };
    }
    const data = await firestore().runTransaction(async (transaction) => {
      const state: ContentState = {};
      // All reads precede writes, as required by Firestore transactions.
      await Promise.all(contentCollections.map(async (table) => { state[table] = await loadCollection(table, transaction); }));
      const before = structuredClone(state);
      const result = applyContentMutation(state, name, args);
      let writes = 0;
      for (const [table, rows] of Object.entries(state)) {
        const prior = new Map((before[table] ?? []).map((row) => [rowKey(table, row), row]));
        for (const row of rows) {
          const key = rowKey(table, row);
          if (JSON.stringify(prior.get(key)) !== JSON.stringify(row)) { transaction.set(firestore().collection(table).doc(key), row); writes++; }
          prior.delete(key);
        }
        for (const key of prior.keys()) { transaction.delete(firestore().collection(table).doc(key)); writes++; }
      }
      if (writes > 400) fail("CMS07", "cms_transaction_too_large");
      return result;
    });
    return { data, error: null };
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    return { data: null, error: { code: candidate.code ?? "firebase_error", message: candidate.message ?? "Firebase transaction failed." } };
  }
};
