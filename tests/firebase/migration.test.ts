import { describe, expect, it } from "vitest";
import { documentKey, rewriteStorageReferences } from "../../scripts/firebase/shared.mjs";

describe("Supabase to Firebase snapshot conversion", () => {
  it("keeps compound relationship identities stable and collision-free", () => {
    expect(documentKey("project_uploads", { project_id: "a", upload_id: "b", usage: "cover" })).toBe(documentKey("project_uploads", { project_id: "a", upload_id: "b", usage: "cover" }));
    expect(documentKey("project_uploads", { project_id: "a", upload_id: "b", usage: "cover" })).not.toBe(documentKey("project_uploads", { project_id: "a", upload_id: "b", usage: "card" }));
    expect(() => documentKey("projects", { id: "../bad" })).toThrow();
    expect(documentKey("site_profile", { id: 1 })).toBe("1");
  });
  it("rewrites nested storage URLs while preserving built-in assets", () => {
    const converted = rewriteStorageReferences({ image: "https://source.supabase.co/storage/v1/object/public/project-images/folder/my%20image.png", nested: ["/cv/EN.pdf", { public_url: "https://source.supabase.co/storage/v1/object/public/resumes/FR.pdf" }] }, "https://source.supabase.co", "target.firebasestorage.app");
    expect(converted.image).toBe("https://firebasestorage.googleapis.com/v0/b/target.firebasestorage.app/o/project-images%2Ffolder%2Fmy%20image.png?alt=media");
    expect(converted.nested[0]).toBe("/cv/EN.pdf");
    expect(JSON.stringify(converted)).not.toContain("source.supabase.co");
  });
});
