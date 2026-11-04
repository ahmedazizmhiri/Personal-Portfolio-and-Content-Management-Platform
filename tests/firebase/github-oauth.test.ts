import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), request: vi.fn(), verify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (key: string) => state.cookies.has(key) ? { value: state.cookies.get(key) } : undefined,
  set: (key: string, value: string) => state.cookies.set(key, value),
}) }));
vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: () => ({}),
  firebaseAuth: () => ({ verifyIdToken: state.verify }),
  firestore: vi.fn(),
}));
vi.mock("@/lib/firebase/auth-rest", () => ({ firebaseAuthRequest: state.request }));

import { createFirebaseServerClient } from "@/lib/firebase/server";

beforeEach(() => {
  vi.resetAllMocks();
  state.cookies.clear();
  vi.stubEnv("APP_URL", "https://portfolio.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("Firebase-managed GitHub OAuth", () => {
  it("binds Firebase's state and session in an HTTP-only cookie without local OAuth credentials", async () => {
    state.request.mockResolvedValue({ authUri: "https://github.com/login/oauth/authorize?state=provider-state", sessionId: "firebase-session" });
    const client = await createFirebaseServerClient();
    const result = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: "https://portfolio.test/auth/callback?next=/admin/security" } });
    expect(result.error).toBeNull();
    expect(state.request).toHaveBeenCalledWith("accounts:createAuthUri", expect.objectContaining({ providerId: "github.com", continueUri: "https://portfolio.test/auth/callback" }));
    expect(JSON.parse(state.cookies.get("aam_firebase_oauth")!)).toMatchObject({ state: "provider-state", sessionId: "firebase-session" });
  });

  it("rejects an unexpected authorization host", async () => {
    state.request.mockResolvedValue({ authUri: "https://untrusted.test/?state=value", sessionId: "firebase-session" });
    const client = await createFirebaseServerClient();
    const result = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: "https://portfolio.test/auth/callback" } });
    expect(result.data.url).toBeNull();
    expect(state.cookies.has("aam_firebase_oauth")).toBe(false);
  });

  it("consumes and rejects a callback with mismatched state before any token exchange", async () => {
    state.cookies.set("aam_firebase_oauth", JSON.stringify({ state: "expected", sessionId: "session", redirectTo: "https://portfolio.test/auth/callback" }));
    const client = await createFirebaseServerClient();
    const result = await client.auth.exchangeCodeForSession("code", "attacker");
    expect(result.error).not.toBeNull();
    expect(state.request).not.toHaveBeenCalled();
    expect(state.cookies.get("aam_firebase_oauth")).toBe("");
  });

  it("sends the bound session and callback to Firebase and prevents callback replay", async () => {
    state.cookies.set("aam_firebase_oauth", JSON.stringify({ state: "expected", sessionId: "session", redirectTo: "https://portfolio.test/auth/callback" }));
    state.request.mockResolvedValue({ idToken: "firebase-token" });
    state.verify.mockRejectedValue(new Error("Stop before creating a test admin session"));
    const client = await createFirebaseServerClient();
    await client.auth.exchangeCodeForSession("github-code", "expected");
    expect(state.request).toHaveBeenCalledWith("accounts:signInWithIdp", {
      sessionId: "session", requestUri: "https://portfolio.test/auth/callback?code=github-code&state=expected", returnSecureToken: true, autoCreate: false,
    });
    expect(state.verify).toHaveBeenCalledWith("firebase-token", true);
    await client.auth.exchangeCodeForSession("github-code", "expected");
    expect(state.request).toHaveBeenCalledTimes(1);
  });
});
