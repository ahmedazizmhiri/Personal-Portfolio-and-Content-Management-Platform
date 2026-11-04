import "server-only";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { Firestore } from "@google-cloud/firestore";
import { usesVercelFederation, vercelFirebaseCredential, vercelGoogleAuth } from "./vercel-credentials";
import { assertFirebaseAdminEnv, firebaseEnv } from "./config";

export const getFirebaseApp = () => {
  assertFirebaseAdminEnv();
  if (process.env.NODE_ENV === "production" && ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"].some((key) => process.env[key])) throw new Error("Firebase emulators are forbidden in production.");
  const existing = getApps().find((app) => app.name === "portfolio");
  if (existing) return existing;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (Boolean(clientEmail) !== Boolean(privateKey)) throw new Error("Configure both FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.");
  return initializeApp({
    projectId: firebaseEnv.projectId,
    storageBucket: firebaseEnv.storageBucket || undefined,
    credential: usesVercelFederation() ? vercelFirebaseCredential() : clientEmail && privateKey ? cert({ projectId: firebaseEnv.projectId, clientEmail, privateKey }) : applicationDefault(),
  }, "portfolio");
};

export const firebaseAuth = () => getAuth(getFirebaseApp());
let federatedFirestore: Firestore | undefined;
export const firestore = () => {
  getFirebaseApp();
  if (!usesVercelFederation()) return getFirestore(getFirebaseApp());
  federatedFirestore ??= new Firestore({ projectId: firebaseEnv.projectId, auth: vercelGoogleAuth() });
  return federatedFirestore;
};
export const firebaseBucket = () => getStorage(getFirebaseApp()).bucket();
