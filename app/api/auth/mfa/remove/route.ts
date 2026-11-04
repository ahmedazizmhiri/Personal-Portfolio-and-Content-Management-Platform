import { NextResponse } from "next/server";

import {
  clearRememberDeviceCookie,
  requireAdminApi,
  revokeAllRememberedDevices,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonHeaders } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { mfaRemoveSchema } from "@/lib/security/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: false });
  if (!admin.ok) return admin.response;

  const limited = await consumeRateLimit({
    scope: "admin-mfa-remove",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 6,
    windowMs: 30 * 60 * 1000,
  });
  if (!limited.allowed) {
    return rateLimitResponse(limited);
  }

  const parsed = mfaRemoveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return jsonError("Invalid MFA request.", 400);
  }

  const mfa = await admin.firebase.auth.mfa.listFactors();
  if (mfa.error) {
    return jsonError(
      "MFA factors could not be verified.",
      500,
      "server_error",
    );
  }
  const factorIsVerified = Boolean(mfa.data?.totp?.some((factor) => factor.id === parsed.data.factorId));

  if (factorIsVerified && !parsed.data.code) {
    return jsonError("Current authenticator code is required to remove MFA.", 400);
  }

  if (factorIsVerified && parsed.data.code) {
    const verified = await admin.firebase.auth.mfa.challengeAndVerify({
      factorId: parsed.data.factorId,
      code: parsed.data.code,
    });

    if (verified.error) {
      await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_verify_failure", entityId: parsed.data.factorId, request });
      return jsonError("Invalid authenticator code.", 401);
    }
  }

  try {
    await revokeAllRememberedDevices(admin.user.id, "mfa_removed");
  } catch {
    return jsonError(
      "Remembered devices could not be revoked before removing MFA.",
      500,
      "server_error",
    );
  }

  const { error } = await admin.firebase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) {
    return jsonError("Could not remove MFA factor.", 500);
  }

  await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_factor_removed", entityId: parsed.data.factorId, request });
  const response = NextResponse.json(
    { ok: true, message: "MFA factor removed." },
    { headers: jsonHeaders },
  );
  clearRememberDeviceCookie(response);
  return response;
}
