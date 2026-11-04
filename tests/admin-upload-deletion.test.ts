import { beforeEach, describe, expect, it, vi } from "vitest";

type UploadRow = {
  id: string;
  bucket: "project-images";
  path: string;
  public_url: string;
  deletion_status: "active" | "pending" | "failed";
  deletion_requested_at: string | null;
  deletion_error_code: string | null;
  created_at: string;
};

const state = vi.hoisted(() => ({
  row: null as UploadRow | null,
  referencedTable: null as string | null,
  storageRemove: vi.fn(),
  writeAdminAudit: vi.fn(),
}));

vi.mock("@/lib/security/admin-auth", () => ({
  requireAdminApi: async () => ({
    ok: true,
    user: { id: "admin-user" },
  }),
  writeAdminAudit: state.writeAdminAudit,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: async () => ({
    allowed: true,
    available: true,
    remaining: 9,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
  }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock("@/lib/firebase/config", () => ({
  isFirebaseAdminConfigured: () => true,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== "uploads") {
        const referenceQuery = {
          in: () => referenceQuery,
          limit: async () => ({
            data: state.referencedTable === table ? [{ id: "reference" }] : [],
            error: null,
          }),
        };
        return {
          select: () => referenceQuery,
        };
      }

      const selectQuery = {
        eq: () => selectQuery,
        maybeSingle: async () => ({
          data: state.row ? { ...state.row } : null,
          error: null,
        }),
      };
      const mutation = (
        kind: "update" | "delete",
        values?: Partial<UploadRow>,
      ) => {
        const filters: Array<{
          kind: "eq" | "is";
          column: keyof UploadRow;
          value: unknown;
        }> = [];
        const query = {
          eq: (column: keyof UploadRow, value: unknown) => {
            filters.push({ kind: "eq", column, value });
            return query;
          },
          is: (column: keyof UploadRow, value: unknown) => {
            filters.push({ kind: "is", column, value });
            return query;
          },
          select: () => query,
          maybeSingle: async () => {
            if (
              !state.row
              || !filters.every((filter) =>
                state.row?.[filter.column] === filter.value)
            ) {
              return { data: null, error: null };
            }
            if (kind === "update") {
              state.row = { ...state.row, ...values };
              return { data: { ...state.row }, error: null };
            }
            const deleted = { id: state.row.id };
            state.row = null;
            return { data: deleted, error: null };
          },
        };
        return query;
      };

      return {
        select: () => selectQuery,
        update: (values: Partial<UploadRow>) => mutation("update", values),
        delete: () => mutation("delete"),
      };
    },
    storage: {
      from: () => ({
        remove: state.storageRemove,
      }),
    },
  }),
}));

const id = "87f06b62-2e8c-4a1e-b0ee-330f59676520";
const publicUrl =
  "https://project.firebase.co/storage/v1/object/public/project-images/admin/asset.webp";

const uploadRow = (
  status: UploadRow["deletion_status"],
  requestedAt: string | null,
): UploadRow => ({
  id,
  bucket: "project-images",
  path: "admin/asset.webp",
  public_url: publicUrl,
  deletion_status: status,
  deletion_requested_at: requestedAt,
  deletion_error_code: null,
  created_at: "2026-07-27T10:00:00.000Z",
});

const request = () => new Request(
  "https://portfolio.test/api/admin/upload",
  {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  },
);

describe("two-phase admin upload deletion", () => {
  beforeEach(() => {
    state.row = uploadRow("active", null);
    state.referencedTable = null;
    state.storageRemove.mockReset();
    state.storageRemove.mockResolvedValue({ data: [], error: null });
    state.writeAdminAudit.mockReset();
  });

  it("marks an active row pending and never removes Storage on phase one", async () => {
    const { DELETE } = await import("@/app/api/admin/upload/route");

    const response = await DELETE(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      phase: "pending",
      upload: { deletion_status: "pending" },
    });
    expect(state.row?.deletion_status).toBe("pending");
    expect(state.storageRemove).not.toHaveBeenCalled();
  });

  it("refuses reconciliation before the full grace period", async () => {
    state.row = uploadRow("pending", new Date(Date.now() - 299_000).toISOString());
    const { DELETE } = await import("@/app/api/admin/upload/route");

    const response = await DELETE(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "deletion_in_progress",
    });
    expect(state.storageRemove).not.toHaveBeenCalled();
  });

  it("restores a referenced pending upload without changing Storage", async () => {
    state.row = uploadRow("pending", new Date(Date.now() - 301_000).toISOString());
    state.referencedTable = "projects";
    const { DELETE } = await import("@/app/api/admin/upload/route");

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      phase: "restored",
      upload: { deletion_status: "active" },
    });
    expect(state.row?.deletion_status).toBe("active");
    expect(state.row?.deletion_requested_at).toBeNull();
    expect(state.storageRemove).not.toHaveBeenCalled();
  });

  it("removes Storage only after a stale row is claimed and rechecked", async () => {
    state.row = uploadRow("pending", new Date(Date.now() - 301_000).toISOString());
    const { DELETE } = await import("@/app/api/admin/upload/route");

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      phase: "deleted",
      id,
    });
    expect(state.storageRemove).toHaveBeenCalledWith(["admin/asset.webp"]);
    expect(state.row).toBeNull();
  });
});
