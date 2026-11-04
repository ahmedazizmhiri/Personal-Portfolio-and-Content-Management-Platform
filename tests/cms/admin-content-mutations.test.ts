import { beforeEach, describe, expect, it, vi } from "vitest";

type AdminResult =
  | {
      ok: true;
      user: { id: string };
    }
  | {
      ok: false;
      response: Response;
    };

const state = vi.hoisted(() => ({
  adminResult: {
    ok: true,
    user: { id: "admin-user" },
  } as AdminResult,
  existing: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  revisionResult: { ok: true, code: null as string | null },
  revisions: [] as Record<string, unknown>[],
  updateFilters: [] as Array<[string, unknown]>,
  historyFilters: [] as Array<[string, unknown]>,
  historyOrder: null as null | {
    column: string;
    options: Record<string, unknown>;
  },
  historyLimit: null as number | null,
  unavailableUploads: [] as Record<string, unknown>[],
  uploadFilters: [] as Array<[string, unknown]>,
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  rpcResult: {
    data: null as unknown,
    error: null as null | { code?: string; message?: string },
  },
  databaseCalls: 0,
  requireAdminApi: vi.fn(),
  consumeRateLimit: vi.fn(),
  writeCmsRevision: vi.fn(),
  writeAdminAudit: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: state.revalidatePath,
  revalidateTag: state.revalidateTag,
}));

vi.mock("@/lib/security/admin-auth", () => ({
  requireAdminApi: state.requireAdminApi,
  writeAdminAudit: state.writeAdminAudit,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: state.consumeRateLimit,
  rateLimitResponse: () =>
    Response.json(
      { ok: false, code: "rate_limited" },
      { status: 429 },
    ),
}));

vi.mock("@/lib/cms-revisions", () => ({
  writeCmsRevision: state.writeCmsRevision,
}));

vi.mock("@/lib/cms", () => ({
  getAdminContentSnapshot: async () => ({}),
}));

vi.mock("@/lib/firebase/config", () => ({
  isFirebaseAdminConfigured: () => true,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => {
    state.databaseCalls += 1;
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push([name, args]);
        return state.rpcResult;
      },
      from: (table: string) => ({
        select: (columns: string) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              if (table === "cms_content_revisions") {
                state.historyFilters.push([column, value]);
              }
              return query;
            },
            in: (column: string, value: unknown) => {
              filters.push([column, value]);
              if (table === "uploads") {
                state.uploadFilters.push([column, value]);
              }
              return query;
            },
            order: (
              column: string,
              options: Record<string, unknown>,
            ) => {
              state.historyOrder = { column, options };
              return query;
            },
            limit: async (limit: number) => {
              if (table === "uploads") {
                return { data: state.unavailableUploads, error: null };
              }
              if (
                table === "cms_content_revisions"
                && columns !== "id"
              ) {
                state.historyLimit = limit;
                return { data: state.revisions, error: null };
              }
              return { data: [], error: null };
            },
            maybeSingle: async () => ({
              data: state.existing,
              error: null,
            }),
          };
          return query;
        },
        update: () => {
          const query = {
            eq: (column: string, value: unknown) => {
              state.updateFilters.push([column, value]);
              return query;
            },
            select: () => query,
            maybeSingle: async () => ({
              data: state.updated,
              error: null,
            }),
          };
          return query;
        },
      }),
    };
  },
}));

const id = "0d2e84ea-3b4e-4d19-969f-27269be950b9";
const expectedUpdatedAt = "2026-07-27T10:00:00.000Z";
const idempotencyKey = "6d2e84ea-3b4e-4d19-969f-27269be950b9";

const saveRequest = (includeExpectedTimestamp = true) =>
  new Request("https://portfolio.test/api/admin/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      table: "profile",
      values: {
        id,
        full_name: "Updated portfolio owner",
        published: true,
      },
      ...(includeExpectedTimestamp
        ? { expectedUpdatedAt }
        : {}),
    }),
  });

describe("versioned CMS content mutations", () => {
  beforeEach(() => {
    state.adminResult = {
      ok: true,
      user: { id: "admin-user" },
    };
    state.existing = {
      id,
      full_name: "Original portfolio owner",
      published: true,
      updated_at: expectedUpdatedAt,
    };
    state.updated = {
      id,
      full_name: "Updated portfolio owner",
      published: true,
      updated_at: "2026-07-27T10:01:00.000Z",
    };
    state.revisionResult = { ok: true, code: null };
    state.revisions = [];
    state.updateFilters.length = 0;
    state.historyFilters.length = 0;
    state.historyOrder = null;
    state.historyLimit = null;
    state.unavailableUploads = [];
    state.uploadFilters.length = 0;
    state.rpcCalls.length = 0;
    state.rpcResult = {
      data: {
        row: state.updated,
        operation: "update",
        revisionRecorded: true,
        revisionId: "revision-id",
        requestId: "request-id",
      },
      error: null,
    };
    state.databaseCalls = 0;
    vi.clearAllMocks();
    state.requireAdminApi.mockImplementation(async () => state.adminResult);
    state.consumeRateLimit.mockResolvedValue({
      allowed: true,
      available: true,
      remaining: 79,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    });
    state.writeCmsRevision.mockImplementation(
      async () => state.revisionResult,
    );
  });

  it("requires admin MFA before any mutation-side database access", async () => {
    state.adminResult = {
      ok: false,
      response: Response.json(
        { ok: false, code: "mfa_required" },
        { status: 403 },
      ),
    };
    const { POST } = await import("@/app/api/admin/content/route");

    const response = await POST(saveRequest());

    expect(response.status).toBe(403);
    expect(state.requireAdminApi).toHaveBeenCalledWith(
      expect.any(Request),
      { requireMfa: true },
    );
    expect(state.databaseCalls).toBe(0);
    expect(state.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("requires an explicit expected timestamp before updating a row", async () => {
    const { POST } = await import("@/app/api/admin/content/route");

    const response = await POST(saveRequest(false));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "optimistic_lock_required",
    });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("maps an atomic compare-and-swap conflict without recording a false audit", async () => {
    state.rpcResult = {
      data: null,
      error: {
        code: "CMS02",
        message: "cms_edit_conflict",
      },
    };
    const { POST } = await import("@/app/api/admin/content/route");

    const response = await POST(saveRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "edit_conflict",
    });
    expect(state.rpcCalls).toEqual([
      [
        "mutate_cms_content",
        expect.objectContaining({
          p_operation: "update",
          p_record_id: id,
          p_expected_updated_at: expectedUpdatedAt,
          p_actor_user_id: "admin-user",
        }),
      ],
    ]);
    expect(state.writeAdminAudit).not.toHaveBeenCalled();
  });

  it("audits only after the atomic mutation returns revision evidence", async () => {
    const { POST } = await import("@/app/api/admin/content/route");

    const response = await POST(saveRequest());

    expect(response.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      [
        "mutate_cms_content",
        expect.objectContaining({
          p_table: "profile",
          p_operation: "update",
          p_record_id: id,
          p_expected_updated_at: expectedUpdatedAt,
          p_values: expect.objectContaining({
            full_name: "Updated portfolio owner",
          }),
          p_actor_user_id: "admin-user",
        }),
      ],
    ]);
    expect(state.writeAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cms_content_updated",
        entityId: id,
        metadata: {
          revisionRecorded: true,
          revisionId: "revision-id",
          requestId: "request-id",
        },
      }),
    );
    expect(state.revalidatePath).toHaveBeenCalledWith(
      "/projects/[slug]",
      "page",
    );
  });

  it("fails closed when the atomic response lacks revision evidence", async () => {
    state.rpcResult = {
      data: {
        row: state.updated,
        operation: "update",
        revisionRecorded: false,
      },
      error: null,
    };
    const { POST } = await import("@/app/api/admin/content/route");

    const response = await POST(saveRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "server_error",
    });
    expect(state.writeAdminAudit).not.toHaveBeenCalled();
    expect(state.revalidatePath).not.toHaveBeenCalled();
  });

  it("duplicates a builder section through one revision-backed RPC", async () => {
    const copiedId = "1d2e84ea-3b4e-4d19-969f-27269be950b9";
    state.rpcResult = {
      data: {
        action: "duplicate",
        table: "page_sections",
        idempotencyKey,
        replayed: false,
        rows: [{
          id: copiedId,
          page_id: "2d2e84ea-3b4e-4d19-969f-27269be950b9",
          section_key: "overview-copy-a1b2c3d4",
          updated_at: "2026-07-27T10:02:00.000Z",
        }],
        childTable: "page_section_items",
        children: [],
        revisionRecorded: true,
        revisionIds: ["revision-parent"],
        requestIds: ["request-parent"],
      },
      error: null,
    };
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "duplicate",
          table: "page_sections",
          id,
          expectedUpdatedAt,
          idempotencyKey,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(state.rpcCalls).toEqual([[
      "mutate_cms_builder_action",
      {
        p_action: "duplicate",
        p_table: "page_sections",
        p_record_id: id,
        p_expected_updated_at: expectedUpdatedAt,
        p_related_record_id: null,
        p_related_expected_updated_at: null,
        p_direction: null,
        p_actor_user_id: "admin-user",
        p_idempotency_key: idempotencyKey,
      },
    ]]);
    expect(state.writeAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cms_builder_section_duplicated",
        metadata: expect.objectContaining({
          revisionRecorded: true,
          revisionIds: ["revision-parent"],
          idempotencyKey,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ id: copiedId }],
      childTable: "page_section_items",
      children: [],
      replayed: false,
    });
  });

  it("replays a duplicate result without recording a second audit", async () => {
    const copiedId = "1d2e84ea-3b4e-4d19-969f-27269be950b9";
    state.rpcResult = {
      data: {
        action: "duplicate",
        table: "page_sections",
        idempotencyKey,
        replayed: true,
        rows: [{ id: copiedId }],
        childTable: "page_section_items",
        children: [],
        revisionRecorded: true,
        revisionIds: ["revision-parent"],
        requestIds: ["request-parent"],
      },
      error: null,
    };
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "duplicate",
          table: "page_sections",
          id,
          expectedUpdatedAt,
          idempotencyKey,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(state.rpcCalls[0]?.[1]).toMatchObject({
      p_idempotency_key: idempotencyKey,
      p_expected_updated_at: expectedUpdatedAt,
    });
    expect(state.writeAdminAudit).not.toHaveBeenCalled();
    expect(state.revalidatePath).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ id: copiedId }],
      replayed: true,
    });
  });

  it("rejects duplicate requests without a caller idempotency key", async () => {
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "duplicate",
          table: "page_sections",
          id,
          expectedUpdatedAt,
        }),
      },
    ));

    expect(response.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.writeAdminAudit).not.toHaveBeenCalled();
  });

  it("maps an atomic two-row builder move conflict without auditing", async () => {
    const relatedId = "2d2e84ea-3b4e-4d19-969f-27269be950b9";
    state.rpcResult = {
      data: null,
      error: { code: "CMS02", message: "cms_edit_conflict" },
    };
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "move",
          table: "project_sections",
          id,
          expectedUpdatedAt,
          relatedId,
          relatedExpectedUpdatedAt: expectedUpdatedAt,
          direction: "down",
        }),
      },
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "edit_conflict",
    });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.writeAdminAudit).not.toHaveBeenCalled();
    expect(state.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a builder move without both optimistic-lock timestamps", async () => {
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "move",
          table: "page_sections",
          id,
          expectedUpdatedAt,
          relatedId: "2d2e84ea-3b4e-4d19-969f-27269be950b9",
          direction: "up",
        }),
      },
    ));

    expect(response.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects a CMS save that references known non-active upload metadata", async () => {
    state.unavailableUploads = [{ id: "pending-upload" }];
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table: "profile",
          values: {
            id,
            full_name: "Updated portfolio owner",
            avatar_url:
              "/storage/v1/object/public/public-assets/admin/avatar.webp",
            published: true,
          },
          expectedUpdatedAt,
        }),
      },
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "upload_unavailable",
    });
    expect(state.uploadFilters).toEqual(expect.arrayContaining([
      ["deletion_status", ["pending", "failed"]],
    ]));
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("allows a built-in or legacy path with no upload metadata row", async () => {
    state.updated = {
      ...state.updated,
      avatar_url: "/projects/legacy-avatar.webp",
    };
    const { POST } = await import("@/app/api/admin/content/route");
    const response = await POST(new Request(
      "https://portfolio.test/api/admin/content",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table: "profile",
          values: {
            id,
            full_name: "Updated portfolio owner",
            avatar_url: "/projects/legacy-avatar.webp",
            published: true,
          },
          expectedUpdatedAt,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("loads one record's newest revisions with a bounded history query", async () => {
    state.revisions = [{
      id: "revision-1",
      table_name: "profile",
      record_id: id,
      operation: "update",
      created_at: "2026-07-27T10:01:00.000Z",
    }];
    const { GET } = await import("@/app/api/admin/revisions/route");
    const response = await GET(new Request(
      `https://portfolio.test/api/admin/revisions?table=profile&id=${id}&limit=12`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      revisions: state.revisions,
    });
    expect(state.requireAdminApi).toHaveBeenCalledWith(
      expect.any(Request),
      { requireMfa: true, sameOrigin: false },
    );
    expect(state.historyFilters).toEqual([
      ["table_name", "profile"],
      ["record_id", id],
    ]);
    expect(state.historyOrder).toEqual({
      column: "created_at",
      options: { ascending: false },
    });
    expect(state.historyLimit).toBe(12);
  });
});
