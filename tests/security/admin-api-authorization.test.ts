import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  admin: true,
  aal: "aal2" as "aal1" | "aal2",
  configured: true,
}));

vi.mock("@/lib/firebase/config", () => ({
  adminDeviceHmacSecret: () => "admin-api-authorization-test-secret",
  adminMfaRememberDays: () => 10,
  getAllowedOrigins: () => ["https://portfolio.test"],
  isFirebaseAdminConfigured: () => state.configured,
  requireAdminDeviceHmacSecret: () =>
    "admin-api-authorization-test-secret",
  requireAdminMfa: () => true,
}));

vi.mock("@/lib/firebase/server", () => ({
  createFirebaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        state.authenticated
          ? {
              data: {
                user: {
                  id: "admin-user",
                  factors: [{
                    id: "factor-id",
                    factor_type: "totp",
                    status: "verified",
                  }],
                },
              },
              error: null,
            }
          : {
              data: { user: null },
              error: { message: "not authenticated" },
            },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: {
            currentLevel: state.aal,
            nextLevel: "aal2",
            currentAuthenticationMethods: [],
          },
          error: null,
        }),
        listFactors: async () => ({
          data: { all: [], phone: [], totp: [], webauthn: [] },
          error: null,
        }),
      },
    },
  }),
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        const query = {
          eq: () => query,
          maybeSingle: async () => {
            if (table === "admins") {
              return {
                data: state.admin ? { user_id: "admin-user" } : null,
                error: null,
              };
            }
            if (table === "admin_security_preferences") {
              return {
                data: {
                  mfa_required: true,
                  remember_device_enabled: false,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
    }),
  }),
}));

const mutationRequest = () => {
  const token = "a".repeat(43);
  return new Request("https://portfolio.test/api/admin/content", {
    method: "POST",
    headers: {
      cookie: `aam_csrf=${token}`,
      "x-csrf-token": token,
      origin: "https://portfolio.test",
      "sec-fetch-site": "same-origin",
    },
  });
};

describe("admin API authorization and MFA enforcement", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.admin = true;
    state.aal = "aal2";
    state.configured = true;
  });

  it("fails closed when admin authentication is unavailable", async () => {
    state.configured = false;
    const { requireAdminApi } = await import("@/lib/security/admin-auth");

    const result = await requireAdminApi(mutationRequest(), {
      requireMfa: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      expect(result.response.headers.get("cache-control")).toContain("no-store");
      await expect(result.response.json()).resolves.toMatchObject({
        code: "auth_unavailable",
      });
    }
  });

  it("rejects an unauthenticated mutation", async () => {
    state.authenticated = false;
    const { requireAdminApi } = await import("@/lib/security/admin-auth");

    const result = await requireAdminApi(mutationRequest(), {
      requireMfa: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toMatchObject({
        code: "not_authenticated",
      });
    }
  });

  it("rejects an authenticated user without admin membership", async () => {
    state.admin = false;
    const { requireAdminApi } = await import("@/lib/security/admin-auth");

    const result = await requireAdminApi(mutationRequest(), {
      requireMfa: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        code: "not_admin",
      });
    }
  });

  it("rejects an admin whose current session has not reached AAL2", async () => {
    state.aal = "aal1";
    const { requireAdminApi } = await import("@/lib/security/admin-auth");

    const result = await requireAdminApi(mutationRequest(), {
      requireMfa: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        code: "mfa_required",
      });
    }
  });

  it("authorizes an admin only after the session reaches AAL2", async () => {
    const { requireAdminApi } = await import("@/lib/security/admin-auth");

    await expect(
      requireAdminApi(mutationRequest(), { requireMfa: true }),
    ).resolves.toMatchObject({
      ok: true,
      user: { id: "admin-user" },
      mfaRequired: true,
      mfaSatisfied: true,
    });
  });
});
