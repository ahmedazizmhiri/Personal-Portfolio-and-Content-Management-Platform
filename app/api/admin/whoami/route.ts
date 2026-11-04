import { NextResponse } from "next/server";

import { getAdminAuthState } from "@/lib/security/admin-auth";
import { jsonOk } from "@/lib/security/http";
import { requireAdminMfa } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const state = await getAdminAuthState(request);
  const mfaRequired = requireAdminMfa();

  if (state.status === "authenticated") {
    return jsonOk({
      authenticated: true,
      email: state.user.email ?? null,
      userId: state.user.id,
      isAdmin: true,
      requireMfa: mfaRequired,
      mfaRequired,
    });
  }

  if (state.status === "not_admin") {
    return jsonOk({
      authenticated: true,
      email: state.user.email ?? null,
      userId: state.user.id,
      isAdmin: false,
      requireMfa: mfaRequired,
      mfaRequired,
    });
  }

  return jsonOk({
    authenticated: false,
    email: null,
    userId: null,
    isAdmin: false,
    requireMfa: mfaRequired,
    mfaRequired,
    status: state.status,
  });
}
