import { NextResponse } from "next/server";
import { firebaseAuth } from "@/lib/firebase/admin";
import { firebaseAuthRequest } from "@/lib/firebase/auth-rest";
import { clearPasswordRecoveryCookie, clearRememberDeviceCookie, revokeAllRememberedDevices, writeAdminAudit } from "@/lib/security/admin-auth";
import { clearCsrfCookie, isCsrfTokenValid } from "@/lib/security/csrf";
import { assertSameOrigin, clientIp, jsonError, jsonHeaders } from "@/lib/security/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { resetPasswordSchema } from "@/lib/security/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!isCsrfTokenValid(request)) return jsonError("CSRF token is missing or invalid.", 403, "csrf_invalid");
    const parsed = resetPasswordSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("A valid recovery link and a stronger password are required.", 400);
    const limited = await consumeRateLimit({ scope: "admin-password-reset", identifiers: [clientIp(request)], limit: 5, windowMs: 30 * 60 * 1000 });
    if (!limited.allowed) return rateLimitResponse(limited);
    const recovery = await firebaseAuthRequest<{ email: string }>("accounts:resetPassword", { oobCode: parsed.data.oobCode });
    const user = await firebaseAuth().getUserByEmail(recovery.email);
    await revokeAllRememberedDevices(user.uid, "password_reset");
    await firebaseAuthRequest("accounts:resetPassword", { oobCode: parsed.data.oobCode, newPassword: parsed.data.password });
    await firebaseAuth().revokeRefreshTokens(user.uid);
    await writeAdminAudit({ actorUserId: user.uid, action: "password_reset_completed", request });
    const response = NextResponse.json({ ok: true, redirectTo: "/admin/login?reset=success" }, { headers: jsonHeaders });
    clearRememberDeviceCookie(response); clearPasswordRecoveryCookie(response); clearCsrfCookie(response);
    return response;
  } catch { return jsonError("Recovery link is invalid or expired. Request a new recovery email.", 400); }
}
