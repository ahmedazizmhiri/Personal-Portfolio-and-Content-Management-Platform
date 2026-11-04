import {
  createPasswordRecoveryState,
  writeAdminAudit,
} from "@/lib/security/admin-auth";
import { isCsrfTokenValid } from "@/lib/security/csrf";
import { hmacSha256Hex } from "@/lib/security/crypto";
import {
  assertSameOrigin,
  clientIp,
  getTrustedRequestOrigin,
  jsonError,
  jsonOk,
} from "@/lib/security/http";
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { forgotPasswordSchema } from "@/lib/security/validation";
import { createFirebaseServerClient } from "@/lib/firebase/server";
import { adminDeviceHmacSecret } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

const generic = "If an account exists, password-reset instructions have been sent.";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!isCsrfTokenValid(request)) {
      return jsonError(
        "CSRF token is missing or invalid.",
        403,
        "csrf_invalid",
      );
    }
    const parsed = forgotPasswordSchema.safeParse(await request.json());
    if (!parsed.success) return jsonOk({ message: generic });

    const ip = clientIp(request);
    const emailKey = parsed.data.email.toLowerCase();
    const limited = await consumeRateLimit({
      scope: "admin-password-recovery",
      identifiers: [ip, emailKey],
      limit: 5,
      windowMs: 30 * 60 * 1000,
    });
    if (!limited.allowed) return rateLimitResponse(limited, generic);

    const requestOrigin = getTrustedRequestOrigin(request);
    if (!requestOrigin) return jsonOk({ message: generic });
    const callback = new URL("/auth/callback", requestOrigin);
    callback.searchParams.set("next", "/admin/reset-password");
    callback.searchParams.set(
      "recovery_state",
      createPasswordRecoveryState(emailKey),
    );
    const redirectTo = callback.toString();
    const firebase = await createFirebaseServerClient();
    const { error } = await firebase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
      captchaToken: parsed.data.captchaToken,
    });

    await writeAdminAudit({
      action: error ? "password_reset_request_failed" : "password_reset_requested",
      metadata: {
        email_hash: adminDeviceHmacSecret()
          ? hmacSha256Hex(emailKey, adminDeviceHmacSecret())
          : null,
        error_code: error?.code ?? null,
      },
      request,
    });

    return jsonOk({ message: generic });
  } catch {
    return jsonOk({ message: generic });
  }
}
