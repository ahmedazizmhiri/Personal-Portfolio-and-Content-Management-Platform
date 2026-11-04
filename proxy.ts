import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/firebase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/:path*",
    "/auth/:path*",
  ],
};
