import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth, firestore, createFirebaseAdminClient } from "./admin";
import { createDataClient } from "./database";
import { firebaseAuthRequest } from "./auth-rest";
import { firebaseCookieOptions, getAppUrl } from "./config";
import { enrollMfa, listMfaFactors, removeMfa, verifyMfa } from "./mfa";
import type { AuthError, User } from "./types";
import { verifyCaptcha } from "@/lib/security/captcha";

export const sessionCookieName = () => process.env.NODE_ENV === "production" ? "__Host-aam_firebase_session" : "aam_firebase_session";
export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
const sessionLifetime = 5 * 24 * 60 * 60 * 1000;
const authError = (error: unknown): AuthError => ({ message: "Authentication failed.", code: (error as { code?: string })?.code ?? "auth_failed" });

export const createFirebaseServerClient = async (_request?: Request) => {
  const cookieStore = await cookies();
  let sessionToken = cookieStore.get(sessionCookieName())?.value ?? "";
  let claims: DecodedIdToken | null = null;
  const getIdentity = async () => {
    if (!sessionToken) return null;
    claims ??= await firebaseAuth().verifySessionCookie(sessionToken, true);
    const session = await firestore().collection("_admin_sessions").doc(sessionHash(sessionToken)).get();
    if (!session.exists || session.data()?.uid !== claims.uid || session.data()?.revoked || session.data()?.expires_at.toMillis() <= Date.now()) return null;
    return claims;
  };
  const user = async (): Promise<User | null> => {
    const identity = await getIdentity();
    if (!identity) return null;
    const [account, factors] = await Promise.all([firebaseAuth().getUser(identity.uid), listMfaFactors(identity.uid)]);
    return { id: identity.uid, email: identity.email, factors, authValidAfter: account.tokensValidAfterTime };
  };
  const establishSession = async (idToken: string) => {
    const decoded = await firebaseAuth().verifyIdToken(idToken, true);
    if (Date.now() / 1000 - decoded.auth_time > 300) throw new Error("Recent authentication required.");
    // Check membership before issuing the application session, including OAuth.
    const membership = await firestore().collection("admins").doc(decoded.uid).get();
    if (!membership.exists || membership.data()?.user_id !== decoded.uid) throw new Error("Admin access denied.");
    sessionToken = await firebaseAuth().createSessionCookie(idToken, { expiresIn: sessionLifetime });
    claims = null;
    await firestore().collection("_admin_sessions").doc(sessionHash(sessionToken)).set({ uid: decoded.uid, revoked: false, mfa_verified_at: null, mfa_factor_id: null, expires_at: new Date(Date.now() + sessionLifetime) });
    cookieStore.set(sessionCookieName(), sessionToken, { ...firebaseCookieOptions, maxAge: sessionLifetime / 1000 });
    return (await user())!;
  };
  const requireUser = async () => { const current = await user(); if (!current) throw new Error("Session expired."); return current; };
  const mfa = {
    listFactors: async () => {
      try { const current = await requireUser(); const all = await listMfaFactors(current.id); return { data: { all, totp: all.filter((factor) => factor.status === "verified"), phone: [], webauthn: [] }, error: null }; }
      catch (error) { return { data: null, error: authError(error) }; }
    },
    getAuthenticatorAssuranceLevel: async () => {
      try {
        const current = await requireUser();
        const [session, factors] = await Promise.all([firestore().collection("_admin_sessions").doc(sessionHash(sessionToken)).get(), listMfaFactors(current.id)]);
        const factor = factors.find((item) => item.status === "verified");
        const verified = Boolean(factor && session.data()?.mfa_factor_id === factor.id && Date.now() - session.data()!.mfa_verified_at <= 15 * 60 * 1000);
        return { data: { currentLevel: verified ? "aal2" : "aal1", nextLevel: factor ? "aal2" : "aal1" }, error: null };
      } catch (error) { return { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: authError(error) }; }
    },
    enroll: async ({ issuer }: { factorType: string; issuer: string }) => {
      try { const current = await requireUser(); return { data: await enrollMfa(current.id, current.email ?? current.id, issuer), error: null }; }
      catch (error) { return { data: null, error: authError(error) }; }
    },
    challengeAndVerify: async ({ factorId, code }: { factorId: string; code: string }) => {
      try { const current = await requireUser(); await verifyMfa(current.id, factorId, code, sessionHash(sessionToken)); return { data: { verified: true }, error: null }; }
      catch (error) { return { data: null, error: authError(error) }; }
    },
    unenroll: async ({ factorId }: { factorId: string }) => {
      try { const current = await requireUser(); await removeMfa(current.id, factorId, sessionHash(sessionToken)); return { error: null }; }
      catch (error) { return { error: authError(error) }; }
    },
  };
  const auth = {
    mfa,
    getUser: async () => {
      try { return { data: { user: await user() }, error: null }; }
      catch (error) { return { data: { user: null }, error: authError(error) }; }
    },
    signInWithPassword: async (input: { email: string; password: string; options: { captchaToken: string } }) => {
      try {
        if (!(await verifyCaptcha(input.options.captchaToken)).ok) throw new Error("CAPTCHA failed.");
        const result = await firebaseAuthRequest<{ idToken: string }>("accounts:signInWithPassword", { email: input.email, password: input.password, returnSecureToken: true });
        return { data: { user: await establishSession(result.idToken) }, error: null };
      } catch (error) { return { data: { user: null }, error: authError(error) }; }
    },
    signOut: async (options?: { scope?: string }) => {
      try {
        const identity = await getIdentity();
        if (sessionToken) await firestore().collection("_admin_sessions").doc(sessionHash(sessionToken)).set({ revoked: true }, { merge: true });
        if (identity && options?.scope === "global") await firebaseAuth().revokeRefreshTokens(identity.uid);
        sessionToken = ""; claims = null;
        cookieStore.set(sessionCookieName(), "", { ...firebaseCookieOptions, maxAge: 0 });
        return { error: null };
      } catch (error) {
        cookieStore.set(sessionCookieName(), "", { ...firebaseCookieOptions, maxAge: 0 });
        return { error: authError(error) };
      }
    },
    signInWithOAuth: async (input: { provider: string; options: { redirectTo: string } }) => {
      try {
        if (input.provider !== "github") throw new Error("Unsupported identity provider.");
        const result = await firebaseAuthRequest<{ authUri: string; sessionId: string }>("accounts:createAuthUri", {
          providerId: "github.com", continueUri: `${getAppUrl()}/auth/callback`, oauthScope: "read:user user:email", sessionId: randomBytes(32).toString("base64url"),
        });
        const url = new URL(result.authUri);
        const state = url.searchParams.get("state");
        if (url.protocol !== "https:" || url.hostname !== "github.com" || !state || !result.sessionId) throw new Error("Invalid GitHub authorization response.");
        cookieStore.set("aam_firebase_oauth", JSON.stringify({ state, sessionId: result.sessionId, redirectTo: input.options.redirectTo }), { ...firebaseCookieOptions, maxAge: 600 });
        return { data: { url: url.toString() }, error: null };
      } catch (error) { return { data: { url: null }, error: authError(error) }; }
    },
    exchangeCodeForSession: async (code: string, state: string | null) => {
      try {
        const stored = JSON.parse(cookieStore.get("aam_firebase_oauth")?.value ?? "{}");
        cookieStore.set("aam_firebase_oauth", "", { ...firebaseCookieOptions, maxAge: 0 });
        const received = Buffer.from(state ?? ""), expected = Buffer.from(stored.state ?? "");
        if (!received.length || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("OAuth state mismatch.");
        if (!stored.sessionId) throw new Error("OAuth session is missing.");
        const callback = new URL(`${getAppUrl()}/auth/callback`);
        callback.searchParams.set("code", code); callback.searchParams.set("state", state!);
        const result = await firebaseAuthRequest<{ idToken: string }>("accounts:signInWithIdp", { sessionId: stored.sessionId, requestUri: callback.toString(), returnSecureToken: true, autoCreate: false });
        return { data: { user: await establishSession(result.idToken), next: new URL(stored.redirectTo).searchParams.get("next") }, error: null };
      } catch (error) { return { data: null, error: authError(error) }; }
    },
    resetPasswordForEmail: async (email: string, options: { redirectTo: string; captchaToken: string }) => {
      try {
        if (!(await verifyCaptcha(options.captchaToken)).ok) throw new Error("CAPTCHA failed.");
        await firebaseAuthRequest("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email, continueUrl: `${getAppUrl()}/admin/login?reset=success` });
        return { error: null };
      } catch (error) { return { error: authError(error) }; }
    },
  };
  return { ...createFirebaseAdminClient(), auth };
};

export const createFirebasePublicClient = () => createDataClient(true);
