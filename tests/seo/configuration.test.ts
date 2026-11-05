import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("public SEO configuration", () => {
  it("uses environment-only search verification values", () => {
    const metadataSource = readRepositoryFile("config/index.ts");

    expect(metadataSource).toContain(
      "process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION?.trim()",
    );
    expect(metadataSource).toContain(
      "process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim()",
    );
    expect(metadataSource).not.toMatch(
      /NEXT_PUBLIC_(?:BING|GOOGLE)_SITE_VERIFICATION\s*\|\|/,
    );
    expect(existsSync(resolve(process.cwd(), "public/BingSiteAuth.xml"))).toBe(
      false,
    );
  });

  it("restricts optimized remote images to Firebase Storage and public Vercel Blob", () => {
    const nextConfig = readRepositoryFile("next.config.js");
    expect(nextConfig).toContain('hostname: "firebasestorage.googleapis.com"');
    expect(nextConfig).toContain('encodeURIComponent(firebaseStorageBucket)');
    expect(nextConfig).toContain('remotePatterns: [...firebaseImagePatterns,');
    expect(nextConfig).toContain('hostname: "**.public.blob.vercel-storage.com"');
    expect(nextConfig).toContain('const blobPublicOrigin = "https://*.public.blob.vercel-storage.com"');
  });

  it("keeps fallback profile URLs in one shared identity configuration", () => {
    const portfolioSource = readRepositoryFile("constants/portfolio.ts");

    expect(portfolioSource).toContain("publicIdentity.linkedInUrl");
    expect(portfolioSource).toContain("publicIdentity.githubUrl");
    expect(portfolioSource).not.toContain("github.com/");
    expect(portfolioSource).not.toContain(
      "linkedin.com/in/ahmed-aziz-mhiri",
    );
  });
});
