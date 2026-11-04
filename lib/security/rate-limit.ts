import "server-only";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";
import { hmacSha256Hex } from "@/lib/security/crypto";
import { jsonError } from "@/lib/security/http";

type DevelopmentBucket = {
  count: number;
  resetAt: number;
};

const developmentBuckets = new Map<string, DevelopmentBucket>();
const maxDevelopmentBuckets = 1_000;

export type RateLimitOptions = {
  scope: string;
  identifiers: Array<string | null | undefined>;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  available: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const unavailable = (): RateLimitResult => ({
  allowed: false,
  available: false,
  remaining: 0,
  resetAt: Date.now(),
  retryAfterSeconds: 60,
});

const developmentRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult => {
  const now = Date.now();

  for (const [bucketKey, bucket] of developmentBuckets) {
    if (bucket.resetAt <= now) developmentBuckets.delete(bucketKey);
  }

  if (developmentBuckets.size >= maxDevelopmentBuckets) {
    const oldestKey = developmentBuckets.keys().next().value;
    if (typeof oldestKey === "string") developmentBuckets.delete(oldestKey);
  }

  const current = developmentBuckets.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    developmentBuckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      available: true,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1_000)),
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      available: true,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  developmentBuckets.set(key, current);
  return {
    allowed: true,
    available: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
  };
};

export const consumeRateLimit = async ({
  scope,
  identifiers,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> => {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET?.trim() ?? "";
  const normalizedScope = scope.trim().toLowerCase().slice(0, 80);
  const boundedLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
  const boundedWindowMs = Math.min(
    24 * 60 * 60 * 1_000,
    Math.max(1_000, Math.floor(windowMs)),
  );
  const material = identifiers
    .map((identifier) => String(identifier ?? "").trim().toLowerCase())
    .join("\u0000");

  if (!normalizedScope || !material || secret.length < 32) {
    if (process.env.NODE_ENV !== "production") {
      return developmentRateLimit(
        `${normalizedScope}:${material}`,
        boundedLimit,
        boundedWindowMs,
      );
    }
    return unavailable();
  }

  if (!isFirebaseAdminConfigured()) {
    return process.env.NODE_ENV === "production"
      ? unavailable()
      : developmentRateLimit(
        `${normalizedScope}:${material}`,
        boundedLimit,
        boundedWindowMs,
      );
  }

  try {
    const firebase = createFirebaseAdminClient();
    const { data, error } = await firebase.rpc("consume_rate_limit", {
      p_scope: normalizedScope,
      p_key_hash: hmacSha256Hex(material, secret),
      p_limit: boundedLimit,
      p_window_seconds: Math.max(1, Math.ceil(boundedWindowMs / 1_000)),
    });

    if (error) {
      console.error("[rate-limit] Durable limiter unavailable", {
        scope: normalizedScope,
        code: error.code,
      });
      return unavailable();
    }

    const record = Array.isArray(data) ? data[0] : data;
    if (!record || typeof record !== "object") return unavailable();

    const candidate = record as Record<string, unknown>;
    const resetAt = Date.parse(String(candidate.reset_at ?? ""));
    if (
      typeof candidate.allowed !== "boolean"
      || !Number.isFinite(Number(candidate.remaining))
      || !Number.isFinite(resetAt)
    ) {
      return unavailable();
    }

    return {
      allowed: candidate.allowed,
      available: true,
      remaining: Math.max(0, Number(candidate.remaining)),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000)),
    };
  } catch {
    return unavailable();
  }
};

export const rateLimitResponse = (
  result: RateLimitResult,
  message = "Too many requests. Please wait and try again.",
) => {
  const response = result.available
    ? jsonError(message, 429, "rate_limited")
    : jsonError(
      "Request protection is temporarily unavailable. Please try again shortly.",
      503,
      "rate_limit_unavailable",
    );

  response.headers.set("Retry-After", String(result.retryAfterSeconds));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", new Date(result.resetAt).toISOString());
  return response;
};
