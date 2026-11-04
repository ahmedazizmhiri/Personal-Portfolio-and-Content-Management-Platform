import { afterEach, describe, expect, it, vi } from "vitest";
import { vercelGoogleAuth } from "@/lib/firebase/vercel-credentials";

afterEach(() => vi.unstubAllEnvs());

describe("Vercel Firebase workload identity boundaries", () => {
  it.each(["preview", "development", ""]) ("refuses credentials in the %s environment", (environment) => {
    vi.stubEnv("FIREBASE_USE_VERCEL_OIDC", "true");
    vi.stubEnv("VERCEL_ENV", environment);
    expect(() => vercelGoogleAuth()).toThrow("restricted to Vercel production");
  });

  it("rejects incomplete production configuration before token exchange", () => {
    vi.stubEnv("FIREBASE_USE_VERCEL_OIDC", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GCP_PROJECT_NUMBER", "");
    expect(() => vercelGoogleAuth()).toThrow("configuration is missing or invalid");
  });
});
