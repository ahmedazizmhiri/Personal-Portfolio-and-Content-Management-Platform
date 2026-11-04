import { describe, expect, it } from "vitest";

import {
  cmsUploadReferences,
  getUploadDeletionPhase,
  parsePublicStorageReference,
  uploadDeletionGraceMs,
  uploadReferenceCandidates,
} from "@/lib/security/upload-lifecycle";

describe("upload deletion lifecycle", () => {
  const now = Date.parse("2026-07-27T12:00:00.000Z");
  const requestedAt = new Date(now - uploadDeletionGraceMs).toISOString();

  it("always schedules an active upload without removing Storage", () => {
    expect(getUploadDeletionPhase({
      status: "active",
      requestedAt: "2020-01-01T00:00:00.000Z",
      now,
    })).toBe("schedule");
  });

  it("enforces the complete five-minute grace period", () => {
    expect(getUploadDeletionPhase({
      status: "pending",
      requestedAt: new Date(
        now - uploadDeletionGraceMs + 1,
      ).toISOString(),
      now,
    })).toBe("wait");
    expect(getUploadDeletionPhase({
      status: "pending",
      requestedAt,
      now,
    })).toBe("reconcile");
  });

  it("reconciles a failed row only after its existing grace period", () => {
    expect(getUploadDeletionPhase({
      status: "failed",
      requestedAt,
      now,
    })).toBe("reconcile");
    expect(getUploadDeletionPhase({
      status: "failed",
      requestedAt: null,
      now,
    })).toBe("schedule");
  });

  it("collects only the asset fields controlled by a CMS table", () => {
    expect(cmsUploadReferences("projects", {
      cover_image_url: " /projects/cover.webp ",
      card_image_url: "/projects/cover.webp",
      open_graph_image: "",
      demo_url: "https://example.com/not-an-asset",
    })).toEqual(["/projects/cover.webp"]);
    expect(cmsUploadReferences("skills", {
      icon_key: "/storage/v1/object/public/public-assets/icon.webp",
    })).toEqual([]);
  });

  it("recognizes configured Storage-shaped URLs but leaves legacy paths alone", () => {
    expect(parsePublicStorageReference(
      "https://project.firebase.co/storage/v1/object/public/project-images/admin%20id/asset.webp",
    )).toEqual({
      bucket: "project-images",
      path: "admin id/asset.webp",
    });
    expect(parsePublicStorageReference(
      "/storage/v1/object/public/public-assets/user/avatar.png",
    )).toEqual({
      bucket: "public-assets",
      path: "user/avatar.png",
    });
    expect(parsePublicStorageReference("/projects/legacy-cover.webp")).toBeNull();
    expect(parsePublicStorageReference("https://legacy.example/asset.webp"))
      .toBeNull();
  });

  it("builds the exact reference forms used by reconciliation", () => {
    expect(uploadReferenceCandidates({
      bucket: "project-images",
      path: "admin/asset.webp",
      publicUrl:
        "https://project.firebase.co/storage/v1/object/public/project-images/admin/asset.webp",
    })).toEqual([
      "admin/asset.webp",
      "https://project.firebase.co/storage/v1/object/public/project-images/admin/asset.webp",
      "/storage/v1/object/public/project-images/admin/asset.webp",
    ]);
  });
});
