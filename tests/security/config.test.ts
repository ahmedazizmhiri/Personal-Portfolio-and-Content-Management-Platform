import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("remembered-device lifetime", () => {
  it("defaults to 10 days", async () => {
    vi.stubEnv("ADMIN_MFA_REMEMBER_DAYS", "");
    const { adminMfaRememberDays } = await import("../../lib/firebase/config");
    expect(adminMfaRememberDays()).toBe(10);
  });

  it("falls back to 10 days for invalid values", async () => {
    vi.stubEnv("ADMIN_MFA_REMEMBER_DAYS", "not-a-number");
    const { adminMfaRememberDays } = await import("../../lib/firebase/config");
    expect(adminMfaRememberDays()).toBe(10);
  });

  it("clamps values below the lower bound to 1 day", async () => {
    vi.stubEnv("ADMIN_MFA_REMEMBER_DAYS", "0");
    const { adminMfaRememberDays } = await import("../../lib/firebase/config");
    expect(adminMfaRememberDays()).toBe(1);
  });

  it("clamps values above the upper bound to 30 days", async () => {
    vi.stubEnv("ADMIN_MFA_REMEMBER_DAYS", "365");
    const { adminMfaRememberDays } = await import("../../lib/firebase/config");
    expect(adminMfaRememberDays()).toBe(30);
  });

  it("uses a configured in-range value", async () => {
    vi.stubEnv("ADMIN_MFA_REMEMBER_DAYS", "12");
    const { adminMfaRememberDays } = await import("../../lib/firebase/config");
    expect(adminMfaRememberDays()).toBe(12);
  });
});

describe("admin security HMAC configuration", () => {
  const clearHmacSecrets = () => {
    vi.stubEnv("ADMIN_DEVICE_HMAC_SECRET", "");
    vi.stubEnv("PRIVACY_HMAC_SECRET", "");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "");
    vi.stubEnv("FIREBASE_MFA_ENCRYPTION_KEY", "");
  };

  it.each([
    "RATE_LIMIT_HMAC_SECRET",
    "PRIVACY_HMAC_SECRET",
    "FIREBASE_PRIVATE_KEY",
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "FIREBASE_MFA_ENCRYPTION_KEY",
  ])("does not reuse %s", async (environmentVariable) => {
    clearHmacSecrets();
    vi.stubEnv(environmentVariable, "f".repeat(64));
    const { adminDeviceHmacSecret } = await import(
      "../../lib/firebase/config"
    );

    expect(adminDeviceHmacSecret()).toBe("");
  });

  it("accepts a valid independent admin HMAC secret", async () => {
    clearHmacSecrets();
    const secret = "independent-admin-security-hmac-secret";
    vi.stubEnv("ADMIN_DEVICE_HMAC_SECRET", secret);
    const {
      adminDeviceHmacSecret,
      requireAdminDeviceHmacSecret,
    } = await import("../../lib/firebase/config");

    expect(adminDeviceHmacSecret()).toBe(secret);
    expect(requireAdminDeviceHmacSecret()).toBe(secret);
  });

  it("rejects fewer than 32 meaningful bytes", async () => {
    clearHmacSecrets();
    vi.stubEnv(
      "ADMIN_DEVICE_HMAC_SECRET",
      `${"s".repeat(16)} ${"s".repeat(15)}`,
    );
    const { adminDeviceHmacSecret } = await import(
      "../../lib/firebase/config"
    );

    expect(adminDeviceHmacSecret()).toBe("");
  });

  it.each(["", "short-admin-secret"])(
    "fails closed in production for missing or invalid configuration",
    async (secret) => {
      clearHmacSecrets();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ADMIN_DEVICE_HMAC_SECRET", secret);
      const { requireAdminDeviceHmacSecret } = await import(
        "../../lib/firebase/config"
      );

      expect(() => requireAdminDeviceHmacSecret()).toThrow(
        "Admin security HMAC configuration is missing or invalid.",
      );
    },
  );
});
