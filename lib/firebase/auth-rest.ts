import "server-only";
import { firebaseEnv } from "./config";

export const firebaseAuthRequest = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  if (!firebaseEnv.apiKey) throw new Error("Firebase Web API key is not configured.");
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator && process.env.NODE_ENV === "production") throw new Error("Auth emulator is forbidden in production.");
  const origin = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  const response = await fetch(`${origin}/v1/${method}?key=${encodeURIComponent(firebaseEnv.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error("Firebase authentication failed."), { code: result.error?.message?.split(" : ")[0] ?? "auth_failed" });
  return result as T;
};
