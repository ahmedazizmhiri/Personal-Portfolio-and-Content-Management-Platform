import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type QueryRecord = {
  table: string;
  filters: Array<[string, unknown]>;
};

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  queries: [] as QueryRecord[],
  failures: new Set<string>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/lib/firebase/config", () => ({
  isFirebaseAdminConfigured: () => false,
  isFirebaseConfigured: () => true,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/firebase/server", () => ({
  createFirebasePublicClient: () => ({
    from: (table: string) => ({
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const order: Array<{ column: string; ascending: boolean }> = [];
        let limit: number | null = null;
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          order: (
            column: string,
            options?: { ascending?: boolean },
          ) => {
            order.push({
              column,
              ascending: options?.ascending !== false,
            });
            return query;
          },
          limit: (value: number) => {
            limit = value;
            return query;
          },
          then: (
            resolve: (result: {
              data: Row[] | null;
              error: { message: string } | null;
            }) => unknown,
          ) => {
            state.queries.push({
              table,
              filters: [...filters],
            });
            if (state.failures.has(table)) {
              return Promise.resolve({
                data: null,
                error: { message: "simulated read failure" },
              }).then(resolve);
            }
            let rows = [...(state.rows[table] ?? [])].filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            );
            for (const sort of [...order].reverse()) {
              rows.sort((left, right) => {
                const leftValue = Number(left[sort.column] ?? 0);
                const rightValue = Number(right[sort.column] ?? 0);
                return sort.ascending
                  ? leftValue - rightValue
                  : rightValue - leftValue;
              });
            }
            if (limit !== null) rows = rows.slice(0, limit);
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
        return query;
      },
    }),
  }),
  createFirebaseServerClient: vi.fn(),
}));

describe("public CMS publication boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("E2E_USE_FIXTURES", "false");
    state.queries.length = 0;
    state.failures.clear();
    state.rows = {
      projects: [
        {
          id: "project-published",
          slug: "published-evidence",
          title: "Published evidence",
          summary: "A complete and publicly approved case study.",
          published: true,
          status: "published",
          projects_page_order: 2,
          tags: ["Analytics"],
          tools: ["Power BI"],
        },
        {
          id: "project-draft",
          slug: "draft-evidence",
          title: "Draft evidence",
          summary: "This project must never cross the public boundary.",
          published: false,
          status: "draft",
          projects_page_order: 1,
        },
        {
          id: "project-inconsistent",
          slug: "inconsistent-evidence",
          title: "Inconsistent evidence",
          summary: "A status-only publication is still private.",
          published: false,
          status: "published",
          projects_page_order: 0,
        },
      ],
      project_sections: [
        {
          id: "section-published",
          project_id: "project-published",
          title: "Outcome",
          body: "Revenue visibility improved.",
          bullets: [],
          is_visible: true,
          is_archived: false,
          sort_order: 0,
        },
        {
          id: "section-draft",
          project_id: "project-draft",
          title: "Draft outcome",
          body: "Private work in progress.",
          bullets: [],
          is_visible: true,
          is_archived: false,
          sort_order: 0,
        },
        {
          id: "section-hidden",
          project_id: "project-published",
          title: "Hidden notes",
          body: "Internal-only material.",
          bullets: [],
          is_visible: false,
          is_archived: false,
          sort_order: 1,
        },
      ],
      pages: [
        {
          id: "page-published",
          page_key: "projects",
          title: "Projects",
          slug: "/projects",
          is_published: true,
        },
        {
          id: "page-draft",
          page_key: "private",
          title: "Private planning",
          slug: "/private",
          is_published: false,
        },
      ],
      page_sections: [
        {
          id: "page-section-published",
          page_id: "page-published",
          section_type: "rich_text",
          title: "Public section",
          description: "Visible page evidence.",
          is_visible: true,
          is_archived: false,
          display_order: 0,
        },
        {
          id: "page-section-draft",
          page_id: "page-draft",
          section_type: "rich_text",
          title: "Private section",
          description: "Must not be mapped into public pages.",
          is_visible: true,
          is_archived: false,
          display_order: 0,
        },
      ],
    };
  });

  it("maps only consistently published projects and pages", async () => {
    const { getPortfolioContent } = await import("@/lib/cms");

    const content = await getPortfolioContent();

    expect(content.projects.map((project) => project.slug)).toEqual([
      "published-evidence",
    ]);
    expect(content.projects[0]?.sections?.map((section) => section.title))
      .toEqual(["Outcome"]);
    expect(content.pages.map((page) => page.pageKey)).toEqual(["projects"]);
  });

  it("applies publication, visibility, and archive predicates at the query boundary", async () => {
    const { getPortfolioContent } = await import("@/lib/cms");

    await getPortfolioContent();

    const filtersFor = (table: string) =>
      state.queries.find((query) => query.table === table)?.filters ?? [];
    expect(filtersFor("projects")).toEqual(expect.arrayContaining([
      ["published", true],
      ["status", "published"],
    ]));
    expect(filtersFor("project_sections")).toEqual(expect.arrayContaining([
      ["is_visible", true],
      ["is_archived", false],
    ]));
    expect(filtersFor("pages")).toContainEqual(["is_published", true]);
    expect(filtersFor("page_sections")).toEqual(expect.arrayContaining([
      ["is_visible", true],
      ["is_archived", false],
    ]));
  });

  it("falls back to legacy routes when page sections cannot be confirmed", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.failures.add("page_sections");

    const { getPortfolioContent } = await import("@/lib/cms");
    const { resolveCmsPageRoute } = await import("@/lib/cms-page-routing");

    const content = await getPortfolioContent();

    expect(content.pages.map((page) => page.pageKey)).toEqual(["projects"]);
    expect(content.delivery.pages).toBe("failed");
    expect(resolveCmsPageRoute(content, "projects")).toEqual({
      mode: "legacy-fallback",
      page: null,
    });
    expect(warning).toHaveBeenCalledWith("Public CMS read failed.", {
      incidentId: "CMS-PUBLIC-PAGE-SECTIONS-READ",
    });
  });

  it("gives every confirmed E2E canonical page meaningful controlled content", async () => {
    vi.stubEnv("E2E_USE_FIXTURES", "true");
    vi.stubEnv("VERCEL", "0");

    const { getPortfolioContent } = await import("@/lib/cms");
    const content = await getPortfolioContent();

    expect(content.delivery.pages).toBe("ok");
    expect(content.pages).toHaveLength(9);
    for (const fixturePage of content.pages) {
      expect(fixturePage.sections).toHaveLength(1);
      expect(fixturePage.sections[0]?.description.trim()).not.toBe("");
    }
    expect(
      content.pages.find((fixturePage) => fixturePage.pageKey === "home")
        ?.sections[0]?.sectionType,
    ).toBe("hero");
  });
});
