import { NextResponse } from "next/server";

import { getAllowedOrigins } from "@/lib/firebase/config";
import { jsonHeaders } from "@/lib/security/headers";
export { jsonHeaders } from "@/lib/security/headers";

const normalizeOrigin = (value: string) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.origin === "null") {
      return null;
    }
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
};

export const clientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
};

export const userAgent = (request: Request) => request.headers.get("user-agent") || "unknown";

const trustedOrigins = () =>
  new Set(
    getAllowedOrigins()
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );

export const getTrustedRequestOrigin = (request: Request) => {
  const requestOrigin = normalizeOrigin(request.url);
  return requestOrigin && trustedOrigins().has(requestOrigin)
    ? requestOrigin
    : null;
};

const fetchMetadataAllowsRequest = (request: Request) => {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  // Older browsers may omit Fetch Metadata. When present, it must prove the
  // request came from the exact origin, not merely a sibling subdomain.
  return !site || site === "same-origin";
};

export const isSameOrigin = (request: Request) => {
  const requestOrigin = getTrustedRequestOrigin(request);
  if (!requestOrigin || !fetchMetadataAllowsRequest(request)) {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin) {
    return normalizeOrigin(origin) === requestOrigin;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return normalizeOrigin(referer) === requestOrigin;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "same-origin") {
    return true;
  }

  return process.env.NODE_ENV !== "production";
};

export const assertSameOrigin = (request: Request) => {
  if (!isSameOrigin(request)) {
    throw new Error("Request origin is not allowed.");
  }
};

export const jsonError = (message = "Request failed.", status = 400, code?: string) =>
  NextResponse.json(
    { ok: false, error: message, ...(code ? { code } : {}) },
    { status, headers: jsonHeaders },
  );

export const jsonOk = <T>(data: T, status = 200) =>
  NextResponse.json({ ok: true, ...data }, { status, headers: jsonHeaders });
