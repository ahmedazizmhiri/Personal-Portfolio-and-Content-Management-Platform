import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buckets, collections, documentKey, getAdmin, loadLocalEnv, rewriteStorageReferences } from "./shared.mjs";

loadLocalEnv();
const args = process.argv.slice(2);
const sourceDirectory = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? ".artifacts/firebase-migration");
const target = args.find((arg) => arg.startsWith("--project="))?.slice(10);
const apply = args.includes("--apply");
const verifyOnly = args.includes("--verify");
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
if (!target || target !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new Error("Pass --project=<id> matching NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
const manifest = JSON.parse(await fs.readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
if (manifest.version !== 1 || !manifest.tables || !Array.isArray(manifest.users) || !Array.isArray(manifest.objects)) throw new Error("Invalid migration manifest.");
const repositoryMode = manifest.assetMode === "repository";
if (!repositoryMode && !storageBucket) throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is required; copy its actual value from Firebase Console.");
if (repositoryMode && manifest.objects.length) throw new Error("Repository mode must not contain cloud Storage objects.");
const migrated = repositoryMode ? structuredClone(manifest.tables) : rewriteStorageReferences(manifest.tables, manifest.sourceOrigin, storageBucket);
const archiveNames = repositoryMode ? Object.keys(manifest.archiveTables ?? {}) : [];
if (archiveNames.some((table) => !["_source_uploads", "_source_project_uploads"].includes(table))) throw new Error("Unexpected archive collection.");
for (const table of archiveNames) migrated[table] = manifest.archiveTables[table];
const migrationCollections = [...collections, ...archiveNames];
for (const asset of repositoryMode ? manifest.repositoryAssets ?? [] : []) {
  const root = path.resolve("public");
  const file = path.resolve(root, `.${asset.path}`);
  if (!asset.path.startsWith("/") || !file.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe repository asset.");
  const bytes = await fs.readFile(file);
  if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Repository asset checksum mismatch.");
}
let rowCount = 0;
for (const table of migrationCollections) {
  if (!Array.isArray(migrated[table])) throw new Error(`Missing collection ${table}.`);
  const keys = new Set();
  for (const row of migrated[table]) {
    const key = documentKey(table === "_source_project_uploads" ? "project_uploads" : table, row);
    if (keys.has(key)) throw new Error(`Duplicate ${table} document key.`);
    keys.add(key);
    if (Buffer.byteLength(JSON.stringify(row)) > 900000) throw new Error(`A ${table} document exceeds the migration size limit.`);
    const historical = repositoryMode && ["cms_content_revisions", "admin_audit_logs", ...archiveNames].includes(table);
    if (!historical && JSON.stringify(row).includes(`${manifest.sourceOrigin}/storage/`)) throw new Error(`An unsupported source storage URL remains in ${table}.`);
    rowCount++;
  }
}
for (const object of manifest.objects) {
  if (!buckets.includes(object.bucket) || !object.path || object.path.startsWith("/") || object.path.split("/").some((part) => [".", ".."].includes(part)) || object.path.includes("\\") || !/^[a-f0-9]{64}$/.test(object.file)) throw new Error("Invalid storage manifest entry.");
  const bytes = await fs.readFile(path.join(sourceDirectory, "objects", object.file));
  if (bytes.length !== object.size || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error("Storage snapshot checksum mismatch.");
}
console.log(`${apply ? "Import" : verifyOnly ? "Verify" : "Dry run"}: ${rowCount} documents, ${manifest.users.length} users, ${manifest.objects.length} files → ${target}.`);
if (!apply && !verifyOnly) {
  console.log("Snapshot validation passed. No Firebase connection or writes were made. Add --apply after reviewing the snapshot and taking a target backup.");
  process.exit(0);
}
const { db, auth, storage } = getAdmin(target);
const bucket = repositoryMode ? null : storage.bucket(storageBucket);
// Preflight the entire target before writing anything. Identical records are
// accepted for a restart; conflicting target content is never overwritten.
const pending = [];
for (const table of migrationCollections) {
  const snapshot = await db.collection(table).get();
  const existing = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
  for (const row of migrated[table]) {
    const id = documentKey(table === "_source_project_uploads" ? "project_uploads" : table, row);
    if (existing.has(id)) {
      if (!isDeepEqual(existing.get(id), row)) throw new Error(`Target conflict in ${table}; no documents have been imported.`);
    } else {
      if (verifyOnly) throw new Error(`Target is missing a ${table} document.`);
      pending.push({ table, id, row });
    }
  }
  if (verifyOnly && snapshot.size !== migrated[table].length) throw new Error(`Target count differs for ${table}. Run final verification before allowing new writes.`);
}
const pendingUsers = [];
for (const user of manifest.users) {
  try {
    const existing = await auth.getUser(user.uid);
    if (existing.email?.toLowerCase() !== user.email?.toLowerCase()) throw new Error("Target Firebase UID belongs to a different account.");
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    if (verifyOnly) throw new Error("Target auth user is missing.");
    if (user.email) {
      try { await auth.getUserByEmail(user.email); throw new Error("Target email already exists with a different UID. Resolve account mapping before migration."); }
      catch (emailError) { if (emailError.code !== "auth/user-not-found") throw emailError; }
    }
    pendingUsers.push(user);
  }
}
const pendingObjects = [];
for (const object of manifest.objects) {
  const file = bucket.file(`${object.bucket}/${object.path}`);
  const [exists] = await file.exists();
  if (exists) {
    const [bytes] = await file.download();
    if (createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error("Target storage conflict; existing file differs from the source.");
  } else {
    if (verifyOnly) throw new Error("Target storage object is missing.");
    pendingObjects.push(object);
  }
}
if (verifyOnly) { console.log("Verification passed: every document, user identity, and file checksum matches the snapshot."); process.exit(0); }
// Users and files precede content. Partial runs can be safely resumed.
for (let offset = 0; offset < pendingUsers.length; offset += 500) {
  const result = await auth.importUsers(pendingUsers.slice(offset, offset + 500));
  if (result.failureCount) throw new Error(`Firebase rejected ${result.failureCount} user imports; first code: ${result.errors[0]?.error.code}.`);
}
for (const object of pendingObjects) {
  await bucket.file(`${object.bucket}/${object.path}`).save(await fs.readFile(path.join(sourceDirectory, "objects", object.file)), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: object.contentType, cacheControl: object.bucket === "uploads" ? "private, no-store" : "public, max-age=3600" } });
}
for (let offset = 0; offset < pending.length; offset += 400) {
  const batch = db.batch();
  for (const { table, id, row } of pending.slice(offset, offset + 400)) batch.create(db.collection(table).doc(id), row);
  await batch.commit();
}
console.log("Import completed. Run this command with --verify, then test the application before switching production. Passwords, sessions, and MFA factors were not imported: email users must reset passwords and admins must re-enroll MFA.");

function isDeepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).sort(), otherKeys = Object.keys(b).sort();
  return keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && isDeepEqual(a[key], b[key]));
}
