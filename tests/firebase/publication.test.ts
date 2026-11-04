import { describe, expect, it } from "vitest";
import { publicRowAllowed, type Row } from "@/lib/firebase/database";
import { parseFirebaseAsset } from "@/lib/firebase/assets";

describe("Firebase publication and asset boundaries", () => {
  it("hides visible children of an unpublished ancestor", async () => {
    const data: Record<string, Row[]> = {
      projects: [{ id: "draft", published: false, status: "draft", deletion_status: "active" }],
      project_sections: [{ id: "section", project_id: "draft", is_visible: true, is_archived: false }],
    };
    const read = async (table: string) => data[table] ?? [];
    expect(await publicRowAllowed("project_sections", data.project_sections[0], read)).toBe(false);
    expect(await publicRowAllowed("project_section_items", { project_section_id: "section", is_visible: true }, read)).toBe(false);
    expect(await publicRowAllowed("project_media", { project_id: "draft", is_visible: true }, read)).toBe(false);
    expect(await publicRowAllowed("contact_messages", { published: true }, read)).toBe(false);
    data.projects[0] = { ...data.projects[0], status: "published", published: true };
    expect(await publicRowAllowed("project_sections", data.project_sections[0], read)).toBe(true);
  });
  it("accepts only public prefixes in the configured bucket", () => {
    const bucket = "portfolio-cb36f.firebasestorage.app";
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/project-images%2Fcover.png?alt=media`;
    expect(parseFirebaseAsset(url, bucket)).toEqual({ bucket: "project-images", path: "cover.png" });
    expect(parseFirebaseAsset(url, "another-project.firebasestorage.app")).toBeNull();
    expect(parseFirebaseAsset(url.replace("project-images", "uploads"), bucket)).toBeNull();
    expect(parseFirebaseAsset(url.replace("cover.png", "..%2Fprivate.txt"), bucket)).toBeNull();
  });
});
