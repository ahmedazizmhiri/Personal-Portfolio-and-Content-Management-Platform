import { unstable_cache } from "next/cache";
import { cache } from "react";

import { fallbackPortfolioContent, primaryNavigation } from "@/data/fallback-portfolio";
import {
  normalizeCmsBlockType,
  normalizeCmsLayoutVariant,
} from "@/lib/cms-block-registry";
import { cmsSelectColumns } from "@/lib/cms-columns";
import { hasMeaningfulProjectSection } from "@/lib/content-completeness";
import type {
  AdminContentSnapshot,
  CertificationContent,
  CmsTableName,
  ExperienceContent,
  PageContent,
  PageSectionContent,
  PageSectionItemContent,
  PortfolioChromeContent,
  PortfolioContent,
  ProjectContent,
  ProjectMediaContent,
  ProjectSectionContent,
  ProjectSectionItemContent,
  ResumeContent,
  SkillCategory,
} from "@/lib/cms-types";
import { createVolunteeringFooterLink } from "@/lib/navigation";
import { isPublicResume } from "@/lib/resume-policy";
import { createProfileSocialLinkFallback } from "@/lib/social-links";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import {
  type EditableCmsTable,
  isEditableCmsTable,
} from "@/lib/security/validation";

export const cmsTables: CmsTableName[] = [
  "profile",
  "hero",
  "about",
  "skills",
  "projects",
  "project_sections",
  "experience",
  "education",
  "certifications",
  "resumes",
  "social_links",
  "site_settings",
  "contact_messages",
  "uploads",
  "pages",
  "page_sections",
  "page_section_items",
  "project_section_items",
  "project_media",
  "volunteering",
];

const publicTables: CmsTableName[] = [
  "profile",
  "hero",
  "about",
  "skills",
  "projects",
  "project_sections",
  "project_section_items",
  "project_media",
  "experience",
  "education",
  "certifications",
  "resumes",
  "social_links",
  "pages",
  "page_sections",
  "page_section_items",
  "volunteering",
];

const PUBLIC_REVALIDATE_SECONDS = 60;

const publicColumns = {
  profile:
    "id,full_name,initials,headline,secondary_line,tagline,location,email,linkedin_url,linkedin_label,github_url,github_label,avatar_url,availability,short_bio,about_text,about_focus,published,updated_at",
  hero:
    "id,eyebrow,title,subtitle,tagline,dynamic_titles,primary_cta_label,primary_cta_href,secondary_cta_label,secondary_cta_href,published,updated_at",
  about: "id,title,body,highlights,avatar_url,published,updated_at",
  skills:
  "id,name,category,icon_key,icon_color,sort_order,published,updated_at",
 projects:
  "id,slug,title,type,role,summary,description,cover_image_url,placeholder_image_url,card_image_url,tags,tools,github_url,linkedin_url,demo_url,featured,published,status,project_group,home_featured_order,projects_page_order,sort_order,seo_title,seo_description,open_graph_image,created_at,updated_at",
  projectSections:
    "id,project_id,title,body,bullets,sort_order,section_type,layout_variant,is_visible,is_archived,created_at,updated_at",
  projectSectionItems:
    "id,project_section_id,label,value,description,display_order,is_visible,updated_at",
  projectMedia:
    "id,project_id,project_section_id,media_url,alt_text,caption,media_type,display_order,is_visible,updated_at",
  experience:
    "id,company,role,location,start_date,end_date,date_label,icon_bg,logo_url,logo_alt,points,tools,sort_order,published,updated_at",
  education:
    "id,institution,degree,start_date,end_date,status,location,sort_order,published,updated_at",
  certifications:
    "id,name,issuer,date,credential_url,credential_id,image_url,description,tags,sort_order,published,updated_at",
  resumes: "id,label,variant,pdf_url,docx_url,sort_order,published,updated_at",
  socialLinks:
    "id,slug,label,url,link_group,icon_key,icon_url,show_in_contact,show_in_footer,include_in_same_as,sort_order,published,updated_at",
  pages:
    "id,page_key,title,slug,seo_title,seo_description,open_graph_title,open_graph_description,open_graph_image,navigation_label,navigation_order,show_in_navigation,show_in_footer,is_published,updated_at",
  pageSections:
    "id,page_id,section_type,title,subtitle,description,cta_label,cta_href,secondary_cta_label,secondary_cta_href,display_order,layout_variant,is_visible,is_archived,updated_at",
  pageSectionItems:
    "id,page_section_id,title,subtitle,description,link_label,link_url,media_url,media_alt,display_order,is_visible,updated_at",
  volunteering:
    "id,role,organisation,logo_url,logo_alt,start_date,end_date,date_label,domain,summary,description_items,focus_areas,certification_id,sort_order,published,archived,updated_at",
} as const;

const adminOnlyColumns: Record<
  Exclude<CmsTableName, EditableCmsTable>,
  string
> = {
  site_settings: "key,value,updated_at",
  contact_messages:
    "id,name,email,message,source,status,created_at,updated_at,read_at,archived_at,delivery_status,delivery_attempts,last_delivery_attempt_at,next_delivery_attempt_at,delivered_at,delivery_error_code,provider_message_id",
  uploads:
    "id,bucket,path,public_url,mime_type,size_bytes,original_name,uploaded_by,created_at,sha256,deletion_status,deletion_requested_at,deletion_error_code",
};

const adminColumnsFor = (table: CmsTableName) =>
  isEditableCmsTable(table)
    ? cmsSelectColumns(table)
    : adminOnlyColumns[table];

type CmsRow = Record<string, unknown> & {
  display_order?: number;
  projects_page_order?: number;
  sort_order?: number;
  sortOrder?: number;
};

type PublicQueryResult = {
  rows: CmsRow[];
  ok: boolean;
};

type QueryLike = PromiseLike<{ data: unknown; error: unknown }>;

const isPublicCmsResumeRow = (row: CmsRow) =>
  isPublicResume({
    variant: row.variant,
    label: row.label,
    pdf_url: row.pdf_url,
    docx_url: row.docx_url,
  });

const readRows = (data: unknown): CmsRow[] =>
  Array.isArray(data) ? (data as CmsRow[]) : [];

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const readTimestamp = (value: unknown) => {
  const candidate = readText(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : "";
};

const readBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const canonicalPageKeyByHref: Record<string, string> = {
  "/": "home",
  "/projects": "projects",
  "/experience": "experience",
  "/expertise": "expertise",
  "/about": "about",
  "/contact": "contact",
  "/resume": "resume",
  "/education": "education",
  "/certifications": "certifications",
};

export const mapCmsNavigation = (
  pageRows: CmsRow[],
  pageSectionRows?: CmsRow[],
) => {
  const byPageKey = new Map(
    pageRows.map((row) => [readText(row.page_key), row]),
  );
  const pageKeyById = new Map(
    pageRows.map((row) => [readText(row.id), readText(row.page_key)]),
  );
  const volunteeringControl = pageSectionRows
    ? [...pageSectionRows]
        .filter(
          (row) =>
            readText(row.section_type) === "volunteering" &&
            readBoolean(row.is_visible, true) &&
            !readBoolean(row.is_archived, false) &&
            pageKeyById.has(readText(row.page_id)),
        )
        .sort((left, right) => {
          const sourceRank = (row: CmsRow) => {
            const pageKey = pageKeyById.get(readText(row.page_id));
            if (pageKey === "about") return 0;
            if (pageKey === "home") return 1;
            return 2;
          };

          return (
            sourceRank(left) - sourceRank(right) ||
            Number(left.display_order ?? 0) -
              Number(right.display_order ?? 0)
          );
        })[0]
    : undefined;

  return primaryNavigation
    .map((fallback) => {
      if (fallback.href === "/about#volunteering") {
        if (!pageSectionRows) return { ...fallback };
        if (!volunteeringControl || !byPageKey.has("about")) return null;

        const sourcePage = byPageKey.get("about");

        return createVolunteeringFooterLink({
          label: readText(volunteeringControl.title),
          aboutNavigationOrder: Number(
            sourcePage?.navigation_order ?? 40,
          ),
          blockDisplayOrder: Number(
            volunteeringControl.display_order ?? 50,
          ),
          isVisible: true,
        });
      }

      const pageKey = canonicalPageKeyByHref[fallback.href];
      const row = pageKey ? byPageKey.get(pageKey) : undefined;
      if (!row) {
        return pageSectionRows ? null : { ...fallback };
      }

      return {
        ...fallback,
        title:
          readText(row.navigation_label) ||
          readText(row.title) ||
          fallback.title,
        navigationOrder: Number.isFinite(Number(row.navigation_order))
          ? Number(row.navigation_order)
          : fallback.navigationOrder,
        showInNavigation: readBoolean(
          row.show_in_navigation,
          fallback.showInNavigation,
        ),
        showInFooter: readBoolean(
          row.show_in_footer,
          fallback.showInFooter,
        ),
      };
    })
    .filter(
      (link): link is NonNullable<typeof link> => link !== null,
    )
    .sort(
      (left, right) => left.navigationOrder - right.navigationOrder,
    );
};

const latestTimestamp = (...values: string[]) =>
  values
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? "";

const sortByOrder = <T extends CmsRow>(rows: T[]) =>
  [...rows].sort(
    (left, right) =>
      (left.sort_order ??
        left.sortOrder ??
        left.display_order ??
        0) -
      (right.sort_order ??
        right.sortOrder ??
        right.display_order ??
        0),
  );

const sortProjectsByPageOrder = <T extends CmsRow>(rows: T[]) =>
  [...rows].sort(
    (left, right) =>
      Number(left.projects_page_order ?? left.sort_order ?? 0)
      - Number(right.projects_page_order ?? right.sort_order ?? 0),
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const localAssetAliases: Record<string, string> = {
  "/companies/arabsoft.png": "/companies/arab-soft.png",
  "/companies/confidential-client.png": "/companies/chicchac.png",
};

const normalizeCmsAssetPath = (value: unknown, fallback = "") => {
  let path = readText(value) || fallback;
  if (!path) return "";

  if (path.startsWith("public/")) {
    path = `/${path.slice("public/".length)}`;
  }
  if (
    !path.startsWith("/") &&
    !path.startsWith("http://") &&
    !path.startsWith("https://")
  ) {
    path = `/${path}`;
  }

  return localAssetAliases[path] ?? path;
};

const deriveInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const emptyPublishedContent = (): PortfolioContent => ({
  profile: {
    name: "",
    initials: "",
    avatarPath: "",
    location: "",
    email: "",
    linkedIn: "",
    linkedInLabel: "",
    github: "",
    githubLabel: "",
    availability: "",
    mainTitle: "",
    secondaryLine: "",
    tagline: "",
    shortProfile: "",
    about: "",
    aboutFocus: [],
  },
  hero: {
    eyebrow: "",
    title: "",
    subtitle: "",
    tagline: "",
    dynamicTitles: [],
    primaryCtaLabel: "",
    primaryCtaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
  },
  about: { title: "", body: "", highlights: [], avatarUrl: "" },
  skillCategories: [],
  projects: [],
  projectSections: [],
  experience: [],
  education: [],
  certifications: [],
  resumes: [],
  socialLinks: [],
  pages: [],
  volunteering: [],
  navLinks: primaryNavigation,
  delivery: {
    source: "cms",
    profile: "ok",
    pages: "ok",
    presentation: "ok",
    projects: "ok",
    career: "ok",
    secondary: "ok",
  },
});

const readPublicRows = async (
  incidentId: string,
  query: QueryLike,
): Promise<PublicQueryResult> => {
  try {
    const result = await query;
    if (result.error) {
      console.warn("Public CMS read failed.", { incidentId });
      return { rows: [], ok: false };
    }
    return { rows: readRows(result.data), ok: true };
  } catch {
    console.warn("Public CMS read failed.", { incidentId });
    return { rows: [], ok: false };
  }
};

export const readPublicCmsRows = readPublicRows;

const groupStatus = (results: PublicQueryResult[]) => {
  const successful = results.filter((result) => result.ok).length;
  if (successful === results.length) return "ok" as const;
  if (successful === 0) return "failed" as const;
  return "partial" as const;
};

const loadProfileRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    return readPublicRows(
      "CMS-PUBLIC-PROFILE-READ",
      supabase
        .from("profile")
        .select(publicColumns.profile)
        .eq("published", true)
        .order("updated_at", { ascending: false })
        .limit(1),
    );
  },
  ["public-cms-profile-v2"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-profile"] },
);

const loadNavigationRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const [pages, pageSections] = await Promise.all([
      readPublicRows(
        "CMS-PUBLIC-NAVIGATION-READ",
        supabase
          .from("pages")
          .select(publicColumns.pages)
          .eq("is_published", true)
          .order("navigation_order", { ascending: true }),
      ),
      readPublicRows(
        "CMS-PUBLIC-NAVIGATION-SECTIONS-READ",
        supabase
          .from("page_sections")
          .select(publicColumns.pageSections)
          .eq("is_visible", true)
          .eq("is_archived", false)
          .order("display_order", { ascending: true }),
      ),
    ]);

    return { pages, pageSections };
  },
  ["public-cms-navigation-v2"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-presentation"] },
);

const loadPresentationRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const [hero, about, pages, pageSections, pageSectionItems] =
      await Promise.all([
        readPublicRows(
          "CMS-PUBLIC-HERO-READ",
          supabase
            .from("hero")
            .select(publicColumns.hero)
            .eq("published", true)
            .order("updated_at", { ascending: false })
            .limit(1),
        ),
        readPublicRows(
          "CMS-PUBLIC-ABOUT-READ",
          supabase
            .from("about")
            .select(publicColumns.about)
            .eq("published", true)
            .order("updated_at", { ascending: false })
            .limit(1),
        ),
        readPublicRows(
          "CMS-PUBLIC-PAGES-READ",
          supabase
            .from("pages")
            .select(publicColumns.pages)
            .eq("is_published", true),
        ),
        readPublicRows(
          "CMS-PUBLIC-PAGE-SECTIONS-READ",
          supabase
            .from("page_sections")
            .select(publicColumns.pageSections)
            .eq("is_visible", true)
            .eq("is_archived", false)
            .order("display_order", { ascending: true }),
        ),
        readPublicRows(
          "CMS-PUBLIC-PAGE-ITEMS-READ",
          supabase
            .from("page_section_items")
            .select(publicColumns.pageSectionItems)
            .eq("is_visible", true)
            .order("display_order", { ascending: true }),
        ),
      ]);

    return { hero, about, pages, pageSections, pageSectionItems };
  },
  ["public-cms-presentation-v2"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-presentation"] },
);

const loadProjectRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const [projects, projectSections, projectSectionItems, projectMedia] =
      await Promise.all([
        readPublicRows(
          "CMS-PUBLIC-PROJECTS-READ",
          supabase
            .from("projects")
            .select(publicColumns.projects)
            .eq("published", true)
            .eq("status", "published")
            .order("projects_page_order", { ascending: true }),
        ),
        readPublicRows(
          "CMS-PUBLIC-PROJECT-SECTIONS-READ",
          supabase
            .from("project_sections")
            .select(publicColumns.projectSections)
            .eq("is_visible", true)
            .eq("is_archived", false)
            .order("sort_order", { ascending: true }),
        ),
        readPublicRows(
          "CMS-PUBLIC-PROJECT-ITEMS-READ",
          supabase
            .from("project_section_items")
            .select(publicColumns.projectSectionItems)
            .eq("is_visible", true)
            .order("display_order", { ascending: true }),
        ),
        readPublicRows(
          "CMS-PUBLIC-PROJECT-MEDIA-READ",
          supabase
            .from("project_media")
            .select(publicColumns.projectMedia)
            .eq("is_visible", true)
            .order("display_order", { ascending: true }),
        ),
      ]);

    return { projects, projectSections, projectSectionItems, projectMedia };
  },
  ["public-cms-projects-v2"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-projects"] },
);

const loadCareerRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const [skills, experience, education] = await Promise.all([
      readPublicRows(
        "CMS-PUBLIC-SKILLS-READ",
        supabase
          .from("skills")
          .select(publicColumns.skills)
          .eq("published", true)
          .order("sort_order", { ascending: true }),
      ),
      readPublicRows(
        "CMS-PUBLIC-EXPERIENCE-READ",
        supabase
          .from("experience")
          .select(publicColumns.experience)
          .eq("published", true)
          .order("sort_order", { ascending: true }),
      ),
      readPublicRows(
        "CMS-PUBLIC-EDUCATION-READ",
        supabase
          .from("education")
          .select(publicColumns.education)
          .eq("published", true)
          .order("sort_order", { ascending: true }),
      ),
    ]);

    return { skills, experience, education };
  },
  ["public-cms-career-v2"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-career"] },
);

const loadSocialLinkRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    return readPublicRows(
      "CMS-PUBLIC-SOCIAL-LINKS-READ",
      supabase
        .from("social_links")
        .select(publicColumns.socialLinks)
        .eq("published", true)
        .order("sort_order", { ascending: true }),
    );
  },
  ["public-cms-social-links-v1"],
  {
    revalidate: PUBLIC_REVALIDATE_SECONDS,
    tags: ["public-cms-social-links", "public-cms-secondary"],
  },
);

const loadSecondaryRows = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const [certifications, loadedResumes, socialLinks, volunteering] =
      await Promise.all([
        readPublicRows(
          "CMS-PUBLIC-CERTIFICATIONS-READ",
          supabase
            .from("certifications")
            .select(publicColumns.certifications)
            .eq("published", true)
            .order("sort_order", { ascending: true }),
        ),
        readPublicRows(
          "CMS-PUBLIC-RESUMES-READ",
          supabase
            .from("resumes")
            .select(publicColumns.resumes)
            .eq("published", true)
            .order("sort_order", { ascending: true }),
        ),
        loadSocialLinkRows(),
        readPublicRows(
          "CMS-PUBLIC-VOLUNTEERING-READ",
          supabase
            .from("volunteering")
            .select(publicColumns.volunteering)
            .eq("published", true)
            .eq("archived", false)
            .order("sort_order", { ascending: true }),
        ),
      ]);

    const resumes: PublicQueryResult = {
      ...loadedResumes,
      rows: loadedResumes.rows.filter(isPublicCmsResumeRow),
    };

    return { certifications, resumes, socialLinks, volunteering };
  },
  ["public-cms-secondary-v4"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: ["public-cms-secondary"] },
);

const mapProfile = (result: PublicQueryResult): PortfolioContent["profile"] => {
  if (!result.ok) return fallbackPortfolioContent.profile;
  const row = result.rows[0];
  if (!row) return emptyPublishedContent().profile;

  const name = readText(row.full_name);
  const linkedIn = readText(row.linkedin_url);
  const github = readText(row.github_url);

  return {
    name,
    initials: readText(row.initials) || deriveInitials(name),
    avatarPath: normalizeCmsAssetPath(row.avatar_url),
    location: readText(row.location),
    email: readText(row.email),
    linkedIn,
    linkedInLabel: readText(row.linkedin_label) || linkedIn,
    github,
    githubLabel: readText(row.github_label) || github,
    availability: readText(row.availability),
    mainTitle: readText(row.headline),
    secondaryLine: readText(row.secondary_line),
    tagline: readText(row.tagline),
    shortProfile: readText(row.short_bio),
    about: readText(row.about_text),
    aboutFocus: readStringArray(row.about_focus),
  };
};

const mapSocialLinks = (
  result: PublicQueryResult,
  profile: PortfolioContent["profile"],
): PortfolioContent["socialLinks"] => {
  if (!result.ok) return createProfileSocialLinkFallback(profile);

  return sortByOrder(result.rows).map((row, index) => ({
    slug: readText(row.slug),
    label: readText(row.label),
    url: readText(row.url),
    iconKey: readText(row.icon_key) || undefined,
    iconUrl: normalizeCmsAssetPath(row.icon_url) || undefined,
    group: readText(row.link_group) === "freelance"
      ? "freelance"
      : "primary",
    showInContact: readBoolean(row.show_in_contact, true),
    showInFooter: readBoolean(row.show_in_footer, true),
    includeInSameAs: readBoolean(row.include_in_same_as, false),
    sortOrder: Number(row.sort_order ?? index),
    published: readBoolean(row.published, true),
  }));
};

const mapHero = (
  result: PublicQueryResult,
): PortfolioContent["hero"] => {
  if (!result.ok) return fallbackPortfolioContent.hero;
  const row = result.rows[0];
  if (!row) return emptyPublishedContent().hero;

  return {
    eyebrow: readText(row.eyebrow),
    title: readText(row.title),
    subtitle: readText(row.subtitle),
    tagline: readText(row.tagline),
    dynamicTitles: readStringArray(row.dynamic_titles),
    primaryCtaLabel: readText(row.primary_cta_label),
    primaryCtaHref: readText(row.primary_cta_href),
    secondaryCtaLabel: readText(row.secondary_cta_label),
    secondaryCtaHref: readText(row.secondary_cta_href),
  };
};

const mapAbout = (
  result: PublicQueryResult,
): PortfolioContent["about"] => {
  if (!result.ok) return fallbackPortfolioContent.about;
  const row = result.rows[0];
  if (!row) return emptyPublishedContent().about;

  return {
    title: readText(row.title),
    body: readText(row.body),
    highlights: readStringArray(row.highlights),
    avatarUrl: normalizeCmsAssetPath(row.avatar_url),
  };
};

const mapPageSectionItems = (
  rows: CmsRow[],
): PageSectionItemContent[] =>
  sortByOrder(rows)
    .map((row) => ({
      id: readText(row.id),
      pageSectionId: readText(row.page_section_id),
      title: readText(row.title),
      subtitle: readText(row.subtitle),
      description: readText(row.description),
      linkLabel: readText(row.link_label),
      linkUrl: readText(row.link_url),
      mediaUrl: normalizeCmsAssetPath(row.media_url),
      mediaAlt: readText(row.media_alt),
      displayOrder: Number(row.display_order ?? 0),
    }))
    .filter(
      (item) =>
        item.subtitle ||
        item.description ||
        (item.linkUrl && item.linkLabel) ||
        (item.mediaUrl && item.mediaAlt),
    );

const mapPages = (
  pageRows: CmsRow[],
  pageSectionRows: CmsRow[],
  pageSectionItemRows: CmsRow[],
): PageContent[] => {
  const items = mapPageSectionItems(pageSectionItemRows);

  return pageRows.map((row) => {
    const sections: PageSectionContent[] = sortByOrder(
      pageSectionRows.filter(
        (section) => readText(section.page_id) === readText(row.id),
      ),
    ).map((section) => {
      const sectionItems = items.filter(
        (item) => item.pageSectionId === readText(section.id),
      );
      return {
        id: readText(section.id),
        pageKey: readText(row.page_key),
        sectionType: normalizeCmsBlockType(section.section_type),
        title: readText(section.title),
        subtitle: readText(section.subtitle),
        description: readText(section.description),
        ctaLabel: readText(section.cta_label),
        ctaHref: readText(section.cta_href),
        secondaryCtaLabel: readText(section.secondary_cta_label),
        secondaryCtaHref: readText(section.secondary_cta_href),
        displayOrder: Number(section.display_order ?? 0),
        layoutVariant: normalizeCmsLayoutVariant(
          normalizeCmsBlockType(section.section_type),
          section.layout_variant,
        ),
        items: sectionItems,
        updatedAt: latestTimestamp(
          readTimestamp(section.updated_at),
          ...sectionItems.map((item) => {
            const source = pageSectionItemRows.find(
              (candidate) => readText(candidate.id) === item.id,
            );
            return readTimestamp(source?.updated_at);
          }),
        ),
      };
    });

    return {
      id: readText(row.id),
      pageKey: readText(row.page_key),
      title: readText(row.title),
      slug: readText(row.slug),
      seoTitle: readText(row.seo_title),
      seoDescription: readText(row.seo_description),
      openGraphTitle: readText(row.open_graph_title),
      openGraphDescription: readText(row.open_graph_description),
      openGraphImage: normalizeCmsAssetPath(row.open_graph_image),
      navigationLabel:
        readText(row.navigation_label) || readText(row.title),
      navigationOrder: Number(row.navigation_order ?? 0),
      showInNavigation: readBoolean(row.show_in_navigation, false),
      showInFooter: readBoolean(row.show_in_footer, false),
      isPublished: true,
      updatedAt: latestTimestamp(
        readTimestamp(row.updated_at),
        ...sections.map((section) => section.updatedAt),
      ),
      sections,
    };
  });
};

const mapProjectSectionItems = (
  rows: CmsRow[],
): ProjectSectionItemContent[] =>
  sortByOrder(rows)
    .map((row) => ({
      id: readText(row.id),
      projectSectionId: readText(row.project_section_id),
      label: readText(row.label),
      value: readText(row.value),
      description: readText(row.description),
      displayOrder: Number(row.display_order ?? 0),
    }))
    .filter((item) => item.value || item.description);

const mapProjectMedia = (
  rows: CmsRow[],
): ProjectMediaContent[] =>
  sortByOrder(rows)
    .map(
      (
        row,
      ): ProjectMediaContent => {
        const mediaType =
          readText(
            row.media_type,
          );

        return {
          id:
            readText(
              row.id,
            ),

          projectId:
            readText(
              row.project_id,
            ),

          projectSectionId:
            readText(
              row.project_section_id,
            ) || null,

          mediaUrl:
            normalizeCmsAssetPath(
              row.media_url,
            ),

          altText:
            readText(
              row.alt_text,
            ),

          caption:
            readText(
              row.caption,
            ),

          mediaType:
            mediaType ===
              "video" ||
            mediaType ===
              "document"
              ? mediaType
              : "image",

          displayOrder:
            Number(
              row.display_order ??
              0,
            ),

          updatedAt:
            readTimestamp(
              row.updated_at,
            ),
        };
      },
    )
    .filter(
      (item) =>
        item.mediaUrl &&
        item.altText,
    );

const mapProjects = (
  projectRows: CmsRow[],
  projectSectionRows: CmsRow[],
  projectSectionItemRows: CmsRow[],
  projectMediaRows: CmsRow[],
): ProjectContent[] => {
  const items = mapProjectSectionItems(projectSectionItemRows);
  const media = mapProjectMedia(projectMediaRows);

  return sortProjectsByPageOrder(projectRows)
    .map((row, index): ProjectContent => {
            const projectId =
        readText(
          row.id,
        );

      const slug =
        readText(
          row.slug,
        );

      const visibleProjectSectionIds =
        new Set(
          projectSectionRows
            .filter(
              (section) =>
                readText(
                  section.project_id,
                ) ===
                projectId,
            )
            .map(
              (section) =>
                readText(
                  section.id,
                ),
            )
            .filter(Boolean),
        );

      const projectMedia =
        media.filter(
          (item) =>
            item.projectId ===
              projectId &&
            (
              item.projectSectionId ===
                null ||
              visibleProjectSectionIds.has(
                item.projectSectionId,
              )
            ),
        );

      const sections = sortByOrder(
        projectSectionRows.filter(
          (section) => readText(section.project_id) === projectId,
        ),
      )
        .map((section): ProjectSectionContent => {
          const sectionType =
            readText(section.section_type) === "media_gallery"
              ? "media_gallery"
              : "rich_text";
          return {
          id: readText(section.id),
          projectSlug: slug,
          title: readText(section.title),
          body: readText(section.body),
          bullets: readStringArray(section.bullets),
          items: items.filter(
            (item) => item.projectSectionId === readText(section.id),
          ),
          media:
  projectMedia.filter(
    (item) =>
      item.projectSectionId ===
      readText(
        section.id,
      ),
  ),
          sortOrder: Number(section.sort_order ?? 0),
          sectionType,
          layoutVariant: normalizeCmsLayoutVariant(
            sectionType,
            section.layout_variant,
          ),
          isVisible: true,
          };
        })
        .filter(hasMeaningfulProjectSection);

      const sectionTimestamps = projectSectionRows
        .filter((section) => readText(section.project_id) === projectId)
        .flatMap((section) => [
          readTimestamp(section.updated_at),
          ...projectSectionItemRows
            .filter(
              (item) =>
                readText(item.project_section_id) === readText(section.id),
            )
            .map((item) => readTimestamp(item.updated_at)),
        ]);

      return {
        id: projectId,
        slug,
        title: readText(row.title),
        description: readText(row.summary) || readText(row.description),
        image: normalizeCmsAssetPath(
          readText(row.cover_image_url) ||
            readText(row.card_image_url) ||
            readText(row.placeholder_image_url),
          "/projects/project-placeholder-1.png",
        ),
      tags: readStringArray(row.tags),
      tools: readStringArray(row.tools),
      type: readText(row.type),
      role: readText(row.role),
      githubUrl: readText(row.github_url),
      linkedinUrl: readText(row.linkedin_url),
      featured: row.featured === true,
      status: "published",
      group: readText(row.project_group),
      homeFeaturedOrder:
        row.home_featured_order == null
          ? undefined
          : Number(row.home_featured_order),
      projectsPageOrder: Number(
        row.projects_page_order ?? row.sort_order ?? index,
      ),
      demoUrl: readText(row.demo_url),
      repositoryUrl: readText(row.github_url),
      seoTitle: readText(row.seo_title),
      seoDescription: readText(row.seo_description),
      openGraphImage: normalizeCmsAssetPath(row.open_graph_image),
      sortOrder: Number(
        row.projects_page_order ?? row.sort_order ?? index,
      ),
      sections,
      media: projectMedia,
      createdAt: readTimestamp(row.created_at),
        updatedAt: latestTimestamp(
          readTimestamp(row.updated_at),
          ...sectionTimestamps,
          ...projectMedia.map((item) => item.updatedAt),
        ),
      };
    })
    .filter(
      (project) =>
        Boolean(project.id) &&
        Boolean(project.slug) &&
        Boolean(project.title) &&
        Boolean(project.description),
    );
};

const getPortfolioChromeContentImpl =
  async (): Promise<PortfolioChromeContent> => {
    if (shouldUseE2eFixture()) {
      return {
        profile: fallbackPortfolioContent.profile,
        navLinks: primaryNavigation,
        socialLinks: fallbackPortfolioContent.socialLinks,
      };
    }
    if (!isSupabaseConfigured()) {
      return {
        profile: fallbackPortfolioContent.profile,
        navLinks: primaryNavigation,
        socialLinks: fallbackPortfolioContent.socialLinks,
      };
    }

    const [profileResult, navigation, socialLinkResult] = await Promise.all([
      loadProfileRows(),
      loadNavigationRows(),
      loadSocialLinkRows(),
    ]);
    const profile = mapProfile(profileResult);
    return {
      profile,
      navLinks: navigation.pages.ok
        ? mapCmsNavigation(
            navigation.pages.rows,
            navigation.pageSections.ok ? navigation.pageSections.rows : [],
          )
        : primaryNavigation,
      socialLinks: mapSocialLinks(socialLinkResult, profile),
    };
  };

export const getPortfolioChromeContent = cache(
  getPortfolioChromeContentImpl,
);

const shouldUseE2eFixture = () =>
  process.env.E2E_USE_FIXTURES === "true" && process.env.VERCEL !== "1";

const e2eFixtureContent = (): PortfolioContent => {
  const updatedAt = "2026-07-27T00:00:00.000Z";
  const section: ProjectSectionContent = {
    id: "e2e-section",
    projectSlug: "e2e-commercial-analytics-case-study",
    title: "Decision-ready evidence",
    body:
      "A synthetic browser-test fixture proving that meaningful case-study content renders while title-only sections do not.",
    bullets: ["Visible evidence survives the CMS mapping boundary."],
    items: [],
    media: [],
    sortOrder: 0,
    sectionType: "rich_text",
    isVisible: true,
  };
  const project: ProjectContent = {
    id: "e2e-project",
    slug: "e2e-commercial-analytics-case-study",
    title: "E2E Commercial Analytics Case Study",
    description:
      "Synthetic fixture used only by the isolated browser test environment.",
    image: "/projects/project-placeholder-1.png",
    tags: ["Commercial Analytics", "Browser Test"],
    tools: ["Playwright"],
    featured: true,
    status: "published",
    group: "Featured Projects",
    homeFeaturedOrder: 0,
    projectsPageOrder: 0,
    seoTitle: "E2E Commercial Analytics Case Study",
    seoDescription:
      "Synthetic project fixture for isolated portfolio browser tests.",
    openGraphImage: "/projects/project-placeholder-1.png",
    sortOrder: 0,
    sections: [section],
    media: [],
    createdAt: updatedAt,
    updatedAt,
  };
  const pageDefinitions = [
    ["home", "Home", "/"],
    ["about", "About", "/about"],
    ["expertise", "Expertise", "/expertise"],
    ["projects", "Projects", "/projects"],
    ["experience", "Experience", "/experience"],
    ["education", "Education", "/education"],
    ["certifications", "Certifications", "/certifications"],
    ["resume", "CV", "/resume"],
    ["contact", "Contact", "/contact"],
  ] as const;
  const fixturePageSection = (
    pageKey: (typeof pageDefinitions)[number][0],
    title: string,
  ): PageSectionContent => ({
    id: `e2e-page-section-${pageKey}`,
    pageKey,
    sectionType: pageKey === "home" ? "hero" : "rich_text",
    title:
      pageKey === "home"
        ? fallbackPortfolioContent.hero.title
        : title,
    subtitle: "",
    description:
      `Controlled ${title} content used only by isolated browser validation.`,
    ctaLabel: "",
    ctaHref: "",
    secondaryCtaLabel: "",
    secondaryCtaHref: "",
    displayOrder: 0,
    layoutVariant: pageKey === "home" ? "compact" : "default",
    items: [],
    updatedAt,
  });

  return {
    ...fallbackPortfolioContent,
    projects: [project],
    projectSections: [section],
    pages: pageDefinitions.map(([pageKey, title, slug]) => ({
      id: `e2e-page-${pageKey}`,
      pageKey,
      title,
      slug,
      seoTitle: `${title} | Ahmed Aziz Mhiri`,
      seoDescription:
        `${title} page for the isolated Ahmed Aziz Mhiri portfolio browser fixture.`,
      openGraphTitle: title,
      openGraphDescription:
        `${title} page for the isolated portfolio browser fixture.`,
      openGraphImage: "/opengraph-image",
      navigationLabel: title === "CV" ? "Resume" : title,
      navigationOrder: 0,
      showInNavigation: !["education", "certifications"].includes(pageKey),
      showInFooter: true,
      isPublished: true,
      updatedAt,
      sections: [fixturePageSection(pageKey, title)],
    })),
    delivery: {
      source: "cms",
      profile: "ok",
      pages: "ok",
      presentation: "ok",
      projects: "ok",
      career: "ok",
      secondary: "ok",
    },
  };
};

const getPortfolioContentImpl = async (): Promise<PortfolioContent> => {
  if (shouldUseE2eFixture()) return e2eFixtureContent();
  if (!isSupabaseConfigured()) return fallbackPortfolioContent;

  const [profileResult, presentation, projectsGroup, career, secondary] =
    await Promise.all([
      loadProfileRows(),
      loadPresentationRows(),
      loadProjectRows(),
      loadCareerRows(),
      loadSecondaryRows(),
    ]);

  const content = emptyPublishedContent();
  const profile = mapProfile(profileResult);
  const hero = mapHero(presentation.hero);
  const about = mapAbout(presentation.about);

const groupedSkills = new Map<string, SkillCategory["skills"]>();
sortByOrder(career.skills.rows).forEach((row) => {
  const name = readText(row.name);
  if (!name) return;

  const category = readText(row.category) || "Skills";

  const skill = {
    name,
    iconKey: readText(row.icon_key) || undefined,
    iconColor: readText(row.icon_color) || undefined,
  };

  groupedSkills.set(category, [
    ...(groupedSkills.get(category) ?? []),
    skill,
  ]);
});
  const skillCategories: SkillCategory[] = Array.from(
    groupedSkills.entries(),
  ).map(([title, skills]) => ({ title, skills }));

  const certifications: CertificationContent[] = sortByOrder(
    secondary.certifications.rows,
  ).map((row, index) => ({
    name: readText(row.name),
    issuer: readText(row.issuer),
    date: readText(row.date),
    credentialUrl: readText(row.credential_url) || undefined,
    credentialId: readText(row.credential_id) || undefined,
    imageUrl: normalizeCmsAssetPath(row.image_url) || undefined,
    description: readText(row.description) || undefined,
    tags: readStringArray(row.tags),
    sortOrder: Number(row.sort_order ?? index),
  }));
  const certificationsById = new Map(
    sortByOrder(secondary.certifications.rows).map((row, index) => [
      readText(row.id),
      certifications[index],
    ]),
  );

  const projects = mapProjects(
    projectsGroup.projects.rows,
    projectsGroup.projectSections.rows,
    projectsGroup.projectSectionItems.rows,
    projectsGroup.projectMedia.rows,
  );
  const pageRegistryReadOk =
    presentation.pages.ok && presentation.pageSections.ok;

  const experience: ExperienceContent[] = sortByOrder(
    career.experience.rows,
  ).map((row, index) => ({
    company: readText(row.company),
    role: readText(row.role),
    location: readText(row.location),
    date:
      [readText(row.start_date), readText(row.end_date)]
        .filter(Boolean)
        .join(" - ") || readText(row.date_label),
    iconBg: readText(row.icon_bg) || "#2a0e61",
    logo: normalizeCmsAssetPath(row.logo_url) || undefined,
    logoAlt:
      readText(row.logo_alt) ||
      (readText(row.company) ? `${readText(row.company)} logo` : ""),
    points: readStringArray(row.points),
    tools: readStringArray(row.tools),
    sortOrder: Number(row.sort_order ?? index),
  }));

  const resumes: ResumeContent[] = sortByOrder(
    secondary.resumes.rows.filter(isPublicCmsResumeRow),
  ).map((row, index) => ({
    title: readText(row.label) || readText(row.variant) || "Resume",
    variant: readText(row.variant),
    pdfPath: normalizeCmsAssetPath(row.pdf_url),
    docxPath: normalizeCmsAssetPath(row.docx_url),
    available: Boolean(readText(row.pdf_url) || readText(row.docx_url)),
    sortOrder: Number(row.sort_order ?? index),
  }));

  return {
    ...content,
    profile,
    hero,
    about,
    skillCategories,
    projects,
    projectSections: projects.flatMap((project) => project.sections ?? []),
    experience,
    education: sortByOrder(career.education.rows).map((row, index) => ({
      institution: readText(row.institution),
      degree: readText(row.degree),
      startDate: readText(row.start_date),
      endDate: readText(row.end_date),
      status: readText(row.status),
      location: readText(row.location),
      sortOrder: Number(row.sort_order ?? index),
    })),
    certifications,
    resumes,
    socialLinks: mapSocialLinks(secondary.socialLinks, profile),
    pages: mapPages(
      presentation.pages.rows,
      presentation.pageSections.rows,
      presentation.pageSectionItems.rows,
    ),
    volunteering: sortByOrder(secondary.volunteering.rows).map(
      (row, index) => ({
        role: readText(row.role),
        organisation: readText(row.organisation),
        logoUrl: normalizeCmsAssetPath(row.logo_url),
        logoAlt: readText(row.logo_alt),
        date:
          readText(row.date_label) ||
          [readText(row.start_date), readText(row.end_date)]
            .filter(Boolean)
            .join(" - "),
        domain: readText(row.domain),
        summary: readText(row.summary),
        descriptionItems: readStringArray(row.description_items),
        focusAreas: readStringArray(row.focus_areas),
        certification:
          certificationsById.get(readText(row.certification_id)) ??
          undefined,
        sortOrder: Number(row.sort_order ?? index),
      }),
    ),
    navLinks: presentation.pages.ok
      ? mapCmsNavigation(
          presentation.pages.rows,
          presentation.pageSections.ok
            ? presentation.pageSections.rows
            : [],
        )
      : primaryNavigation,
    delivery: {
      source: "cms",
      profile: profileResult.ok ? "ok" : "failed",
      pages: pageRegistryReadOk ? "ok" : "failed",
      presentation: groupStatus(Object.values(presentation)),
      projects: groupStatus(Object.values(projectsGroup)),
      career: groupStatus(Object.values(career)),
      secondary: groupStatus(Object.values(secondary)),
    },
  };
};

export const getPortfolioContent = cache(getPortfolioContentImpl);

export const getProjectBySlug = async (
  slug: string,
) => {
  const content =
    await getPortfolioContent();

  return (
    content.projects.find(
      (project) =>
        project.slug === slug,
    ) ??
    null
  );
};

export const getProjectSlugRedirect =
  cache(
    async (
      slug: string,
    ): Promise<
      string | null
    > => {
      const oldSlug =
        slug.trim();

      if (
        !oldSlug ||
        !isSupabaseConfigured()
      ) {
        return null;
      }

      const supabase =
        createSupabasePublicClient();

      const historyResult =
        await supabase
          .from(
            "project_slug_history",
          )
          .select(
            "project_id",
          )
          .eq(
            "old_slug",
            oldSlug,
          )
          .maybeSingle();

      if (
        historyResult.error
      ) {
        console.warn(
          "Project slug history lookup failed.",
          {
            incidentId:
              "CMS-PUBLIC-PROJECT-SLUG-HISTORY",
          },
        );

        return null;
      }

      const projectId =
        typeof historyResult
          .data
          ?.project_id ===
          "string"
          ? historyResult
              .data
              .project_id
          : "";

      if (!projectId) {
        return null;
      }

      const projectResult =
        await supabase
          .from(
            "projects",
          )
          .select(
            "slug",
          )
          .eq(
            "id",
            projectId,
          )
          .eq(
            "published",
            true,
          )
          .eq(
            "status",
            "published",
          )
          .eq(
            "deletion_status",
            "active",
          )
          .maybeSingle();

      if (
        projectResult.error
      ) {
        console.warn(
          "Canonical project slug lookup failed.",
          {
            incidentId:
              "CMS-PUBLIC-PROJECT-SLUG-TARGET",
          },
        );

        return null;
      }

      const canonicalSlug =
        readText(
          projectResult
            .data
            ?.slug,
        );

      if (
        !canonicalSlug ||
        canonicalSlug ===
          oldSlug
      ) {
        return null;
      }

      return canonicalSlug;
    },
  );

const fallbackAdminContentSnapshot = (): AdminContentSnapshot => ({
  profile: [
    {
      full_name: fallbackPortfolioContent.profile.name,
      initials: fallbackPortfolioContent.profile.initials,
      headline: fallbackPortfolioContent.profile.mainTitle,
      secondary_line: fallbackPortfolioContent.profile.secondaryLine,
      tagline: fallbackPortfolioContent.profile.tagline,
      location: fallbackPortfolioContent.profile.location,
      email: fallbackPortfolioContent.profile.email,
      linkedin_url: fallbackPortfolioContent.profile.linkedIn,
      linkedin_label: fallbackPortfolioContent.profile.linkedInLabel,
      github_url: fallbackPortfolioContent.profile.github,
      github_label: fallbackPortfolioContent.profile.githubLabel,
      avatar_url: fallbackPortfolioContent.profile.avatarPath,
      availability: fallbackPortfolioContent.profile.availability,
      short_bio: fallbackPortfolioContent.profile.shortProfile,
      about_text: fallbackPortfolioContent.profile.about,
      about_focus: fallbackPortfolioContent.profile.aboutFocus,
      published: true,
    },
  ],
  hero: [
    {
      eyebrow: fallbackPortfolioContent.hero.eyebrow,
      title: fallbackPortfolioContent.hero.title,
      subtitle: fallbackPortfolioContent.hero.subtitle,
      tagline: fallbackPortfolioContent.hero.tagline,
      dynamic_titles: fallbackPortfolioContent.hero.dynamicTitles,
      primary_cta_label: fallbackPortfolioContent.hero.primaryCtaLabel,
      primary_cta_href: fallbackPortfolioContent.hero.primaryCtaHref,
      secondary_cta_label: fallbackPortfolioContent.hero.secondaryCtaLabel,
      secondary_cta_href: fallbackPortfolioContent.hero.secondaryCtaHref,
      published: true,
    },
  ],
  about: [
    {
      title: fallbackPortfolioContent.about.title,
      body: fallbackPortfolioContent.about.body,
      highlights: fallbackPortfolioContent.about.highlights,
      avatar_url: fallbackPortfolioContent.about.avatarUrl,
      published: true,
    },
  ],
  skills: [],
  projects: [],
  project_sections: [],
  project_section_items: [],
  project_media: [],
  experience: [],
  education: [],
  certifications: [],
  resumes: [],
  social_links: [],
  pages: [],
  page_sections: [],
  page_section_items: [],
  volunteering: [],
  site_settings: [],
  contact_messages: [],
  uploads: [],
});

export const getAdminContentSnapshot =
  async (): Promise<AdminContentSnapshot> => {
    if (!isSupabaseAdminConfigured()) {
      return fallbackAdminContentSnapshot();
    }

    const supabase = createSupabaseAdminClient();
    const entries = await Promise.all(
      cmsTables.map(async (table) => {
        const result = await supabase
          .from(table)
          .select(adminColumnsFor(table))
          .limit(500);
        if (result.error) {
          const incidentId = `CMS-ADMIN-${table.toUpperCase()}-READ`;
          console.error("Admin CMS snapshot read failed.", { incidentId });
          throw new Error(`Admin CMS snapshot unavailable (${incidentId}).`);
        }
        return [table, result.data ?? []] as const;
      }),
    );

    return Object.fromEntries(entries) as AdminContentSnapshot;
  };

export const isCmsTableName = (value: string): value is CmsTableName =>
  cmsTables.includes(value as CmsTableName);

export const isPublicCmsTableName = (
  value: string,
): value is CmsTableName =>
  publicTables.includes(value as CmsTableName);

export const sanitizeAdminRow = (value: unknown) =>
  isObject(value) ? value : {};
