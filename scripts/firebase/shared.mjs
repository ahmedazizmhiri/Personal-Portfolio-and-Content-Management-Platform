import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const collections = ["profile", "hero", "about", "skills", "projects", "project_sections", "project_section_items", "project_media", "project_links", "project_uploads", "project_slug_history", "project_section_definitions", "experience", "education", "certifications", "resumes", "social_links", "site_settings", "contact_messages", "uploads", "pages", "page_sections", "page_section_items", "volunteering", "admins", "admin_security_preferences", "admin_audit_logs", "cms_content_revisions", "cms_builder_action_requests", "site_profile", "value_cards", "experiences", "skill_clusters"];
export const buckets = ["public-assets", "project-images", "resumes", "uploads"];
export const primaryKey = (table) => table === "site_settings" ? "key" : ["admins", "admin_security_preferences"].includes(table) ? "user_id" : "id";
export const documentKey = (table, row) => {
  if (["project_uploads", "cms_builder_action_requests"].includes(table)) {
    const parts = table === "project_uploads" ? [row.project_id, row.upload_id, row.usage] : [row.actor_user_id, row.idempotency_key];
    if (parts.some((part) => typeof part !== "string" || !part)) throw new Error(`Invalid ${table} composite key.`);
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }
  const raw = row[primaryKey(table)];
  const value = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
  if (typeof value !== "string" || !value || value.includes("/") || [".", ".."].includes(value)) throw new Error(`Invalid ${table} document key.`);
  return value;
};
export const loadLocalEnv = () => {
  const file = path.resolve(".env.local");
  if (fs.existsSync(file)) process.loadEnvFile(file);
};
export const getAdmin = (projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) => {
  if (!projectId) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is required.");
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (Boolean(clientEmail) !== Boolean(privateKey)) throw new Error("Both Firebase service-account environment variables are required.");
  const app = getApps().find((item) => item.name === "migration") ?? initializeApp({ projectId, storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, credential: clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : applicationDefault() }, "migration");
  return { app, db: getFirestore(app), auth: getAuth(app), storage: getStorage(app) };
};
export const publicUrl = (storageBucket, bucket, objectPath) => `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(`${bucket}/${objectPath}`)}?alt=media`;

export const rewriteStorageReferences = (value, sourceOrigin, storageBucket) => {
  if (typeof value === "string") {
    // Handles both plain fields and URLs embedded in rich-text/JSON strings.
    const escapedOrigin = sourceOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedOrigin}/storage/v1/object/public/([^/\\s"'<>]+)/([^\\s"'<>?#]+)(?:\\?[^\\s"'<>]*)?`, "g");
    return value.replace(pattern, (_match, bucket, objectPath) => {
      const decodedBucket = decodeURIComponent(bucket);
      if (!buckets.includes(decodedBucket) || decodedBucket === "uploads") throw new Error("Unexpected public source bucket.");
      return publicUrl(storageBucket, decodedBucket, objectPath.split("/").map(decodeURIComponent).join("/"));
    });
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStorageReferences(item, sourceOrigin, storageBucket));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteStorageReferences(item, sourceOrigin, storageBucket)]));
  return value;
};
