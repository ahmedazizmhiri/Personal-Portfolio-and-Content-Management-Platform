import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("cookie-only admin authentication architecture", () => {
  it("does not serialize or send Supabase access tokens", () => {
    const adminPage = source("app/admin/page.tsx");
    const adminApi = source("components/admin/admin-api.ts");
    const dashboard = source("components/admin/admin-dashboard.tsx");
    const adminAuth = source("lib/security/admin-auth.ts");
    const combined = [adminPage, adminApi, dashboard, adminAuth].join("\n");

    expect(combined).not.toMatch(/accessToken|access_token/);
    expect(combined).not.toMatch(/Authorization\s*[:=]/);
    expect(combined).not.toMatch(/getSession\s*\(/);
    expect(combined).not.toMatch(/refreshSession\s*\(/);
    expect(combined).not.toMatch(/createFirebaseBrowserClient/);
  });

  it("keeps admin identity verification on server getUser", () => {
    const adminAuth = source("lib/security/admin-auth.ts");
    expect(adminAuth).toMatch(/firebase\.auth\.getUser\s*\(/);
    expect(adminAuth).not.toMatch(/Bearer/);
  });

  it("does not subscribe to privileged browser Realtime channels", () => {
    const dashboard = source("components/admin/admin-dashboard.tsx");
    expect(dashboard).not.toMatch(/postgres_changes|\.channel\s*\(/);
  });
});
