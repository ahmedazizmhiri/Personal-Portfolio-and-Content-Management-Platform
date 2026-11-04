import { NextResponse } from "next/server";

import {
  createRememberedDevice,
  setRememberDeviceCookie,
  requireAdminApi,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonHeaders } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { mfaVerifySchema } from "@/lib/security/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: false });
  if (!admin.ok) return admin.response;

  const limited = await consumeRateLimit({
    scope: "admin-mfa-verify",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.allowed) {
    return rateLimitResponse(
      limited,
      "Too many authenticator attempts. Please try again later.",
    );
  }

  const parsed = mfaVerifySchema.safeParse(await request.json());
  if (!parsed.success) {
    return jsonError("Invalid authenticator code.", 400);
  }

  const { data, error } = await admin.firebase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });

  if (error || !data) {
    await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_verify_failure", entityId: parsed.data.factorId, request });
    return jsonError("Invalid authenticator code.", 401);
  }

  const response = NextResponse.json(
    { ok: true, redirectTo: "/admin" },
    { headers: jsonHeaders },
  );

  if (parsed.data.rememberDevice) {
    try {
      const remembered = await createRememberedDevice(admin.user.id, request);
      if (remembered) {
        setRememberDeviceCookie(response, remembered.token, remembered.expiresAt);
        await writeAdminAudit({ actorUserId: admin.user.id, action: "remembered_device_created", request });
      }
    } catch {
      return jsonError(
        "The authenticator was verified, but this device could not be remembered.",
        500,
        "server_error",
      );
    }
  }

  await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_verify_success", entityId: parsed.data.factorId, request });
  return response;
}
