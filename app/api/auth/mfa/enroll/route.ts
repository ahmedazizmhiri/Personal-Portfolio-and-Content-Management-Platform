import type { AuthError } from "@/lib/firebase/types";

import { requireAdminApi, writeAdminAudit } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const enrollmentErrorMessage = (error: AuthError) => {
  switch (error.code) {
    case "mfa_totp_enroll_not_enabled":
      return "Authenticator enrollment is unavailable.";
    case "mfa_factor_name_conflict":
      return "An unfinished authenticator setup already exists. Retry setup now.";
    case "session_not_found":
    case "bad_jwt":
      return "Your session expired. Sign in again before setting up the authenticator.";
    case "over_request_rate_limit":
      return "Too many setup attempts. Wait a few minutes and try again.";
    default:
      return "Could not enroll authenticator. Check the server MFA encryption configuration and retry.";
  }
};

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: false });
  if (!admin.ok) return admin.response;

  const limited = await consumeRateLimit({
    scope: "admin-mfa-enroll",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 6,
    windowMs: 30 * 60 * 1000,
  });
  if (!limited.allowed) {
    return rateLimitResponse(limited);
  }

  const factors = await admin.firebase.auth.mfa.listFactors();
  if (factors.error) return jsonError(enrollmentErrorMessage(factors.error), 400);

  const allFactors = factors.data?.all ?? [];
  const verifiedTotp = allFactors.find((factor) => factor.factor_type === "totp" && factor.status === "verified");
  if (verifiedTotp) {
    const assurance = await admin.firebase.auth.mfa
      .getAuthenticatorAssuranceLevel();
    if (
      assurance.error ||
      assurance.data.currentLevel !== "aal2"
    ) {
      return jsonError(
        "Verify the current authenticator before changing MFA factors.",
        403,
        "fresh_mfa_required",
      );
    }
    return jsonError("An authenticator is already enrolled for this account.", 409);
  }

  const unfinishedTotp = allFactors.filter((factor) => factor.factor_type === "totp" && factor.status === "unverified");
  for (const factor of unfinishedTotp) {
    const removed = await admin.firebase.auth.mfa.unenroll({ factorId: factor.id });
    if (removed.error) {
      await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_stale_factor_cleanup_failed", entityId: factor.id, metadata: { error_code: removed.error.code ?? null }, request });
      return jsonError("An unfinished authenticator setup could not be cleared. Sign out, sign in, and retry.", 409);
    }
  }

  const { data, error } = await admin.firebase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Ahmed Aziz Mhiri Portfolio",
  });

  if (error || !data || data.type !== "totp") {
    if (error) await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_enroll_failed", metadata: { error_code: error.code ?? null }, request });
    return jsonError(error ? enrollmentErrorMessage(error) : "Could not enroll authenticator.", 400);
  }

  await writeAdminAudit({ actorUserId: admin.user.id, action: "mfa_factor_enrolled", entityId: data.id, request });
  return jsonOk({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
}
