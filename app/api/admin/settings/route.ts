import type { AdminProfileSettings } from "@/lib/cms-types";
import { requireAdminApi, writeAdminAudit } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { adminProfileSettingsSchema } from "@/lib/security/validation";
import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

const defaultProfile: AdminProfileSettings = {
  displayName: "",
  jobTitle: "",
  phone: "",
  avatarUrl: "",
  timezone: "",
  language: "",
};

const settingsKey = (userId: string) => `admin_profile:${userId}`;

const safeProfile = (value: unknown): AdminProfileSettings => {
  if (!value || typeof value !== "object") return defaultProfile;

  const candidate = value as Record<string, unknown>;
  const parsed = adminProfileSettingsSchema.safeParse({
    displayName: candidate.displayName,
    jobTitle: candidate.jobTitle,
    phone: candidate.phone,
    avatarUrl: candidate.avatarUrl,
    timezone: candidate.timezone,
    language: candidate.language,
  });

  return parsed.success ? parsed.data : defaultProfile;
};

export async function GET(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true, sameOrigin: false });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError("CMS server configuration is incomplete.", 500, "server_error");
  }

  const firebase = createFirebaseAdminClient();
  const { data, error } = await firebase
    .from("site_settings")
    .select("value")
    .eq("key", settingsKey(admin.user.id))
    .maybeSingle();

  if (error) {
    return jsonError("Could not load admin settings.", 500, "server_error");
  }

  return jsonOk({
    profile: safeProfile(data?.value),
    email: admin.user.email ?? "",
  });
}

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError("CMS server configuration is incomplete.", 500, "server_error");
  }

  const parsed = adminProfileSettingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError("Invalid admin profile settings.", 400, "validation_error");
  }

  const limited = await consumeRateLimit({
    scope: "admin_settings_update",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 30,
    windowMs: 10 * 60 * 1_000,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const key = settingsKey(admin.user.id);
  const value = { ...parsed.data, public: false as const };
  const firebase = createFirebaseAdminClient();
  const { data, error } = await firebase
    .from("site_settings")
    .upsert({ key, value }, { onConflict: "key" })
    .select("value")
    .single();

  if (error || !data) {
    return jsonError("Could not save admin settings.", 500, "server_error");
  }

  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: "admin_profile_settings_updated",
    entityType: "site_settings",
    entityId: key,
    request,
  });

  return jsonOk({
    profile: safeProfile(data.value),
    email: admin.user.email ?? "",
  });
}
