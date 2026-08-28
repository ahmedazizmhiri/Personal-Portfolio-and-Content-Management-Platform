import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fallbackPortfolioContent } from "@/data/fallback-portfolio";
import { resolveCmsPageRoute } from "@/lib/cms-page-routing";
import type { PageContent, PortfolioContent } from "@/lib/cms-types";

const publishedPage: PageContent = {
  id: "page-about",
  pageKey: "about",
  title: "About",
  slug: "/about",
  seoTitle: "About",
  seoDescription: "Published About page.",
  openGraphTitle: "About",
  openGraphDescription: "Published About page.",
  openGraphImage: "/opengraph-image",
  navigationLabel: "About",
  navigationOrder: 40,
  showInNavigation: true,
  showInFooter: true,
  isPublished: true,
  updatedAt: "2026-07-29T00:00:00.000Z",
  sections: [],
};

const snapshot = (
  pages: PageContent[],
  registry: PortfolioContent["delivery"]["pages"],
) => ({
  pages,
  delivery: {
    ...fallbackPortfolioContent.delivery,
    source: "cms" as const,
    pages: registry,
  },
});

describe("canonical CMS page routing", () => {
  it("uses Page Builder for a confirmed published page, even with no blocks", () => {
    expect(resolveCmsPageRoute(snapshot([publishedPage], "ok"), "about")).toEqual({
      mode: "cms",
      page: publishedPage,
    });
  });

  it("fails closed after a successful registry read omits the page", () => {
    expect(resolveCmsPageRoute(snapshot([], "ok"), "about")).toEqual({
      mode: "not-found",
      page: null,
    });
    expect(
      resolveCmsPageRoute(
        snapshot([{ ...publishedPage, isPublished: false }], "ok"),
        "about",
      ),
    ).toEqual({ mode: "not-found", page: null });
  });

  it("permits specialized legacy content only when the registry read failed", () => {
    expect(
      resolveCmsPageRoute(snapshot([publishedPage], "failed"), "about"),
    ).toEqual({ mode: "legacy-fallback", page: null });
  });

  it("wires every code-owned canonical route through the same boundary", () => {
    const routes = {
      "app/page.tsx": "home",
      "app/about/page.tsx": "about",
      "app/expertise/page.tsx": "expertise",
      "app/projects/page.tsx": "projects",
      "app/experience/page.tsx": "experience",
      "app/education/page.tsx": "education",
      "app/certifications/page.tsx": "certifications",
      "app/resume/page.tsx": "resume",
      "app/contact/page.tsx": "contact",
    } as const;

    for (const [path, pageKey] of Object.entries(routes)) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");

      expect(source).toContain(
        `resolveCmsPageRoute(content, "${pageKey}")`,
      );
      expect(source).toContain('route.mode === "not-found"');
      expect(source).toContain('route.mode === "cms"');
      expect(source).toContain("<CmsPageSections");
    }
  });

  it("keeps the server-persisted contact form available on the CMS route", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/contact/page.tsx"),
      "utf8",
    );

expect(source).toMatch(
  /<CmsPageSections[\s\S]*?<Contact[\s\S]*?profile=\{content\.profile\}[\s\S]*?socialLinks=\{content\.socialLinks\}[\s\S]*?\/>/,
);
  });
});
