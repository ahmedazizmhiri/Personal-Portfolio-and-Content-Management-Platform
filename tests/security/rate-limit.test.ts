import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  rpcData: null as unknown,
  rpcError: null as null | { code: string },
  rpc: vi.fn(),
}));

vi.mock("@/lib/firebase/config", () => ({
  isFirebaseAdminConfigured: () => state.configured,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    rpc: state.rpc,
  }),
}));

describe("durable rate limiting", () => {
  beforeEach(() => {
    state.configured = true;
    state.rpcData = null;
    state.rpcError = null;
    vi.clearAllMocks();
    state.rpc.mockImplementation(async () => ({
      data: state.rpcData,
      error: state.rpcError,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a bounded development fallback and blocks after the limit", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");
    const options = {
      scope: "isolated_dev_limit",
      identifiers: ["unique-test-user"],
      limit: 2,
      windowMs: 60_000,
    };

    await expect(consumeRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      available: true,
      remaining: 1,
    });
    await expect(consumeRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      available: true,
      remaining: 0,
    });
    await expect(consumeRateLimit(options)).resolves.toMatchObject({
      allowed: false,
      available: true,
      remaining: 0,
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("fails closed in production when durable protection is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "r".repeat(32));
    state.configured = false;
    const { consumeRateLimit, rateLimitResponse } = await import(
      "@/lib/security/rate-limit"
    );

    const result = await consumeRateLimit({
      scope: "admin_content_save",
      identifiers: ["admin-user", "192.0.2.10"],
      limit: 80,
      windowMs: 600_000,
    });
    const response = rateLimitResponse(result);

    expect(result).toMatchObject({
      allowed: false,
      available: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({
      code: "rate_limit_unavailable",
    });
  });

  it("sends only a keyed identifier hash to the database RPC", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const secret = "durable-rate-limit-secret-value-123";
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", secret);
    const resetAt = new Date(Date.now() + 90_000).toISOString();
    state.rpcData = [{
      allowed: true,
      remaining: 7,
      reset_at: resetAt,
    }];
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");

    const result = await consumeRateLimit({
      scope: " Admin_Content_Save ",
      identifiers: ["ADMIN-USER", "192.0.2.10"],
      limit: 80,
      windowMs: 600_000,
    });

    const expectedHash = createHmac("sha256", secret)
      .update("admin-user\u0000192.0.2.10")
      .digest("hex");
    expect(state.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_scope: "admin_content_save",
      p_key_hash: expectedHash,
      p_limit: 80,
      p_window_seconds: 600,
    });
    expect(JSON.stringify(state.rpc.mock.calls)).not.toContain("ADMIN-USER");
    expect(result).toMatchObject({
      allowed: true,
      available: true,
      remaining: 7,
    });
  });

  it("turns malformed or failed RPC output into a closed limiter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "r".repeat(32));
    state.rpcData = [{ allowed: "yes", remaining: "many" }];
    const { consumeRateLimit } = await import("@/lib/security/rate-limit");

    await expect(consumeRateLimit({
      scope: "admin_content_delete",
      identifiers: ["admin-user"],
      limit: 20,
      windowMs: 600_000,
    })).resolves.toMatchObject({
      allowed: false,
      available: false,
    });
  });
});
