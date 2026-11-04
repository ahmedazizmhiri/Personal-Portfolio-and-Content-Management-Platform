import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DeviceRow = {
  id: string;
  user_id: string;
  token_hash: string;
  device_context_hash: string | null;
  network_context_hash: string | null;
  last_user_agent_hash: string | null;
  last_network_context_hash: string | null;
  expires_at: string;
  created_at?: string;
  revoked_at: string | null;
  revocation_reason?: string | null;
  last_used_at?: string;
};

const state = vi.hoisted(() => ({
  row: null as DeviceRow | null,
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  createdDevices: [] as Record<string, unknown>[],
  updateError: false,
}));

const matches = (
  row: DeviceRow,
  filters: Array<["eq" | "is" | "gt", string, unknown]>,
) => filters.every(([operator, key, value]) => {
  const actual = row[key as keyof DeviceRow];
  if (operator === "eq") return actual === value;
  if (operator === "is") return actual === value;
  return typeof actual === "string"
    && typeof value === "string"
    && actual > value;
});

vi.mock("@/lib/firebase/config", () => ({
  adminDeviceHmacSecret: () => "remembered-device-test-secret-material",
  adminMfaRememberDays: () => 10,
  isFirebaseAdminConfigured: () => true,
  requireAdminDeviceHmacSecret: () =>
    "remembered-device-test-secret-material",
  requireAdminMfa: () => true,
}));

vi.mock("@/lib/firebase/server", () => ({
  createFirebaseServerClient: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: async (values: Record<string, unknown>) => {
            state.audits.push(values);
            return { error: null };
          },
        };
      }

      if (table === "admin_security_preferences") {
        return {
          select: () => {
            const query = {
              eq: () => query,
              maybeSingle: async () => ({
                data: {
                  mfa_required: true,
                  remember_device_enabled: true,
                },
                error: null,
              }),
            };
            return query;
          },
        };
      }

      return {
        select: () => {
          const filters: Array<["eq" | "is" | "gt", string, unknown]> = [];
          const query = {
            eq: (key: string, value: unknown) => {
              filters.push(["eq", key, value]);
              return query;
            },
            is: (key: string, value: unknown) => {
              filters.push(["is", key, value]);
              return query;
            },
            gt: (key: string, value: unknown) => {
              filters.push(["gt", key, value]);
              return query;
            },
            maybeSingle: async () => ({
              data:
                state.row && matches(state.row, filters)
                  ? { ...state.row }
                  : null,
              error: null,
            }),
          };
          return query;
        },
        update: (values: Record<string, unknown>) => {
          const filters: Array<["eq" | "is" | "gt", string, unknown]> = [];
          const query = {
            eq: (key: string, value: unknown) => {
              filters.push(["eq", key, value]);
              return query;
            },
            then: (
              resolve: (result: { error: { code: string } | null }) => unknown,
            ) => {
              if (state.row && matches(state.row, filters)) {
                state.updates.push(values);
                Object.assign(state.row, values);
              }
              return Promise.resolve({
                error: state.updateError ? { code: "test_error" } : null,
              }).then(resolve);
            },
          };
          return query;
        },
        insert: (values: Record<string, unknown>) => {
          state.createdDevices.push(values);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "created-device-id" },
                error: null,
              }),
            }),
          };
        },
      };
    },
  }),
}));

const secret = "remembered-device-test-secret-material";
const hmac = (label: "user-agent" | "network", value: string) =>
  createHmac("sha256", secret)
    .update(`${label}\0${value}`)
    .digest("hex");

const requestFor = (
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
  ip = "192.0.2.10",
) => new Request("https://portfolio.test/admin", {
  headers: {
    "User-Agent": userAgent,
    "X-Forwarded-For": ip,
  },
});

describe("remembered-device verification behavior", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.updates.length = 0;
    state.audits.length = 0;
    state.createdDevices.length = 0;
    state.updateError = false;
    const { sha256Hex } = await import("@/lib/security/crypto");
    state.row = {
      id: "4da50a23-81bb-47db-a89f-13d51c7da7f3",
      user_id: "admin-user",
      token_hash: sha256Hex("valid-token"),
      device_context_hash: hmac(
        "user-agent",
        "chrome:windows:desktop",
      ),
      network_context_hash: hmac("network", "192.0.2.10"),
      last_user_agent_hash: hmac(
        "user-agent",
        "chrome:windows:desktop",
      ),
      last_network_context_hash: hmac("network", "192.0.2.10"),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
      revocation_reason: null,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the default 10-day expiration in the database", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-28T12:00:00.000Z");
    vi.setSystemTime(now);
    const { createRememberedDevice } = await import(
      "@/lib/security/admin-auth"
    );

    const created = await createRememberedDevice(
      "admin-user",
      requestFor(),
    );
    const expectedExpiry = new Date(
      now.getTime() + 10 * 24 * 60 * 60 * 1000,
    );

    expect(state.createdDevices).toHaveLength(1);
    expect(state.createdDevices[0]).toMatchObject({
      user_id: "admin-user",
      expires_at: expectedExpiry.toISOString(),
    });
    expect(created?.expiresAt).toEqual(expectedExpiry);
  });

  it("accepts a valid token and records device usage", async () => {
    const { validateRememberedDeviceToken } = await import(
      "@/lib/security/admin-auth"
    );

    await expect(
      validateRememberedDeviceToken(
        "admin-user",
        "valid-token",
        requestFor(),
      ),
    ).resolves.toBe(true);
    expect(state.updates.at(-1)).toMatchObject({
      last_user_agent_hash: hmac(
        "user-agent",
        "chrome:windows:desktop",
      ),
    });
  });

  it.each([
    ["before password reset", "2026-11-04T10:00:00.000Z", false],
    ["during password reset", "2026-11-04T12:00:00.900Z", false],
    ["after password reset", "2026-11-04T12:00:01.000Z", true],
    ["with a missing creation date", undefined, false],
  ])("checks remembered devices %s against the Firebase auth epoch", async (_label, createdAt, accepted) => {
    if (state.row) state.row.created_at = createdAt;
    const { validateRememberedDeviceToken } = await import("@/lib/security/admin-auth");
    await expect(validateRememberedDeviceToken(
      "admin-user", "valid-token", requestFor(), "2026-11-04T12:00:00.000Z",
    )).resolves.toBe(accepted);
    expect(state.updates).toHaveLength(accepted ? 1 : 0);
  });

  it.each([
    ["stolen token", () => "stolen-token"],
    ["expired token", () => {
      if (state.row) {
        state.row.expires_at = new Date(Date.now() - 60_000).toISOString();
      }
      return "valid-token";
    }],
    ["revoked token", () => {
      if (state.row) state.row.revoked_at = new Date().toISOString();
      return "valid-token";
    }],
  ])("rejects a %s", async (_label, arrange) => {
    const { validateRememberedDeviceToken } = await import(
      "@/lib/security/admin-auth"
    );

    await expect(
      validateRememberedDeviceToken(
        "admin-user",
        arrange(),
        requestFor(),
      ),
    ).resolves.toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it.each([
    [null, "legacy_context_missing"],
    [hmac("user-agent", "firefox:linux:desktop"), "context_mismatch"],
  ])(
    "revokes a missing or mismatched device context",
    async (contextHash, reason) => {
      if (state.row) state.row.device_context_hash = contextHash;
      const { validateRememberedDeviceToken } = await import(
        "@/lib/security/admin-auth"
      );

      await expect(
        validateRememberedDeviceToken(
          "admin-user",
          "valid-token",
          requestFor(),
        ),
      ).resolves.toBe(false);
      expect(state.row).toMatchObject({
        revocation_reason: reason,
      });
      expect(state.audits).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "remembered_device_context_mismatch",
        }),
      ]));
    },
  );

  it("treats a changed network as an audit signal without exact-IP binding", async () => {
    const { validateRememberedDeviceToken } = await import(
      "@/lib/security/admin-auth"
    );

    await expect(
      validateRememberedDeviceToken(
        "admin-user",
        "valid-token",
        requestFor(undefined, "198.51.100.25"),
      ),
    ).resolves.toBe(true);
    expect(state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "remembered_device_network_changed",
      }),
    ]));
  });
});
