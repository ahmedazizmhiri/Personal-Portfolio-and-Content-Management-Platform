const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const readEnv = (key: string) => process.env[key]?.trim() ?? "";

const meaningfulUtf8ByteLength = (value: string) =>
  new TextEncoder().encode(value.replace(/\s/gu, "")).byteLength;

const ADMIN_SECURITY_HMAC_CONFIGURATION_ERROR =
  "Admin security HMAC configuration is missing or invalid.";

const isLocalHostname = (hostname: string) => {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^::ffff:(?:127\.|7f[\da-f]{2}:)/.test(normalized)
  );
};

const isAllowedProductionOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !isLocalHostname(url.hostname)
    );
  } catch {
    return false;
  }
};

export const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
export const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
export const firebaseCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/",
};
export const firebaseEnv = {
  projectId: firebaseProjectId,
  apiKey: firebaseApiKey,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? "",
};
export const isFirebaseConfigured = () => Boolean(firebaseProjectId);
export const isFirebaseAdminConfigured = () => Boolean(firebaseProjectId);
export const isFirebaseStorageConfigured = () => Boolean(firebaseEnv.storageBucket);

export const getAppUrl = () => {
  const configured = readEnv("APP_URL") || readEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000";
  return trimTrailingSlash(configured);
};

export const getPublicSiteUrl = () => {
  const configured = readEnv("NEXT_PUBLIC_SITE_URL") || readEnv("APP_URL") || "http://localhost:3000";
  return trimTrailingSlash(configured);
};

export const getAllowedOrigins = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const explicit = readEnv("ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const developmentOrigins = isProduction
    ? []
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
  const previewOrigins = readEnv("VERCEL_ENV") === "preview"
    ? [readEnv("VERCEL_URL"), readEnv("VERCEL_BRANCH_URL")]
      .filter(Boolean)
      .map((hostname) => `https://${hostname.replace(/^https?:\/\//, "")}`)
    : [];

  return Array.from(
    new Set(
      [
        getAppUrl(),
        getPublicSiteUrl(),
        ...previewOrigins,
        ...developmentOrigins,
        ...explicit,
      ]
        .map(trimTrailingSlash)
        .filter((origin) => !isProduction || isAllowedProductionOrigin(origin)),
    ),
  );
};

export const requireAdminMfa = () => readEnv("REQUIRE_ADMIN_MFA").toLowerCase() === "true";

export const adminMfaRememberDays = () => {
  const days = Number(readEnv("ADMIN_MFA_REMEMBER_DAYS") || "10");
  if (!Number.isFinite(days)) return 10;
  return Math.min(30, Math.max(1, Math.trunc(days)));
};

export const adminDeviceHmacSecret = () => {
  const secret = readEnv("ADMIN_DEVICE_HMAC_SECRET");
  return meaningfulUtf8ByteLength(secret) >= 32 ? secret : "";
};

export const requireAdminDeviceHmacSecret = () => {
  const secret = adminDeviceHmacSecret();
  if (!secret) {
    throw new Error(ADMIN_SECURITY_HMAC_CONFIGURATION_ERROR);
  }
  return secret;
};

export const assertFirebasePublicEnv = () => {
  if (!isFirebaseConfigured()) throw new Error("Firebase project is not configured.");
};
export const assertFirebaseAdminEnv = assertFirebasePublicEnv;
