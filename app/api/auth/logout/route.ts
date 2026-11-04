import { NextResponse } from "next/server";

import {
  clearPasswordRecoveryCookie,
  clearRememberDeviceCookie,
  getAdminAuthState,
  revokeAllRememberedDevices,
  revokeRememberedDeviceFromRequest,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import {
  clearCsrfCookie,
  isCsrfTokenValid,
} from "@/lib/security/csrf";
import {
  clientIp,
  getTrustedRequestOrigin,
  isSameOrigin,
  jsonError,
} from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { safeRedirect } from "@/lib/security/redirects";
import { createFirebaseServerClient } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonError("Request origin is not allowed.", 403, "origin_not_allowed");
  }
  if (!isCsrfTokenValid(request)) {
    return jsonError("CSRF token is missing or invalid.", 403, "csrf_invalid");
  }

  const limited = await consumeRateLimit({
    scope: "admin-logout",
    identifiers: [clientIp(request)],
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.allowed && limited.available) {
    return rateLimitResponse(limited);
  }

  const state = await getAdminAuthState(request);
  const allDevices = new URL(request.url).searchParams.get("all") === "true";
  let revocationFailed = false;

  try {
    if (state.status === "authenticated") {
      if (allDevices) {
        await revokeAllRememberedDevices(state.user.id, "logout_all");
      } else {
        await revokeRememberedDeviceFromRequest(
          state.user.id,
          request,
          "current_logout",
        );
      }

      await writeAdminAudit({
        actorUserId: state.user.id,
        action: allDevices ? "logout_all" : "logout",
        request,
      });
    }
  } catch {
    revocationFailed = true;
  }

  const firebase = await createFirebaseServerClient();
  const { error: signOutError } = await firebase.auth.signOut({
    scope: allDevices || revocationFailed ? "global" : "local",
  });

  if (signOutError || revocationFailed) {
    const response = jsonError(
      revocationFailed
        ? "You were signed out, but remembered-device revocation could not be completed."
        : "Logout could not be completed.",
      500,
      "server_error",
    );
    clearRememberDeviceCookie(response);
    clearPasswordRecoveryCookie(response);
    clearCsrfCookie(response);
    return response;
  }

  const url = new URL(request.url);

  const next = safeRedirect(
    url.searchParams.get("next"),
    "/admin/login",
  );

  const response = NextResponse.redirect(
    new URL(next, getTrustedRequestOrigin(request) ?? url.origin),
    303,
  );

  clearRememberDeviceCookie(response);
  clearPasswordRecoveryCookie(response);
  clearCsrfCookie(response);
  return response;
}
