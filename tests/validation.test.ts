import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assetUrlSchema } from "@/lib/security/validation";

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
    "https://firebasestorage.googleapis.com/v0/b/demo-portfolio.firebasestorage.app/o/public-assets%2Freport.webp?alt=media",
    "",
  ])("accepts safe asset URL %s", (value) => {
    expect(assetUrlSchema.safeParse(value).success).toBe(true);
  });

  it("rejects external asset hosts that the CSP would block", () => {
    expect(
      assetUrlSchema.safeParse("https://example.com/asset.webp").success,
    ).toBe(false);
  });
});
