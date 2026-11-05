import { requireAdminApi } from "@/lib/security/admin-auth";
import { jsonError } from "@/lib/security/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  return jsonError("Private storage is not configured; public files only.", 409, "private_storage_not_enabled");
}
