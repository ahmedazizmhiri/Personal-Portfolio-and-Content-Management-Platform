import {
  createRememberedDevice,
  getAdminMembership,
  getMfaContext,
  setRememberDeviceCookie,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import { isCsrfTokenValid } from "@/lib/security/csrf";
import { clientIp, isSameOrigin, jsonError, jsonOk } from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { safeRedirect } from "@/lib/security/redirects";
import { loginSchema } from "@/lib/security/validation";
import { createFirebaseServerClient } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonError("Request origin is not allowed.", 403, "origin_not_allowed");
  }
  if (!isCsrfTokenValid(request)) {
    return jsonError("CSRF token is missing or invalid.", 403, "csrf_invalid");
  }

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid email or password.", 400, "invalid_credentials");
    }

    const ip = clientIp(request);
    const emailKey = parsed.data.email.toLowerCase();
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit({
        scope: "admin-login-ip",
        identifiers: [ip],
        limit: 30,
        windowMs: 15 * 60 * 1000,
      }),
      consumeRateLimit({
        scope: "admin-login-account",
        identifiers: [emailKey],
        limit: 8,
        windowMs: 15 * 60 * 1000,
      }),
    ]);
    const limited = !ipLimit.allowed ? ipLimit : accountLimit;
    if (!limited.allowed) {
      return rateLimitResponse(
        limited,
        "Too many login attempts. Please try again later.",
      );
    }

    const firebase = await createFirebaseServerClient();
    const { data, error } = await firebase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { captchaToken: parsed.data.captchaToken },
    });

    if (error || !data.user) {
      await writeAdminAudit({ action: "login_failure", metadata: { reason: "auth_failed" }, request });
      return jsonError("Invalid email or password.", 401, "invalid_credentials");
    }

    const membership = await getAdminMembership(data.user.id);
    if (membership.status !== "admin") {
      await firebase.auth.signOut();
      if (membership.status === "server_error") {
        return jsonError("Admin access could not be verified.", 500, "server_error");
      }
      await writeAdminAudit({ actorUserId: data.user.id, action: "non_admin_rejected", request });
      return jsonError(
        "This account is not authorized for portfolio administration.",
        403,
        "not_admin",
      );
    }

    const mfa = await getMfaContext(firebase, data.user.id, request);
    const next = safeRedirect(parsed.data.next, "/admin");

    if (mfa.mfaRequired && !mfa.mfaSatisfied) {
      await writeAdminAudit({ actorUserId: data.user.id, action: "mfa_challenge_required", request });
      const factor = (mfa.verifiedFactors[0] as { id?: string } | undefined)?.id ?? null;
      return jsonOk({
        mfaRequired: true,
        hasFactor: Boolean(factor),
        factorId: factor,
        redirectTo: factor ? null : "/admin/security?setup=mfa",
        next,
      });
    }

    await writeAdminAudit({ actorUserId: data.user.id, action: "login_success", request });
    const response = jsonOk({ redirectTo: next });

    if (mfa.remembered) {
      const remembered = await createRememberedDevice(data.user.id, request);
      if (remembered) {
        setRememberDeviceCookie(
          response,
          remembered.token,
          remembered.expiresAt,
        );
        await writeAdminAudit({
          actorUserId: data.user.id,
          action: "remembered_device_rotated",
          request,
        });
      }
    }

    return response;
  } catch {
    return jsonError("Login could not be completed.", 500, "server_error");
  }
}
