import { NextResponse } from "next/server";
import { getAdminMembership, getMfaContext, writeAdminAudit } from "@/lib/security/admin-auth";
import { noStoreHeaders } from "@/lib/security/headers";
import { getTrustedRequestOrigin, jsonError } from "@/lib/security/http";
import { safeRedirect } from "@/lib/security/redirects";
import { createFirebaseServerClient } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getTrustedRequestOrigin(request);
  if (!origin) return jsonError("Authentication callback target is not allowed.", 400, "origin_not_allowed");
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), { headers: noStoreHeaders });
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return go("/admin/login?error=github_oauth_failed");
  try {
    const firebase = await createFirebaseServerClient();
    const result = await firebase.auth.exchangeCodeForSession(code, url.searchParams.get("state"));
    const user = result.data?.user;
    if (result.error || !user || (await getAdminMembership(user.id)).status !== "admin") {
      await firebase.auth.signOut();
      return go("/admin/login?error=unauthorized");
    }
    const requestedNext = safeRedirect(result.data?.next, "/admin");
    const next = requestedNext === "/admin" || requestedNext.startsWith("/admin/") ? requestedNext : "/admin";
    const mfa = await getMfaContext(firebase, user.id, request, user);
    if (mfa.mfaRequired && !mfa.mfaSatisfied) return go(mfa.verifiedFactors.length ? `/admin/login?mfa=required&next=${encodeURIComponent(next)}` : "/admin/security?setup=mfa");
    await writeAdminAudit({ actorUserId: user.id, action: "oauth_login_success", request });
    return go(next);
  } catch { return go("/admin/login?error=callback"); }
}
