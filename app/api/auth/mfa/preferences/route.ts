import { NextResponse } from "next/server";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured, requireAdminMfa } from "@/lib/firebase/config";
import {
  clearRememberDeviceCookie,
  getMfaContext,
  requireAdminApi,
  revokeAllRememberedDevices,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonHeaders } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { mfaPreferenceSchema } from "@/lib/security/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: false });
  if (!admin.ok) return admin.response;

  const limited = await consumeRateLimit({
    scope: "admin-mfa-preferences",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 12,
    windowMs: 30 * 60 * 1000,
  });
  if (!limited.allowed) {
    return rateLimitResponse(limited);
  }

  if (!isFirebaseAdminConfigured()) {
    return jsonError("Firebase Admin SDK is not configured.", 503);
  }

  const parsed = mfaPreferenceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return jsonError("Invalid security preferences.", 400);
  }

  const current = await getMfaContext(admin.firebase, admin.user.id, request);
  if (current.mfaRequired && !parsed.data.mfaRequired && !current.mfaSatisfied) {
    return jsonError("Verify MFA before disabling MFA requirement.", 403);
  }
  const sensitiveChange =
    (current.mfaRequired && !parsed.data.mfaRequired) ||
    (
      !current.rememberDeviceEnabled &&
      parsed.data.rememberDeviceEnabled
    );
  if (
    sensitiveChange &&
    current.verifiedFactors.length > 0 &&
    !current.freshMfaSatisfied
  ) {
    return jsonError(
      "Fresh MFA verification is required.",
      403,
      "fresh_mfa_required",
    );
  }

  if (
    current.rememberDeviceEnabled &&
    !parsed.data.rememberDeviceEnabled
  ) {
    try {
      await revokeAllRememberedDevices(
        admin.user.id,
        "remember_disabled",
      );
    } catch {
      return jsonError(
        "Remembered devices could not be revoked.",
        500,
        "server_error",
      );
    }
  }

  const firebase = createFirebaseAdminClient();
  const { error } = await firebase.from("admin_security_preferences").upsert({
    user_id: admin.user.id,
    mfa_required: requireAdminMfa() ? true : parsed.data.mfaRequired,
    remember_device_enabled: parsed.data.rememberDeviceEnabled,
  });

  if (error) {
    return jsonError("Could not save security preferences.", 500);
  }

  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: parsed.data.mfaRequired ? "mfa_enabled" : "mfa_disabled",
    request,
  });

  const response = NextResponse.json(
    { ok: true, message: "Security preferences saved." },
    { headers: jsonHeaders },
  );
  if (!parsed.data.rememberDeviceEnabled) {
    clearRememberDeviceCookie(response);
  }
  return response;
}
