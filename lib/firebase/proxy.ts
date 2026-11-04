import { NextResponse, type NextRequest } from "next/server";

// Firebase session cookies do not require a refresh request. Every protected
// page/API verifies the cookie with revocation checking in admin-auth.
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
