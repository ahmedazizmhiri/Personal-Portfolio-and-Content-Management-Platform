import { z } from "zod";

import { requireAdminApi } from "@/lib/security/admin-auth";
import { jsonError, jsonOk } from "@/lib/security/http";
import {
  editableCmsTables,
} from "@/lib/security/validation";
import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  table: z.enum(editableCmsTables),
  id: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function GET(request: Request) {
  const admin = await requireAdminApi(request, {
    requireMfa: true,
    sameOrigin: false,
  });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError(
      "CMS server configuration is incomplete.",
      500,
      "server_error",
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    table: url.searchParams.get("table"),
    id: url.searchParams.get("id"),
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError("Invalid revision query.", 400, "validation_error");
  }

  const firebase = createFirebaseAdminClient();
  const { data, error } = await firebase
    .from("cms_content_revisions")
    .select(
      "id,actor_user_id,table_name,record_id,operation,changed_fields,previous_values,next_values,created_at",
    )
    .eq("table_name", parsed.data.table)
    .eq("record_id", parsed.data.id)
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);
  if (error) {
    return jsonError(
      "Could not load revision history.",
      error.code === "42P01" ? 503 : 500,
      error.code === "42P01" ? "migration_required" : "server_error",
    );
  }

  return jsonOk({ revisions: data ?? [] });
}
