import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { collections } from "./shared.mjs";

const input = path.resolve(process.argv[2] ?? ".artifacts/firebase-migration-baseline/database-snapshot.json");
const output = path.resolve(process.argv[3] ?? ".artifacts/firebase-repository-migration");
const snapshot = JSON.parse(await fs.readFile(input, "utf8"));
const configuration = JSON.parse(await fs.readFile("firebase/repository-assets.json", "utf8"));
const tables = structuredClone(snapshot.tables);
const replacements = new Map();
const files = new Map();
for (const upload of snapshot.tables.uploads) {
  const replacement = configuration.replacements[upload.id] ?? "";
  if (replacement) {
    if (!replacement.startsWith("/") || replacement.startsWith("//") || replacement.includes("\\") || replacement.split("/").includes("..")) throw new Error("Unsafe repository asset path.");
    const root = path.resolve("public");
    const file = path.resolve(root, `.${replacement}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Repository asset escaped public directory.");
    const bytes = await fs.readFile(file);
    files.set(replacement, { path: replacement, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
  }
  if (upload.public_url) replacements.set(upload.public_url, replacement);
}
const rewrite = (value) => {
  if (typeof value === "string") {
    for (const [source, replacement] of replacements) value = value.replaceAll(source, replacement);
    if (value.includes(`${snapshot.sourceOrigin}/storage/`)) throw new Error("Unmapped source Storage reference in active content.");
    return value;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  return value;
};
for (const table of collections) {
  if (["uploads", "project_uploads", "cms_content_revisions", "admin_audit_logs"].includes(table)) continue;
  tables[table] = rewrite(tables[table]);
}
// Source upload metadata and relationships remain available in private archive
// collections. Missing cloud files must never be offered as active uploads.
const archiveTables = { _source_uploads: tables.uploads, _source_project_uploads: tables.project_uploads };
tables.uploads = []; tables.project_uploads = [];
if (configuration.unpublishResumes) tables.resumes = tables.resumes.map((row) => ({ ...row, published: false, pdf_url: "", docx_url: "" }));
const manifest = { version: 1, assetMode: "repository", sourceOrigin: snapshot.sourceOrigin, exportedAt: snapshot.exportedAt, preparedAt: new Date().toISOString(), tables, archiveTables, users: snapshot.users, objects: [], repositoryAssets: [...files.values()], notes: ["Existing local company/site assets replace inaccessible images.", "Malt/Upwork use local icon components; the unavailable volunteering logo falls back to its organization name.", "CV records are preserved but unpublished after the legacy English/French review found outdated dates and a missing current role; no Italian source file was found.", "Original revisions and audit records are preserved, including historical source URLs as plain data."] };
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ mode: manifest.assetMode, documentCount: Object.values(tables).reduce((count, rows) => count + rows.length, 0), archivedUploadRows: archiveTables._source_uploads.length, archivedRelations: archiveTables._source_project_uploads.length, localAssets: files.size, users: manifest.users.length, unpublishedCvRows: tables.resumes.length, output }, null, 2));
