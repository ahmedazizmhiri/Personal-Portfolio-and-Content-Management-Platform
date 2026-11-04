import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { firestore } from "./core";

const encryptionKey = () => {
  const key = Buffer.from(process.env.FIREBASE_MFA_ENCRYPTION_KEY?.trim() ?? "", "base64");
  if (key.length !== 32) throw new Error("FIREBASE_MFA_ENCRYPTION_KEY must contain 32 random bytes encoded as base64.");
  return key;
};
export const encryptMfaSecret = (secret: string, userId: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  return [iv, cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()].map((part) => part.toString("base64")).join(".");
};
const decryptSecret = (value: string, userId: string) => {
  const [iv, encrypted, final, tag] = value.split(".").map((part) => Buffer.from(part, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.concat([encrypted, final])), cipher.final()]).toString("utf8");
};
export type Factor = { id: string; factor_type: "totp"; status: "verified" | "unverified"; friendly_name: string };
export const listMfaFactors = async (userId: string): Promise<Factor[]> => {
  const doc = await firestore().collection("_admin_mfa").doc(userId).get();
  const data = doc.data();
  return data ? [{ id: data.id, factor_type: "totp", status: data.verified ? "verified" : "unverified", friendly_name: "Authenticator" }] : [];
};
export const enrollMfa = async (userId: string, email: string, issuer: string) => {
  const secret = generateSecret();
  const id = randomUUID();
  const uri = generateURI({ issuer, label: email, secret });
  const ref = firestore().collection("_admin_mfa").doc(userId);
  await firestore().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) throw new Error("An authenticator is already enrolled.");
    transaction.create(ref, { id, secret: encryptMfaSecret(secret, userId), verified: false, last_step: -1, created_at: Date.now() });
  });
  return { id, type: "totp", totp: { secret, uri, qr_code: await QRCode.toDataURL(uri) } };
};
export const verifyMfa = async (userId: string, factorId: string, code: string, sessionId: string) => {
  const factorRef = firestore().collection("_admin_mfa").doc(userId);
  const sessionRef = firestore().collection("_admin_sessions").doc(sessionId);
  await firestore().runTransaction(async (transaction) => {
    const [factorDoc, sessionDoc] = await Promise.all([transaction.get(factorRef), transaction.get(sessionRef)]);
    const factor = factorDoc.data(), session = sessionDoc.data();
    if (!factor || factor.id !== factorId || !session || session.revoked || session.uid !== userId || session.expires_at.toMillis() <= Date.now()) throw new Error("Invalid authenticator session.");
    if (!factor.verified && Date.now() - factor.created_at > 10 * 60 * 1000) throw new Error("Authenticator enrollment expired.");
    const result = await verify({ secret: decryptSecret(factor.secret, userId), token: code, strategy: "totp", epochTolerance: 30, ...(factor.last_step >= 0 ? { afterTimeStep: factor.last_step } : {}) });
    if (!result.valid || !("timeStep" in result)) throw new Error("Invalid authenticator code.");
    transaction.update(factorRef, { verified: true, last_step: result.timeStep });
    transaction.update(sessionRef, { mfa_verified_at: Date.now(), mfa_factor_id: factorId });
  });
};
export const removeMfa = async (userId: string, factorId: string, sessionId: string) => {
  const ref = firestore().collection("_admin_mfa").doc(userId);
  await firestore().runTransaction(async (transaction) => {
    const [factorDoc, sessionDoc] = await Promise.all([transaction.get(ref), transaction.get(firestore().collection("_admin_sessions").doc(sessionId))]);
    const factor = factorDoc.data(), session = sessionDoc.data();
    if (!factor || factor.id !== factorId) throw new Error("Authenticator not found.");
    if (factor.verified && (session?.mfa_factor_id !== factorId || Date.now() - session.mfa_verified_at > 5 * 60 * 1000)) throw new Error("Fresh MFA verification is required.");
    transaction.delete(ref);
  });
};
