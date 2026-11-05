import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assetUrlSchema, contentMutationSchema, builderCompoundMutationSchema } from "@/lib/security/validation";

describe("legacy CMS optimistic-lock timestamps", () => {
  it("accepts historical text as a concurrency token but never an empty token", () => {
    expect(contentMutationSchema.safeParse({
      table: "resumes", values: { label: "CV", variant: "en" },
      expectedUpdatedAt: "2026-11-04 08:00:00",
    }).success).toBe(true);
    expect(contentMutationSchema.safeParse({
      table: "resumes", values: {}, expectedUpdatedAt: "",
    }).success).toBe(false);
  });
  it("accepts a historical timestamp for a builder operation", () => {
    expect(builderCompoundMutationSchema.safeParse({
      action: "duplicate", table: "project_sections",
      id: "9304053f-445d-45a7-bf74-a95a8148c101",
      idempotencyKey: "74e4a348-7b4b-4cc5-ae9a-1d38cf088e40",
      expectedUpdatedAt: "2026-11-04 08:00:00",
    }).success).toBe(true);
  });
});

describe("internal CMS URL validation", () => {
  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      "demo-portfolio.firebasestorage.app",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "/\\evil.example",
    "/%5cevil.example",
    "/%255cevil.example",
    "//evil.example/path",
    "/%2f%2fevil.example",
    "/\u0000control",
  ])("rejects authority-confusing path %s", (value) => {
    expect(assetUrlSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    "/projects/commercial-analytics",
    "/assets/report.webp",
    "https://portfolio.public.blob.vercel-storage.com/resumes/cv.pdf",
    "https://firebasestorage.googleapis.com/v0/b/demo-portfolio.firebasestorage.app/o/public-assets%2Freport.webp?alt=media",
    "",
  ])("accepts safe asset URL %s", (value) => {
    expect(assetUrlSchema.safeParse(value).success).toBe(true);
  });

  it("rejects external asset hosts that the CSP would block", () => {
    expect(assetUrlSchema.safeParse("https://example.com/asset.webp").success).toBe(false);
    expect(assetUrlSchema.safeParse("https://portfolio.public.blob.vercel-storage.com.evil.example.com/image.webp").success).toBe(false);
    expect(assetUrlSchema.safeParse("http://portfolio.public.blob.vercel-storage.com/image.webp").success).toBe(false);
  });
});
