import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { generate } from "otplib";
import type { Firestore } from "firebase-admin/firestore";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
  set: (name: string, value: string) => { cookieJar.set(name, value); },
}) }));

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
// Never run these mutations against a live Firebase project, even if the
// environment is accidentally pointed at production.
const isolated = /^127\.0\.0\.1:\d+$/.test(emulatorHost) && /^127\.0\.0\.1:\d+$/.test(authHost) && projectId.startsWith("demo-");

describe.skipIf(!isolated)("Firebase emulators: complete data and auth flows", () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
  let db: Firestore;
  let adminModule: typeof import("@/lib/firebase/admin");
  let serverModule: typeof import("@/lib/firebase/server");
  let mutations: typeof import("@/lib/firebase/mutations");
  const userId = "11111111-1111-4111-8111-111111111111";
  const password = "EmulatorOnlyPassword123!";
  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", projectId);
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "emulator-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", `${projectId}.firebasestorage.app`);
    vi.stubEnv("FIREBASE_MFA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", ""); vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    vi.stubEnv("CAPTCHA_TEST_BYPASS_TOKEN", "integration-captcha");
    adminModule = await import("@/lib/firebase/admin");
    serverModule = await import("@/lib/firebase/server");
    mutations = await import("@/lib/firebase/mutations");
    db = adminModule.firestore();
    await adminModule.firebaseAuth().createUser({ uid: userId, email: "admin@example.test", password, emailVerified: true });
    await db.collection("admins").doc(userId).set({ user_id: userId });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    vi.unstubAllEnvs();
  });
  it("denies direct anonymous and authenticated Firestore access", async () => {
    const endpoint = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents/contact_messages`;
    const anonymous = await fetch(endpoint);
    expect(anonymous.status).toBe(403);
    const login = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password, returnSecureToken: true }) });
    const token = await login.json();
    expect(login.ok).toBe(true);
    const authenticated = await fetch(endpoint, { headers: { Authorization: `Bearer ${token.idToken}` } });
    expect(authenticated.status).toBe(403);
  });
  it("commits only one concurrent optimistic edit and its revision", async () => {
    const client = adminModule.createFirebaseAdminClient();
    const created = await client.rpc("mutate_cms_content", { p_actor_user_id: userId, p_table: "projects", p_operation: "create", p_values: { title: "Emulator project", slug: "emulator-project", summary: "Private draft", status: "draft", published: false } });
    expect(created.error).toBeNull();
    const row = created.data!.row;
    const edits = await Promise.all(["First edit", "Second edit"].map((title) => client.rpc("mutate_cms_content", { p_actor_user_id: userId, p_table: "projects", p_operation: "update", p_record_id: row.id, p_expected_updated_at: row.updated_at, p_values: { title } })));
    expect(edits.filter((result) => !result.error)).toHaveLength(1);
    expect(edits.find((result) => result.error)?.error?.code).toBe("CMS02");
    expect((await db.collection("cms_content_revisions").get()).size).toBe(2);
    expect((await serverModule.createFirebasePublicClient().from("projects").select("id")).data).toEqual([]);
    expect((await serverModule.createFirebasePublicClient().from("projects").insert({ title: "Forbidden" })).error?.code).toBe("permission-denied");
  });
  it("exposes public files while denying private files, client uploads, and listings", async () => {
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST!;
    const bucket = adminModule.firebaseBucket();
    await bucket.file("public-assets/test.txt").save(Buffer.from("public fixture"));
    await bucket.file("uploads/private.txt").save(Buffer.from("private fixture"));
    const base = `http://${host}/v0/b/${bucket.name}/o`;
    const publicFile = await fetch(`${base}/public-assets%2Ftest.txt?alt=media`);
    expect(publicFile.status).toBe(200);
    expect(await publicFile.text()).toBe("public fixture");
    expect([401, 403]).toContain((await fetch(`${base}/uploads%2Fprivate.txt?alt=media`)).status);
    expect([401, 403]).toContain((await fetch(base)).status);
    const write = await fetch(`${base}?name=public-assets%2Fforbidden.txt`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "forbidden" });
    expect([401, 403]).toContain(write.status);
  });
  it("acquires exactly one contact delivery claim and enforces durable limits", async () => {
    const client = adminModule.createFirebaseAdminClient();
    const inserted = await client.from("contact_messages").insert({ name: "Visitor", email: "visitor@example.test", message: "Hello from the emulator" }).select("id").single();
    expect(inserted.error).toBeNull();
    const claims = await Promise.all([1, 2].map(() => client.from("contact_messages").update({ delivery_status: "sending" }).eq("id", inserted.data!.id).eq("delivery_status", "pending").select("id").maybeSingle()));
    expect(claims.filter((result) => result.data)).toHaveLength(1);
    const results = await Promise.all(Array.from({ length: 6 }, () => mutations.runMutation("consume_rate_limit", { p_scope: "integration", p_key_hash: "test-key", p_limit: 3, p_window_seconds: 60 })));
    expect(results.every((result) => !result.error)).toBe(true);
    expect(results.filter((result) => result.data?.allowed)).toHaveLength(3);
  });
  it("signs in, encrypts and verifies TOTP, rejects replay, and revokes a stolen session on logout", async () => {
    const client = await serverModule.createFirebaseServerClient();
    const login = await client.auth.signInWithPassword({ email: "admin@example.test", password, options: { captchaToken: "integration-captcha" } });
    expect(login.error).toBeNull();
    expect(login.data.user?.id).toBe(userId);
    const enrollment = await client.auth.mfa.enroll({ factorType: "totp", issuer: "Portfolio integration" });
    expect(enrollment.error).toBeNull();
    const factor = enrollment.data!;
    const stored = (await db.collection("_admin_mfa").doc(userId).get()).data();
    expect(JSON.stringify(stored)).not.toContain(factor.totp.secret);
    expect(factor.totp.qr_code).toMatch(/^data:image\/png/);
    const code = await generate({ secret: factor.totp.secret });
    expect((await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code })).error).toBeNull();
    expect((await client.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel).toBe("aal2");
    expect((await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code })).error).toBeTruthy();
    const stolenCookie = cookieJar.get(serverModule.sessionCookieName())!;
    expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    cookieJar.set(serverModule.sessionCookieName(), stolenCookie);
    const stolen = await serverModule.createFirebaseServerClient();
    expect((await stolen.auth.getUser()).data.user).toBeNull();
  });
  it("imports, resumes, verifies, and refuses conflicting target content", async () => {
    const { collections } = await import("../../scripts/firebase/shared.mjs");
    const artifactRoot = path.resolve(".artifacts");
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(path.join(artifactRoot, "firebase-import-test-"));
    const execute = promisify(execFile);
    try {
      await mkdir(path.join(directory, "objects"));
      const tables: Record<string, unknown[]> = {};
      for (const table of collections) tables[table] = (await db.collection(table).get()).docs.map((doc) => doc.data());
      const project = { id: "22222222-2222-4222-8222-222222222222", title: "Transfer fixture", slug: "transfer-fixture", summary: "Import test", status: "draft", published: false, deletion_status: "active", updated_at: new Date().toISOString() };
      tables.projects.push(project);
      const bytes = Buffer.from("migration checksum fixture");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const filename = createHash("sha256").update("storage fixture").digest("hex");
      await writeFile(path.join(directory, "objects", filename), bytes);
      await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: 1, sourceOrigin: "https://source.supabase.co", tables, users: [{ uid: "33333333-3333-4333-8333-333333333333", email: "transfer@example.test", emailVerified: true, providerData: [] }], objects: [{ bucket: "public-assets", path: "migration.txt", file: filename, sha256, size: bytes.length, contentType: "text/plain" }] }));
      const command = ["scripts/firebase/import-firebase.mjs", directory, `--project=${projectId}`];
      const dry = await execute(process.execPath, command, { env: process.env });
      expect(dry.stdout).toContain("No Firebase connection or writes were made");
      expect((await db.collection("projects").doc(project.id).get()).exists).toBe(false);
      await execute(process.execPath, [...command, "--apply"], { env: process.env });
      await execute(process.execPath, [...command, "--apply"], { env: process.env });
      const verified = await execute(process.execPath, [...command, "--verify"], { env: process.env });
      expect(verified.stdout).toContain("Verification passed");
      expect((await adminModule.firebaseAuth().getUser("33333333-3333-4333-8333-333333333333")).email).toBe("transfer@example.test");
      await db.collection("projects").doc(project.id).update({ title: "Newer target content" });
      await expect(execute(process.execPath, [...command, "--apply"], { env: process.env })).rejects.toThrow("Target conflict");
      expect((await db.collection("projects").doc(project.id).get()).data()?.title).toBe("Newer target content");
      const repositoryManifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
      repositoryManifest.assetMode = "repository";
      repositoryManifest.objects = [];
      repositoryManifest.tables.projects.find((row: { id: string }) => row.id === project.id).title = "Newer target content";
      const logo = await readFile("public/logo.png");
      repositoryManifest.repositoryAssets = [{ path: "/logo.png", size: logo.length, sha256: createHash("sha256").update(logo).digest("hex") }];
      repositoryManifest.archiveTables = { _source_uploads: [{ id: "44444444-4444-4444-8444-444444444444", public_url: "https://source.supabase.co/storage/v1/object/public/project-images/old.png" }], _source_project_uploads: [{ project_id: project.id, upload_id: "44444444-4444-4444-8444-444444444444", usage: "cover" }] };
      await writeFile(path.join(directory, "manifest.json"), JSON.stringify(repositoryManifest));
      const repositoryEnvironment = { ...process.env, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "" };
      await execute(process.execPath, [...command, "--apply"], { env: repositoryEnvironment });
      const repositoryVerified = await execute(process.execPath, [...command, "--verify"], { env: repositoryEnvironment });
      expect(repositoryVerified.stdout).toContain("Verification passed");
      expect((await db.collection("_source_uploads").get()).size).toBe(1);
    } finally {
      if (!directory.startsWith(`${artifactRoot}${path.sep}`)) throw new Error("Unexpected fixture directory.");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
