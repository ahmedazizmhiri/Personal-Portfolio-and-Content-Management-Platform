import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  insert: vi.fn(),
  deliver: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/firebase/config", () => ({
  isFirebaseAdminConfigured: () => true,
}));

vi.mock("@/lib/security/http", () => ({
  assertSameOrigin: () => undefined,
  clientIp: () => "192.0.2.10",
  userAgent: () => "Test Browser",
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    Response.json({ ok: true, ...data }, { status }),
  jsonError: (error: string, status = 400, code?: string) =>
    Response.json({ ok: false, error, code }, { status }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: async () => ({
    allowed: true,
    available: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
  }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock("@/lib/security/captcha", () => ({
  verifyCaptcha: async () => ({ ok: true, code: "verified" }),
}));

vi.mock("@/lib/contact-delivery", () => ({
  deliverContactNotification: state.deliver,
}));

vi.mock("@/lib/security/admin-auth", () => ({
  writeAdminAudit: state.audit,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    from: () => ({
      insert: state.insert,
    }),
  }),
}));

describe("contact persistence and delivery semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RATE_LIMIT_HMAC_SECRET = "x".repeat(32);
    process.env.PRIVACY_HMAC_SECRET = "p".repeat(32);
    state.insert.mockReturnValue({
      select: () => ({
        single: async () => ({
          data: {
            id: "9af96923-e220-4f62-8f71-d74c101930ea",
            name: "Analyst",
            email: "analyst@example.com",
            message: "I would like to discuss a commercial analytics project.",
          },
          error: null,
        }),
      }),
    });
    state.deliver.mockResolvedValue({
      delivered: false,
      code: "provider_unavailable",
    });
  });

  it("returns 202 with exactly one persisted row when email delivery fails", async () => {
    const { POST } = await import("@/app/api/contact/route");
    const response = await POST(new Request("https://portfolio.test/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portfolio.test",
      },
      body: JSON.stringify({
        name: "Analyst",
        email: "analyst@example.com",
        message: "I would like to discuss a commercial analytics project.",
        company: "",
        captchaToken: "verified-token",
        submissionId: "6d27fedb-f0a2-48a2-8ed0-47d6307c82dd",
      }),
    }));

    expect(response.status).toBe(202);
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({
      ip_hash: createHmac("sha256", "p".repeat(32))
        .update("192.0.2.10")
        .digest("hex"),
      user_agent_hash: createHmac("sha256", "p".repeat(32))
        .update("Test Browser")
        .digest("hex"),
    }));
    expect(state.deliver).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      message: "Message received. Thank you.",
    });
  });

  it("fails closed instead of reusing the rate-limit secret", async () => {
    process.env.PRIVACY_HMAC_SECRET = "";
    process.env.RATE_LIMIT_HMAC_SECRET = "r".repeat(64);
    const { POST } = await import("@/app/api/contact/route");
    const response = await POST(new Request("https://portfolio.test/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://portfolio.test",
      },
      body: JSON.stringify({
        name: "Analyst",
        email: "analyst@example.com",
        message: "I would like to discuss a commercial analytics project.",
        company: "",
        captchaToken: "verified-token",
        submissionId: "9b300c77-6cc0-45d6-8ff2-e423fd4e92d4",
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "privacy_configuration_unavailable",
    });
    expect(state.insert).not.toHaveBeenCalled();
  });
});
