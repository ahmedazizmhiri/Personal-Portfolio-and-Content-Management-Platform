import { createHmac, timingSafeEqual } from "crypto";
import type { User } from "@/lib/firebase/types";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { createFirebaseServerClient } from "@/lib/firebase/server";
import {
  adminDeviceHmacSecret,
  adminMfaRememberDays,
  isFirebaseAdminConfigured,
  requireAdminDeviceHmacSecret,
  requireAdminMfa,
} from "@/lib/firebase/config";
import {
  hmacSha256Hex,
  randomToken,
  sha256Hex,
} from "@/lib/security/crypto";
import {
  clientIp,
  isSameOrigin,
  jsonError,
  userAgent,
} from "@/lib/security/http";
import {
  isCsrfTokenValid,
  isMutationRequest,
} from "@/lib/security/csrf";
import { safeRedirect } from "@/lib/security/redirects";

export const REMEMBER_DEVICE_COOKIE = "aam_admin_mfa_device";
export const passwordRecoveryCookieName = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-aam_admin_recovery"
    : "aam_admin_recovery";

const recoveryStateSignature = (payload: string) => {
  const secret = requireAdminDeviceHmacSecret();

  return createHmac("sha256", secret)
    .update(`password-recovery\0${payload}`)
    .digest("base64url");
};

export const createPasswordRecoveryState = (email: string) => {
  const payload = Buffer.from(
    JSON.stringify({
      emailHash: sha256Hex(email.trim().toLowerCase()),
      expiresAt: Date.now() + 30 * 60 * 1000,
      nonce: randomToken(16),
    }),
  ).toString("base64url");
  return `${payload}.${recoveryStateSignature(payload)}`;
};

export const isPasswordRecoveryStateValid = (
  state: string | null,
  email: string | null | undefined,
) => {
  if (!state || !email) return false;
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return false;

  const expected = recoveryStateSignature(payload);
  if (!hashesMatch(signature, expected)) return false;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      emailHash?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
    };
    return (
      parsed.emailHash === sha256Hex(email.trim().toLowerCase()) &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() &&
      parsed.expiresAt <= Date.now() + 31 * 60 * 1000 &&
      typeof parsed.nonce === "string" &&
      parsed.nonce.length >= 20
    );
  } catch {
    return false;
  }
};

export const setPasswordRecoveryCookie = (
  response: NextResponse,
  state: string,
) => {
  response.cookies.set(passwordRecoveryCookieName(), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
};

export const clearPasswordRecoveryCookie = (
  response: NextResponse,
) => {
  response.cookies.set(passwordRecoveryCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
};

export const passwordRecoveryStateFromRequest = (
  request: Request,
) =>
  cookieValueFromRequest(
    request,
    passwordRecoveryCookieName(),
  );

type AuthenticatedAdmin = {
  firebase: Awaited<ReturnType<typeof createFirebaseServerClient>>;
  user: User;
  mfaRequired: boolean;
  mfaSatisfied: boolean;
  verifiedFactors: unknown[];
};

export type AdminAuthState =
  | {
      status: "authenticated";
      firebase: Awaited<ReturnType<typeof createFirebaseServerClient>>;
      user: User;
    }
  | {
      status: "not_authenticated";
    }
  | {
      status: "not_admin";
      user: User;
    }
  | {
      status: "server_error";
    };

type RequestWithCookies = Request & {
  cookies?: {
    get?: (
      name: string,
    ) => { value?: string } | string | undefined;
  };
};

const cookieValueFromRequest = async (
  request: Request,
  name: string,
) => {
  const requestCookie = (
    request as RequestWithCookies
  ).cookies?.get?.(name);

  if (typeof requestCookie === "string") {
    return requestCookie;
  }

  if (requestCookie?.value) {
    return requestCookie.value;
  }

  try {
    const cookieStore = await cookies();
    return cookieStore.get(name)?.value ?? null;
  } catch {
    return null;
  }
};

const rememberCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

export const getAdminMembership = async (
  userId: string,
) => {
  if (!isFirebaseAdminConfigured()) {
    return {
      status: "server_error" as const,
    };
  }

  const firebase = createFirebaseAdminClient();

  const { data, error } = await firebase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      status: "server_error" as const,
    };
  }

  return data?.user_id
    ? {
        status: "admin" as const,
      }
    : {
        status: "not_admin" as const,
      };
};

export const isAdminUser = async (userId: string) =>
  (await getAdminMembership(userId)).status === "admin";

export const getAdminAuthState = async (
  request?: Request,
): Promise<AdminAuthState> => {
  try {
    const firebase = await createFirebaseServerClient(request);
    const { data, error } = await firebase.auth.getUser();
    const user = data.user;

    if (error || !user) {
      return { status: "not_authenticated" };
    }

    const membership = await getAdminMembership(user.id);
    if (membership.status === "server_error") {
      return { status: "server_error" };
    }
    if (membership.status === "not_admin") {
      return { status: "not_admin", user };
    }

    return {
      status: "authenticated",
      firebase,
      user,
    };
  } catch {
    return { status: "server_error" };
  }
};

export const getAdminSecurityPreference = async (
  userId: string,
) => {
  if (!isFirebaseAdminConfigured()) {
    return {
      mfa_required: requireAdminMfa(),
      remember_device_enabled: true,
    };
  }

  const firebase =
    createFirebaseAdminClient();

  const { data, error } = await firebase
    .from("admin_security_preferences")
    .select(
      "mfa_required, remember_device_enabled",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load admin security preferences.");
  }

  return {
    mfa_required:
      requireAdminMfa() ||
      Boolean(data?.mfa_required),

    remember_device_enabled:
      data?.remember_device_enabled ?? true,
  };
};

export const normalizeDeviceUserAgent = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const browser = normalized.includes("edg/")
    ? "edge"
    : normalized.includes("opr/") || normalized.includes("opera")
      ? "opera"
      : normalized.includes("firefox/")
        ? "firefox"
        : normalized.includes("chrome/") || normalized.includes("crios/")
          ? "chrome"
          : normalized.includes("safari/")
            ? "safari"
            : "other";
  const platform = normalized.includes("android")
    ? "android"
    : /iphone|ipad|ios/.test(normalized)
      ? "ios"
      : normalized.includes("windows")
        ? "windows"
        : /macintosh|mac os/.test(normalized)
          ? "macos"
          : normalized.includes("linux")
            ? "linux"
            : "other";
  const formFactor = /mobile|iphone|android/.test(normalized)
    ? "mobile"
    : "desktop";

  return `${browser}:${platform}:${formFactor}`;
};

const normalizeNetworkAddress = (value: string) =>
  value.trim().toLowerCase().slice(0, 128);

const deviceContextHmac = (
  label: "user-agent" | "network",
  value: string,
) => {
  const secret = requireAdminDeviceHmacSecret();

  return createHmac("sha256", secret)
    .update(`${label}\0${value}`)
    .digest("hex");
};

const hashesMatch = (left: string, right: string) => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const deviceContext = (request: Request) => ({
  userAgentHash: deviceContextHmac(
    "user-agent",
    normalizeDeviceUserAgent(userAgent(request)),
  ),
  networkHash: deviceContextHmac(
    "network",
    normalizeNetworkAddress(clientIp(request)),
  ),
});

export const validateRememberedDeviceToken =
  async (
    userId: string,
    token: string | null,
    request: Request,
    authValidAfter?: string,
  ) => {
    if (
      !token ||
      !isFirebaseAdminConfigured()
    ) {
      return false;
    }

    const firebase =
      createFirebaseAdminClient();
    const { data, error } = await firebase
      .from("admin_remembered_devices")
      .select(
        "id, created_at, device_context_hash, network_context_hash, last_user_agent_hash, last_network_context_hash, expires_at, revoked_at",
      )
      .eq("user_id", userId)
      .eq("token_hash", sha256Hex(token))
      .is("revoked_at", null)
      .gt(
        "expires_at",
        new Date().toISOString(),
      )
      .maybeSingle();

    if (error) {
      throw new Error("Remembered device could not be verified.");
    }
    if (!data) {
      return false;
    }
    // Firebase-hosted recovery also revokes refresh tokens. Devices issued
    // before that auth epoch must not bypass MFA after a new password login.
    if (authValidAfter) {
      const epoch = Date.parse(authValidAfter);
      const created = Date.parse(String(data.created_at ?? ""));
      if (!Number.isFinite(epoch) || !Number.isFinite(created) || Math.floor(created / 1000) <= Math.floor(epoch / 1000)) return false;
    }

    const context = deviceContext(request);
    if (
      !data.device_context_hash ||
      !hashesMatch(data.device_context_hash, context.userAgentHash)
    ) {
      const { error: revokeError } = await firebase
        .from("admin_remembered_devices")
        .update({
          revoked_at: new Date().toISOString(),
          revocation_reason: data.device_context_hash
            ? "context_mismatch"
            : "legacy_context_missing",
        })
        .eq("id", data.id)
        .eq("user_id", userId);

      if (revokeError) {
        throw new Error("Mismatched remembered device could not be revoked.");
      }

      await writeAdminAudit({
        actorUserId: userId,
        action: "remembered_device_context_mismatch",
        entityId: data.id,
        request,
      });
      return false;
    }

    const networkChanged = Boolean(
      (data.last_network_context_hash || data.network_context_hash) &&
      !hashesMatch(
        data.last_network_context_hash || data.network_context_hash,
        context.networkHash,
      ),
    );
    const { error: updateError } = await firebase
      .from("admin_remembered_devices")
      .update({
        last_used_at: new Date().toISOString(),
        last_user_agent_hash: context.userAgentHash,
        last_network_context_hash: context.networkHash,
      })
      .eq("id", data.id)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error("Remembered device usage could not be recorded.");
    }

    if (networkChanged) {
      await writeAdminAudit({
        actorUserId: userId,
        action: "remembered_device_network_changed",
        entityId: data.id,
        request,
      });
    }

    return true;
  };

export const validateRememberedDeviceFromRequest =
  async (
    userId: string,
    request: Request,
    authValidAfter?: string,
  ) =>
    validateRememberedDeviceToken(
      userId,
      await cookieValueFromRequest(
        request,
        REMEMBER_DEVICE_COOKIE,
      ),
      request,
      authValidAfter,
    );

export const validateRememberedDeviceFromCookies =
  async (userId: string, authValidAfter?: string) => {
    const cookieStore = await cookies();
    const requestHeaders = await headers();
    const copiedHeaders = new Headers();
    requestHeaders.forEach((value, name) => {
      copiedHeaders.set(name, value);
    });
    const request = new Request(
      "http://remembered-device.internal",
      { headers: copiedHeaders },
    );

    return validateRememberedDeviceToken(
      userId,
      cookieStore.get(
        REMEMBER_DEVICE_COOKIE,
      )?.value ?? null,
      request,
      authValidAfter,
    );
  };

export const createRememberedDevice = async (
  userId: string,
  request: Request,
) => {
  if (!isFirebaseAdminConfigured()) {
    return null;
  }

  const preference =
    await getAdminSecurityPreference(userId);

  if (
    !preference.remember_device_enabled
  ) {
    return null;
  }

  const existingToken = await cookieValueFromRequest(
    request,
    REMEMBER_DEVICE_COOKIE,
  );
  let existingDevice:
    | { id: string; rotation_counter: number }
    | null = null;
  const firebase =
    createFirebaseAdminClient();

  if (existingToken) {
    const { data, error } = await firebase
      .from("admin_remembered_devices")
      .select("id, rotation_counter")
      .eq("user_id", userId)
      .eq("token_hash", sha256Hex(existingToken))
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      throw new Error("Existing remembered device could not be loaded.");
    }
    existingDevice = data ? { id: data.id, rotation_counter: data.rotation_counter } : null;
  }

  const token = randomToken(32);

  const expiresAt = new Date(
    Date.now() +
      adminMfaRememberDays() *
        24 *
        60 *
        60 *
        1000,
  );

  const context = deviceContext(request);
  const now = new Date().toISOString();
  const { data: created, error } = await firebase
    .from("admin_remembered_devices")
    .insert({
      user_id: userId,
      token_hash: sha256Hex(token),
      device_context_hash: context.userAgentHash,
      network_context_hash: context.networkHash,
      last_user_agent_hash: context.userAgentHash,
      last_network_context_hash: context.networkHash,
      rotated_at: existingDevice ? now : null,
      rotation_counter:
        (existingDevice?.rotation_counter ?? -1) + 1,

      expires_at:
        expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error("Remembered device could not be created.");
  }

  if (existingToken) {
    try {
      await revokeRememberedDeviceToken(
        userId,
        existingToken,
        "rotated",
      );
    } catch {
      await revokeRememberedDevice(
        userId,
        created.id,
        "rotation_failed",
      );
      throw new Error("Remembered device could not be rotated.");
    }
  }

  return {
    token,
    expiresAt,
  };
};

export const setRememberDeviceCookie = (
  response: NextResponse,
  token: string,
  expiresAt: Date,
) => {
  response.cookies.set(
    REMEMBER_DEVICE_COOKIE,
    token,
    rememberCookieOptions(expiresAt),
  );
};

export const clearRememberDeviceCookie = (
  response: NextResponse,
) => {
  response.cookies.set(
    REMEMBER_DEVICE_COOKIE,
    "",
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    },
  );
};

export const revokeRememberedDevice = async (
  userId: string,
  id: string,
  reason = "user_revoked",
) => {
  if (!isFirebaseAdminConfigured()) {
    throw new Error("Firebase admin client is not configured.");
  }

  const firebase =
    createFirebaseAdminClient();

  const { data, error } = await firebase
    .from("admin_remembered_devices")
    .update({
      revoked_at:
        new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Remembered device could not be revoked.");
  }
};

export const revokeRememberedDeviceToken = async (
  userId: string,
  token: string | null,
  reason = "token_revoked",
) => {
  if (!token) return;
  if (!isFirebaseAdminConfigured()) {
    throw new Error("Firebase admin client is not configured.");
  }

  const firebase = createFirebaseAdminClient();
  const { error } = await firebase
    .from("admin_remembered_devices")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq("user_id", userId)
    .eq("token_hash", sha256Hex(token))
    .is("revoked_at", null);

  if (error) {
    throw new Error("Current remembered device could not be revoked.");
  }
};

export const revokeRememberedDeviceFromRequest = async (
  userId: string,
  request: Request,
  reason = "current_logout",
) =>
  revokeRememberedDeviceToken(
    userId,
    await cookieValueFromRequest(
      request,
      REMEMBER_DEVICE_COOKIE,
    ),
    reason,
  );

export const revokeAllRememberedDevices =
  async (
    userId: string,
    reason = "revoked_all",
  ) => {
    if (!isFirebaseAdminConfigured()) {
      throw new Error("Firebase admin client is not configured.");
    }

    const firebase =
      createFirebaseAdminClient();

    const { error } = await firebase
      .from("admin_remembered_devices")
      .update({
        revoked_at:
          new Date().toISOString(),
        revocation_reason: reason,
      })
      .eq("user_id", userId)
      .is("revoked_at", null);

    if (error) {
      throw new Error("Remembered devices could not be revoked.");
    }
  };

type MfaFactors = {
  all: unknown[];
  phone: unknown[];
  totp: unknown[];
  webauthn: unknown[];
};

const verifiedFactorsByType = (
  factors: unknown[],
  type: string,
) =>
  factors.filter((factor) => {
    const candidate = factor as {
      status?: string;
      factor_type?: string;
    };

    return (
      candidate.status === "verified" &&
      candidate.factor_type === type
    );
  });

const mfaFactorsFromUser = (
  user?: User,
): MfaFactors | null => {
  const factors = (
    user as
      | {
          factors?: unknown[];
        }
      | undefined
  )?.factors;

  if (!Array.isArray(factors)) {
    return null;
  }

  return {
    all: factors,

    phone: verifiedFactorsByType(
      factors,
      "phone",
    ),

    totp: verifiedFactorsByType(
      factors,
      "totp",
    ),

    webauthn: verifiedFactorsByType(
      factors,
      "webauthn",
    ),
  };
};

export const getMfaContext = async (
  firebase: Awaited<
    ReturnType<
      typeof createFirebaseServerClient
    >
  >,
  userId: string,
  request?: Request,
  user?: User,
) => {
  const preference =
    await getAdminSecurityPreference(userId);

  const identity = user ?? (await firebase.auth.getUser()).data.user ?? undefined;

  let factors = mfaFactorsFromUser(identity);
  if (!factors) {
    const factorResult = await firebase.auth.mfa.listFactors();
    if (factorResult.error) {
      throw new Error("MFA factors could not be verified.");
    }
    factors = factorResult.data ?? null;
  }

  const aal = await firebase.auth.mfa
    .getAuthenticatorAssuranceLevel();
  if (aal.error) {
    throw new Error("MFA assurance level could not be verified.");
  }

  const verifiedFactors =
    factors?.totp ?? [];

  const remembered =
    preference.remember_device_enabled
      ? request
        ? await validateRememberedDeviceFromRequest(
            userId,
            request,
            identity?.authValidAfter,
          )
        : await validateRememberedDeviceFromCookies(
            userId,
            identity?.authValidAfter,
          )
      : false;

  const currentLevel =
    aal.data?.currentLevel ?? null;

  return {
    aal: aal.data ?? null,
    factors,
    verifiedFactors,

    mfaRequired:
      preference.mfa_required,

    rememberDeviceEnabled:
      preference.remember_device_enabled,

    currentLevel,
    freshMfaSatisfied:
      currentLevel === "aal2",

    mfaSatisfied:
      currentLevel === "aal2" ||
      remembered,

    remembered,
  };
};

export const getAuthenticatedAdmin = async (
  request?: Request,
) => {
  const state =
    await getAdminAuthState(request);

  if (
    state.status !== "authenticated"
  ) {
    return null;
  }

  const mfa = await getMfaContext(
    state.firebase,
    state.user.id,
    request,
    state.user,
  );

  return {
    firebase: state.firebase,
    user: state.user,
    mfaRequired: mfa.mfaRequired,
    mfaSatisfied: mfa.mfaSatisfied,
    verifiedFactors:
      mfa.verifiedFactors,
  } satisfies AuthenticatedAdmin;
};

export const requireAdminPage = async (
  options?: {
    next?: string;
    requireMfa?: boolean;
    allowMfaSetup?: boolean;
  },
) => {
  let admin:
    | Awaited<
        ReturnType<
          typeof getAuthenticatedAdmin
        >
      >
    | null = null;

  try {
    admin =
      await getAuthenticatedAdmin();
  } catch {
    admin = null;
  }

  if (!admin) {
    redirect(
      `/admin/login?next=${encodeURIComponent(
        options?.next ?? "/admin",
      )}`,
    );

    throw new Error(
      "Redirecting to admin login.",
    );
  }

  const mustHaveMfa =
    options?.requireMfa ?? true;

  const canSetup =
    options?.allowMfaSetup &&
    admin.verifiedFactors.length === 0;

  if (
    mustHaveMfa &&
    admin.mfaRequired &&
    !admin.mfaSatisfied &&
    !canSetup
  ) {
    redirect(
      `/admin/login?mfa=required&next=${encodeURIComponent(
        options?.next ?? "/admin",
      )}`,
    );

    throw new Error(
      "Redirecting to MFA verification.",
    );
  }

  return admin;
};

export const requireAdminApi = async (
  request: Request,
  options?: {
    requireMfa?: boolean;
    requireFreshMfa?: boolean;
    sameOrigin?: boolean;
  },
) => {
  if (
    (options?.sameOrigin ?? true) &&
    !isSameOrigin(request)
  ) {
    return {
      ok: false as const,

      response: jsonError(
        "Request origin is not allowed.",
        403,
        "origin_not_allowed",
      ),
    };
  }

  if (
    isMutationRequest(request) &&
    !isCsrfTokenValid(request)
  ) {
    return {
      ok: false as const,
      response: jsonError(
        "CSRF token is missing or invalid.",
        403,
        "csrf_invalid",
      ),
    };
  }

  if (!isFirebaseAdminConfigured()) {
    return {
      ok: false as const,
      response: jsonError(
        "Admin authentication is temporarily unavailable.",
        503,
        "auth_unavailable",
      ),
    };
  }

  try {
    const state =
      await getAdminAuthState(request);

    if (
      state.status ===
      "not_authenticated"
    ) {
      return {
        ok: false as const,

        response: jsonError(
          "You are not signed in.",
          401,
          "not_authenticated",
        ),
      };
    }

    if (state.status === "not_admin") {
      return {
        ok: false as const,

        response: jsonError(
          "This account is not authorized for CMS administration.",
          403,
          "not_admin",
        ),
      };
    }

    if (
      state.status === "server_error"
    ) {
      return {
        ok: false as const,

        response: jsonError(
          "Admin authentication could not be verified.",
          503,
          "auth_unavailable",
        ),
      };
    }

    const mfa =
      (options?.requireMfa ?? false) ||
      (options?.requireFreshMfa ?? false)
        ? await getMfaContext(
            state.firebase,
            state.user.id,
            request,
            state.user,
          )
        : {
            mfaRequired: false,
            mfaSatisfied: true,
            freshMfaSatisfied: false,
            verifiedFactors:
              [] as unknown[],
          };

    if (
      mfa.mfaRequired &&
      !mfa.mfaSatisfied
    ) {
      return {
        ok: false as const,

        response: jsonError(
          "MFA verification is required.",
          403,
          "mfa_required",
        ),
      };
    }

    if (
      options?.requireFreshMfa &&
      !mfa.freshMfaSatisfied
    ) {
      return {
        ok: false as const,
        response: jsonError(
          "Fresh MFA verification is required.",
          403,
          "fresh_mfa_required",
        ),
      };
    }

    return {
      ok: true as const,
      firebase: state.firebase,
      user: state.user,
      mfaRequired:
        mfa.mfaRequired,
      mfaSatisfied:
        mfa.mfaSatisfied,
      verifiedFactors:
        mfa.verifiedFactors,
    };
  } catch {
    return {
      ok: false as const,

      response: jsonError(
        "Admin authentication could not be verified.",
        503,
        "auth_unavailable",
      ),
    };
  }
};

export const signOutAndRedirectToLogin =
  async (next = "/admin") => {
    const firebase =
      await createFirebaseServerClient();

    await firebase.auth.signOut();

    redirect(
      `/admin/login?next=${encodeURIComponent(
        safeRedirect(next),
      )}`,
    );
  };

export const writeAdminAudit = async (
  input: {
    actorUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<
      string,
      unknown
    > | null;
    request?: Request;
  },
) => {
  if (!isFirebaseAdminConfigured()) {
    return;
  }

  try {
    const firebase =
      createFirebaseAdminClient();
    const privacySecret = adminDeviceHmacSecret();
    const keyedHash = (value: string) =>
      privacySecret
        ? hmacSha256Hex(value, privacySecret)
        : null;

    const { error } = await firebase
      .from("admin_audit_logs")
      .insert({
        actor_user_id:
          input.actorUserId ?? null,

        action: input.action,

        entity_type:
          input.entityType ?? null,

        entity_id:
          input.entityId ?? null,

        metadata:
          input.metadata ?? null,

        ip_hash: input.request
          ? keyedHash(clientIp(input.request))
          : null,

        user_agent_hash: input.request
          ? keyedHash(
              normalizeDeviceUserAgent(userAgent(input.request)),
            )
          : null,
      });
    if (error) {
      console.error("Admin audit write failed.", {
        incidentId: "ADMIN-AUDIT-WRITE",
      });
    }
  } catch {
    console.error("Admin audit write failed.", {
      incidentId: "ADMIN-AUDIT-WRITE",
    });
  }
};
