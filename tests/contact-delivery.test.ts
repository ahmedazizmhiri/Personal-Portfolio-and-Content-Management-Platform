import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existing: {
    data: {
      delivery_attempts: 2,
      delivery_status: "failed",
      last_delivery_attempt_at: "2026-07-27T12:00:00.000Z",
    },
    error: null as null | { code: string },
  },
  claim: {
    data: { id: "message-id" } as { id: string } | null,
    error: null as null | { code: string },
  },
  final: {
    data: { id: "message-id" } as { id: string } | null,
    error: null as null | { code: string },
  },
  updates: [] as Array<{
    values: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }>,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          maybeSingle: async () => state.existing,
        };
        return query;
      },
      update: (values: Record<string, unknown>) => {
        const entry = {
          values,
          filters: [] as Array<[string, unknown]>,
        };
        state.updates.push(entry);
        const query = {
          eq: (key: string, value: unknown) => {
            entry.filters.push([key, value]);
            return query;
          },
          is: (key: string, value: unknown) => {
            entry.filters.push([key, value]);
            return query;
          },
          select: () => query,
          maybeSingle: async () =>
            values.delivery_status === "sending"
              ? state.claim
              : state.final,
        };
        return query;
      },
    }),
  }),
}));

const message = {
  id: "94dd4dc4-cc82-4e11-8ba6-c1b6cde95046",
  name: "Portfolio visitor",
  email: "visitor@example.com",
  message: "I would like to discuss a commercial analytics project.",
};

describe("contact notification delivery claim", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.existing = {
      data: {
        delivery_attempts: 2,
        delivery_status: "failed",
        last_delivery_attempt_at: "2026-07-27T12:00:00.000Z",
      },
      error: null,
    };
    state.claim = { data: { id: "message-id" }, error: null };
    state.final = { data: { id: "message-id" }, error: null };
    state.updates.length = 0;
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("CONTACT_NOTIFICATION_TO", "owner@example.com");
    vi.stubEnv(
      "CONTACT_NOTIFICATION_FROM",
      "Portfolio <portfolio@example.com>",
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not call the provider when another worker wins the CAS claim", async () => {
    state.claim = { data: null, error: null };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);

    const { deliverContactNotification } = await import(
      "@/lib/contact-delivery"
    );
    const result = await deliverContactNotification(message);

    expect(result).toEqual({
      delivered: false,
      code: "delivery_claim_conflict",
    });
    expect(provider).not.toHaveBeenCalled();
    expect(state.updates[0]?.filters).toEqual(expect.arrayContaining([
      ["delivery_attempts", 2],
      ["delivery_status", "failed"],
    ]));
  });

  it("records a successful provider response only for the claimed attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const { deliverContactNotification } = await import(
      "@/lib/contact-delivery"
    );
    const result = await deliverContactNotification(message);

    expect(result).toEqual({ delivered: true, code: "sent" });
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1]?.filters).toEqual(expect.arrayContaining([
      ["delivery_attempts", 3],
      ["delivery_status", "sending"],
    ]));
    expect(state.updates[1]?.values).toMatchObject({
      delivery_status: "sent",
      delivery_attempts: 3,
      provider_message_id: "provider-message-id",
    });
  });

  it("does not take over a fresh in-progress claim", async () => {
    vi.setSystemTime(new Date("2026-07-27T12:04:59.000Z"));
    state.existing = {
      data: {
        delivery_attempts: 2,
        delivery_status: "sending",
        last_delivery_attempt_at: "2026-07-27T12:00:00.000Z",
      },
      error: null,
    };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);

    const { deliverContactNotification } = await import(
      "@/lib/contact-delivery"
    );
    const result = await deliverContactNotification(message);

    expect(result).toEqual({
      delivered: false,
      code: "delivery_in_progress",
    });
    expect(state.updates).toHaveLength(0);
    expect(provider).not.toHaveBeenCalled();
  });

  it("atomically reclaims a stale in-progress claim", async () => {
    vi.setSystemTime(new Date("2026-07-27T12:05:00.000Z"));
    state.existing = {
      data: {
        delivery_attempts: 2,
        delivery_status: "sending",
        last_delivery_attempt_at: "2026-07-27T12:00:00.000Z",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const { deliverContactNotification } = await import(
      "@/lib/contact-delivery"
    );
    const result = await deliverContactNotification(message);

    expect(result).toEqual({ delivered: true, code: "sent" });
    expect(state.updates[0]?.filters).toEqual(expect.arrayContaining([
      ["delivery_attempts", 2],
      ["delivery_status", "sending"],
      ["last_delivery_attempt_at", "2026-07-27T12:00:00.000Z"],
    ]));
    expect(state.updates[0]?.values).toMatchObject({
      delivery_status: "sending",
      delivery_attempts: 3,
      last_delivery_attempt_at: "2026-07-27T12:05:00.000Z",
    });
  });
});
