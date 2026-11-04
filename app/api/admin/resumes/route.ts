import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";
import { requireAdminApi } from "@/lib/security/admin-auth";
import { jsonError, jsonOk } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true, sameOrigin: false });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) return jsonError("CMS server configuration is incomplete.", 500, "server_error");

  const firebase = createFirebaseAdminClient();
  const { data, error } = await firebase
    .from("resumes")
    .select("id,label,variant,pdf_url,docx_url,sort_order,published,created_at,updated_at")
    .order("sort_order", { ascending: true });
  if (error) return jsonError("Could not load resumes.", 500, "server_error");
  return jsonOk({ resumes: data ?? [] });
}

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  return jsonError(
    "Use the versioned CMS content endpoint for resume changes.",
    410,
    "deprecated_endpoint",
  );
}
