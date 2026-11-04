import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";
import { getMfaContext, requireAdminApi } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdminApi(request);
  if (!admin.ok) return admin.response;

  const limited = await consumeRateLimit({
    scope: "admin-mfa-status",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 60,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.allowed) {
    return rateLimitResponse(limited);
  }

  const mfa = await getMfaContext(
    admin.firebase,
    admin.user.id,
    request,
    admin.user,
  );
  let devices: unknown[] = [];

  if (isFirebaseAdminConfigured()) {
    const firebase = createFirebaseAdminClient();
    const { data, error } = await firebase
      .from("admin_remembered_devices")
      .select(
        "id, created_at, last_used_at, expires_at, revoked_at, rotated_at, rotation_counter, revocation_reason",
      )
      .eq("user_id", admin.user.id)
      .order("created_at", { ascending: false });
    if (error) {
      return jsonError(
        "Remembered devices could not be loaded.",
        500,
        "server_error",
      );
    }
    devices = data ?? [];
  }

  return jsonOk({
    email: admin.user.email,
    aal: mfa.aal,
    factors: mfa.factors,
    mfaRequired: mfa.mfaRequired,
    mfaSatisfied: mfa.mfaSatisfied,
    rememberDeviceEnabled: mfa.rememberDeviceEnabled,
    remembered: mfa.remembered,
    devices,
  });
}
