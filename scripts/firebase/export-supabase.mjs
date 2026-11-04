import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buckets, collections, loadLocalEnv, primaryKey } from "./shared.mjs";

loadLocalEnv();
const output = path.resolve(process.argv[2] ?? ".artifacts/firebase-migration");
const snapshotPath = process.argv.find((arg) => arg.startsWith("--database-snapshot="))?.slice("--database-snapshot=".length);
const databaseSnapshot = snapshotPath ? JSON.parse(await fs.readFile(path.resolve(snapshotPath), "utf8")) : null;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Source NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the read-only export.");
if (new URL(url).protocol !== "https:") throw new Error("Source Supabase URL must use HTTPS.");
const manifestFile = path.join(output, "manifest.json");
try { await fs.access(manifestFile); throw new Error("An export already exists here. Use a new output directory."); } catch (error) { if (error.code !== "ENOENT") throw error; }
await fs.mkdir(path.join(output, "objects"), { recursive: true });
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const request = async (endpoint, options = {}) => {
  const response = await fetch(`${url}${endpoint}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(response.status === 402
    ? "Supabase returned HTTP 402. The source project owner must restore quota/billing access before the backup can complete."
    : `Source export failed: HTTP ${response.status}. No complete manifest was produced.`);
  return response;
};
const manifest = { version: 1, sourceOrigin: new URL(url).origin, exportedAt: new Date().toISOString(), tables: {}, users: [], objects: [] };
if (databaseSnapshot && databaseSnapshot.sourceOrigin !== manifest.sourceOrigin) throw new Error("Database snapshot source does not match the configured Supabase project.");
for (const table of collections) {
  if (databaseSnapshot) {
    if (!Array.isArray(databaseSnapshot.tables[table])) throw new Error(`Database snapshot is missing ${table}.`);
    manifest.tables[table] = databaseSnapshot.tables[table];
    continue;
  }
  // Requests are session-scoped idempotency state, not portfolio content.
  // The source deliberately exposes no Data API grants for this table.
  if (table === "cms_builder_action_requests") { manifest.tables[table] = []; continue; }
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const order = table === "project_uploads" ? "project_id.asc,upload_id.asc,usage.asc" : `${primaryKey(table)}.asc`;
    const response = await request(`/rest/v1/${table}?select=*&order=${order}&offset=${offset}&limit=500`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Invalid ${table} export.`);
    rows.push(...page);
    if (page.length < 500) break;
  }
  manifest.tables[table] = rows;
  console.log(`${table}: ${rows.length} rows exported.`);
}
if (databaseSnapshot) manifest.users = databaseSnapshot.users;
for (let page = 1; !databaseSnapshot; page++) {
  const result = await (await request(`/auth/v1/admin/users?page=${page}&per_page=500`)).json();
  if (!Array.isArray(result.users)) throw new Error("Invalid auth-user export.");
  manifest.users.push(...result.users.map((user) => ({
    uid: user.id, email: user.email || undefined, emailVerified: Boolean(user.email_confirmed_at),
    disabled: Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now()),
    displayName: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
    providerData: (user.identities ?? []).filter((identity) => identity.provider === "github").map((identity) => ({ providerId: "github.com", uid: String(identity.identity_data?.sub ?? identity.id), email: identity.identity_data?.email || user.email || undefined })),
  })));
  if (result.users.length < 500) break;
}
const downloadObject = async (bucket, objectPath) => {
  const response = await request(`/storage/v1/object/authenticated/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = createHash("sha256").update(`${bucket}\0${objectPath}`).digest("hex");
  await fs.writeFile(path.join(output, "objects", filename), bytes);
  manifest.objects.push({ bucket, path: objectPath, file: filename, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, contentType: response.headers.get("content-type") || "application/octet-stream" });
};
if (databaseSnapshot) {
  for (const object of databaseSnapshot.storageObjects) {
    if (!buckets.includes(object.bucket)) throw new Error("Unsupported snapshot storage bucket.");
    await downloadObject(object.bucket, object.path);
  }
}
for (const bucket of databaseSnapshot ? [] : buckets) {
  const folders = [""];
  while (folders.length) {
    const prefix = folders.shift();
    for (let offset = 0; ; offset += 100) {
      const result = await (await request(`/storage/v1/object/list/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }) })).json();
      if (!Array.isArray(result)) throw new Error(`Invalid storage listing: ${bucket}.`);
      for (const object of result) {
        const objectPath = prefix ? `${prefix}/${object.name}` : object.name;
        if (!object.id) { folders.push(objectPath); continue; }
        await downloadObject(bucket, objectPath);
      }
      if (result.length < 100) break;
    }
  }
}
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(`Read-only export completed: ${manifest.users.length} users, ${manifest.objects.length} files. Snapshot contains private data; keep it outside version control.`);
