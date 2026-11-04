import { z } from "zod";

import { requireAdminApi, writeAdminAudit } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  id: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError(
      "CMS server configuration is incomplete.",
      500,
      "server_error",
    );
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(
      "Invalid private upload request.",
      400,
      "validation_error",
    );
  }

  const limited = await consumeRateLimit({
    scope: "admin_private_upload_access",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 30,
    windowMs: 10 * 60 * 1_000,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const firebase = createFirebaseAdminClient();
  const upload = await firebase
    .from("uploads")
    .select("id,bucket,path,deletion_status")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (upload.error) {
    return jsonError(
      "Could not load the private upload.",
      500,
      "server_error",
    );
  }
  if (
    !upload.data
    || upload.data.bucket !== "uploads"
    || upload.data.deletion_status !== "active"
    || typeof upload.data.path !== "string"
  ) {
    return jsonError(
      "Private upload not found.",
      404,
      "not_found",
    );
  }

  const expiresIn = 60;
  const signed = await firebase.storage
    .from("uploads")
    .createSignedUrl(upload.data.path, expiresIn);
  if (signed.error || !signed.data?.signedUrl) {
    return jsonError(
      "Could not create a private download link.",
      500,
      "server_error",
    );
  }

  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: "private_upload_accessed",
    entityType: "uploads",
    entityId: upload.data.id,
    metadata: { expiresIn },
    request,
  });

  return jsonOk({ url: signed.data.signedUrl, expiresIn });
}
