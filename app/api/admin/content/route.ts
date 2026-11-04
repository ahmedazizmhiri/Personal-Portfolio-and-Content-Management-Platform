import { revalidatePath, revalidateTag } from "next/cache";

import { cmsSelectColumns } from "@/lib/cms-columns";
import { getAdminContentSnapshot } from "@/lib/cms";
import {
  getProjectCompleteness,
  type ProjectSectionLike,
} from "@/lib/content-completeness";
import { requireAdminApi, writeAdminAudit } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import {
  cmsUploadReferences,
  parsePublicStorageReference,
} from "@/lib/security/upload-lifecycle";
import {
  builderCompoundMutationSchema,
  contentMutationSchema,
  type EditableCmsTable,
  isEditableCmsTable,
  validateCmsRow,
} from "@/lib/security/validation";
import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured } from "@/lib/firebase/config";

export const dynamic = "force-dynamic";

const publicContentPaths = [
  "/",
  "/about",
  "/certifications",
  "/contact",
  "/education",
  "/experience",
  "/expertise",
  "/projects",
  "/resume",
] as const;

const revalidatePublicContent = () => {
  for (const path of publicContentPaths) revalidatePath(path);
  revalidatePath("/projects/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms.txt");
  for (const tag of [
    "public-cms-profile",
    "public-cms-presentation",
    "public-cms-projects",
    "public-cms-career",
    "public-cms-secondary",
  ]) {
    revalidateTag(tag, "max");
  }
};

const mutationLimit = async (
  request: Request,
  userId: string,
  operation: string,
) => consumeRateLimit({
  scope: `admin_content_${operation}`,
  identifiers: [userId, clientIp(request)],
  limit: operation === "delete" ? 20 : 80,
  windowMs: 10 * 60 * 1_000,
});

const ensureRevisionStore = async () => {
  const firebase = createFirebaseAdminClient();
  const result = await firebase
    .from("cms_content_revisions")
    .select("id")
    .limit(1);
  return !result.error;
};

const expectedTimestamp = (
  body: {
    expectedUpdatedAt?: string;
    values?: Record<string, unknown>;
  },
) => {
  const value = body.expectedUpdatedAt ?? body.values?.updated_at;
  return typeof value === "string" ? value : null;
};

type CmsMutationOperation = "create" | "update" | "archive" | "delete";

type AtomicCmsMutation = {
  row: Record<string, unknown> | null;
  operation: CmsMutationOperation;
  revisionRecorded: true;
  revisionId: string;
  requestId: string;
};

type AtomicBuilderMutation = {
  action: "duplicate" | "move";
  table: "page_sections" | "project_sections";
  idempotencyKey: string | null;
  replayed: boolean;
  rows: Array<Record<string, unknown>>;
  childTable: "page_section_items" | "project_section_items" | null;
  children: Array<Record<string, unknown>>;
  revisionRecorded: true;
  revisionIds: string[];
  requestIds: string[];
};

type FirebaseMutationError = {
  code?: string | null;
  message?: string | null;
};

const parseAtomicBuilderMutation = (
  value: unknown,
): AtomicBuilderMutation | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const rows = Array.isArray(result.rows)
    ? result.rows.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    )
    : [];
  const children = Array.isArray(result.children)
    ? result.children.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    )
    : [];
  const revisionIds = Array.isArray(result.revisionIds)
    ? result.revisionIds.filter(
      (id): id is string => typeof id === "string" && Boolean(id),
    )
    : [];
  const requestIds = Array.isArray(result.requestIds)
    ? result.requestIds.filter(
      (id): id is string => typeof id === "string" && Boolean(id),
    )
    : [];
  if (
    !["duplicate", "move"].includes(String(result.action))
    || !["page_sections", "project_sections"].includes(String(result.table))
    || typeof result.replayed !== "boolean"
    || !Array.isArray(result.rows)
    || !Array.isArray(result.children)
    || !Array.isArray(result.revisionIds)
    || !Array.isArray(result.requestIds)
    || rows.length === 0
    || result.revisionRecorded !== true
    || revisionIds.length === 0
    || revisionIds.length !== requestIds.length
    || revisionIds.length !== result.revisionIds.length
    || requestIds.length !== result.requestIds.length
    || !(
      result.childTable === null
      || result.childTable === "page_section_items"
      || result.childTable === "project_section_items"
    )
    || rows.length !== result.rows.length
    || children.length !== result.children.length
    || (
      result.action === "duplicate"
      && (
        rows.length !== 1
        || typeof result.idempotencyKey !== "string"
        || (
          result.childTable !== "page_section_items"
          && result.childTable !== "project_section_items"
        )
      )
    )
    || (
      result.action === "move"
      && (
        rows.length !== 2
        || result.childTable !== null
        || result.idempotencyKey !== null
        || result.replayed
      )
    )
  ) {
    return null;
  }

  return {
    action: result.action as AtomicBuilderMutation["action"],
    table: result.table as AtomicBuilderMutation["table"],
    idempotencyKey:
      result.idempotencyKey as AtomicBuilderMutation["idempotencyKey"],
    replayed: result.replayed,
    rows,
    childTable: result.childTable as AtomicBuilderMutation["childTable"],
    children,
    revisionRecorded: true,
    revisionIds,
    requestIds,
  };
};

const parseAtomicCmsMutation = (
  value: unknown,
): AtomicCmsMutation | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    !["create", "update", "archive", "delete"].includes(
      String(result.operation),
    )
    || result.revisionRecorded !== true
    || typeof result.revisionId !== "string"
    || typeof result.requestId !== "string"
    || (
      result.row !== null
      && (
        typeof result.row !== "object"
        || Array.isArray(result.row)
      )
    )
  ) {
    return null;
  }

  return result as AtomicCmsMutation;
};

const atomicMutationErrorResponse = (error: FirebaseMutationError) => {
  switch (error.code) {
    case "CMS02":
      return jsonError(
        "This entry changed in another session. Reload and merge your edits.",
        409,
        "edit_conflict",
      );
    case "CMS03":
      return jsonError("Content not found.", 404, "not_found");
    case "CMS04":
      return jsonError(
        "Moving an existing CMS entry between parents is disabled. Create a new entry, then archive the old one.",
        409,
        "relationship_change_unsupported",
      );
    case "CMS05":
      return jsonError(
        "Published projects require a summary and meaningful evidence in every visible case-study section.",
        409,
        "project_incomplete",
      );
    case "CMS06":
      return jsonError(
        "Published pages may only link to published projects. Remove the public link before unpublishing or deleting a project.",
        409,
        "project_link_conflict",
      );
    case "CMS07":
    case "22023":
    case "22P02":
    case "23514":
      return jsonError("Invalid CMS mutation.", 400, "validation_error");
    case "CMS08":
      return jsonError(
        "This duplicate request key was already used for a different action. Reload the CMS and try again.",
        409,
        "idempotency_conflict",
      );
    case "CMS01":
      if (error.message === "cms_optimistic_lock_required") {
        return jsonError(
          "Reload this entry before changing it.",
          409,
          "optimistic_lock_required",
        );
      }
      return jsonError("Invalid CMS mutation.", 400, "validation_error");
    case "23503":
      return jsonError(
        "The selected parent entry no longer exists.",
        409,
        "relationship_conflict",
      );
    case "23505":
      return jsonError(
        "A unique slug, key, or published display order is already in use.",
        409,
        "content_conflict",
      );
    case "42883":
    case "PGRST202":
      return jsonError(
        "The CMS hardening migration must be applied before content can change.",
        503,
        "migration_required",
      );
    default:
      return jsonError(
        "Could not save CMS content.",
        500,
        "server_error",
      );
  }
};

type ProjectContentOverride = {
  table: "project_sections" | "project_section_items" | "project_media";
  row?: Record<string, unknown>;
  removeId?: string;
};

const applyProjectOverride = (
  rows: Array<Record<string, unknown>>,
  override: ProjectContentOverride | undefined,
  table: ProjectContentOverride["table"],
) => {
  if (!override || override.table !== table) return rows;
  const overrideId =
    typeof override.row?.id === "string" ? override.row.id : override.removeId;
  const next = overrideId
    ? rows.filter((row) => row.id !== overrideId)
    : [...rows];
  if (override.row) next.push(override.row);
  return next;
};

const loadProjectSections = async (
  projectId: string,
  override?: ProjectContentOverride,
) => {
  const firebase = createFirebaseAdminClient();
  const sectionsResult = await firebase
    .from("project_sections")
    .select("id,section_type,body,bullets,is_visible,is_archived")
    .eq("project_id", projectId);
  if (sectionsResult.error) return null;

  const sections = applyProjectOverride(
    (sectionsResult.data ?? []) as Array<Record<string, unknown>>,
    override,
    "project_sections",
  );
  const sectionIds = sections
    .map((section) => section.id)
    .filter((id): id is string => typeof id === "string");

  const itemsBySection = new Map<string, unknown[]>();
  if (sectionIds.length > 0) {
    const itemsResult = await firebase
      .from("project_section_items")
      .select("id,project_section_id,label,value,description,is_visible")
      .in("project_section_id", sectionIds)
      .limit(1000);
    if (itemsResult.error) return null;

    const items = applyProjectOverride(
      (itemsResult.data ?? []) as Array<Record<string, unknown>>,
      override,
      "project_section_items",
    );
    for (const item of items) {
      if (item.is_visible === false) continue;
      const id = String(item.project_section_id);
      itemsBySection.set(id, [...(itemsBySection.get(id) ?? []), item]);
    }
  }

    const mediaResult = await firebase
    .from("project_media")
    .select(
      "id,project_id,project_section_id,media_url,alt_text,caption,media_type,is_visible",
    )
    .eq("project_id", projectId)
    .limit(1000);
  if (mediaResult.error) return null;
  const media = applyProjectOverride(
    (mediaResult.data ?? []) as Array<Record<string, unknown>>,
    override,
    "project_media",
  ).filter((item) => item.is_visible !== false);

  return sections.map((section) => ({
    ...section,
    items:
      typeof section.id === "string"
        ? itemsBySection.get(section.id) ?? []
        : [],
        media:
      section.section_type ===
        "media_gallery" &&
      typeof section.id ===
        "string"
        ? media.filter(
            (item) =>
              item.project_section_id ===
              section.id,
          )
        : [],
  })) satisfies ProjectSectionLike[];
};

const loadPublishedProject = async (projectId: string) => {
  const firebase = createFirebaseAdminClient();
  const project = await firebase
    .from("projects")
.select("id,slug,title,type,tags,tools,summary,description,cover_image_url,seo_title,seo_description,open_graph_image,status,published,github_url,linkedin_url,demo_url")    .eq("id", projectId)
    .maybeSingle();
  if (project.error) return { error: true as const, project: null };
  return {
    error: false as const,
    project:
      project.data?.published === true && project.data.status === "published"
        ? project.data as Record<string, unknown>
        : null,
  };
};

const projectInvariantIssue = async (
  projectId: string,
  override: ProjectContentOverride,
) => {
  const published = await loadPublishedProject(projectId);
  if (published.error) return "Project completeness could not be verified.";
  if (!published.project) return null;
  const sections = await loadProjectSections(projectId, override);
  if (sections === null) return "Project completeness could not be verified.";
  const completeness = getProjectCompleteness(published.project, sections);
  return completeness.publishable
    ? null
    : completeness.blockingIssues.join(" ");
};

const linkedProjectSlugs = (rows: Array<Record<string, unknown>>) =>
  [...new Set(rows.flatMap((row) => {
    if (typeof row.link_url !== "string") return [];
    const match = /^\/projects\/([^/?#]+)\/?$/.exec(row.link_url.trim());
    return match ? [match[1]] : [];
  }))];

const publishedPageLinkIssue = async (
  pageId: string,
  includeSectionId?: string,
) => {
  const firebase = createFirebaseAdminClient();
  const sections = await firebase
    .from("page_sections")
    .select("id")
    .eq("page_id", pageId)
    .eq("is_visible", true)
    .eq("is_archived", false)
    .limit(1000);
  if (sections.error) return "Linked project publication could not be verified.";
  const sectionIds = [...new Set([
    ...(sections.data ?? []).flatMap((section) =>
      typeof section.id === "string" ? [section.id] : []),
    ...(includeSectionId ? [includeSectionId] : []),
  ])];
  if (sectionIds.length === 0) return null;

  const items = await firebase
    .from("page_section_items")
    .select("link_url")
    .in("page_section_id", sectionIds)
    .eq("is_visible", true)
    .limit(1000);
  if (items.error) return "Linked project publication could not be verified.";
  const slugs = linkedProjectSlugs(
    (items.data ?? []) as Array<Record<string, unknown>>,
  );
  if (slugs.length === 0) return null;

  const projects = await firebase
    .from("projects")
    .select("slug,published,status")
    .in("slug", slugs);
  if (projects.error) return "Linked project publication could not be verified.";
  const publishedSlugs = new Set(
    (projects.data ?? [])
      .filter(
        (project) =>
          project.published === true && project.status === "published",
      )
      .map((project) => project.slug),
  );

  return slugs.some((slug) => !publishedSlugs.has(slug))
    ? "Published pages may only link to published projects."
    : null;
};

const publicLinkToProjectIssue = async (slug: string) => {
  const firebase = createFirebaseAdminClient();
  const items = await firebase
    .from("page_section_items")
    .select("page_section_id")
    .in("link_url", [`/projects/${slug}`, `/projects/${slug}/`])
    .eq("is_visible", true)
    .limit(1000);
  if (items.error) return "Published page links could not be verified.";
  const sectionIds = (items.data ?? []).flatMap((item) =>
    typeof item.page_section_id === "string"
      ? [item.page_section_id]
      : []);
  if (sectionIds.length === 0) return null;

  const sections = await firebase
    .from("page_sections")
    .select("page_id")
    .in("id", sectionIds)
    .eq("is_visible", true)
    .eq("is_archived", false)
    .limit(1000);
  if (sections.error) return "Published page links could not be verified.";
  const pageIds = (sections.data ?? []).flatMap((section) =>
    typeof section.page_id === "string" ? [section.page_id] : []);
  if (pageIds.length === 0) return null;

  const pages = await firebase
    .from("pages")
    .select("id")
    .in("id", pageIds)
    .eq("is_published", true)
    .limit(1);
  if (pages.error) return "Published page links could not be verified.";
  return (pages.data ?? []).length > 0
    ? "Unlink this project from published page content before unpublishing or archiving it."
    : null;
};

const publicationIssue = async (
  table: EditableCmsTable,
  row: Record<string, unknown>,
) => {
  if (table === "projects") {
    const wantsPublished = row.published === true || row.status === "published";
    if (!wantsPublished) {
      return typeof row.slug === "string"
        ? publicLinkToProjectIssue(row.slug)
        : null;
    }
    if (row.published !== true || row.status !== "published") {
      return "Published projects must use both status=published and published=true.";
    }

    const id = typeof row.id === "string" ? row.id : null;
    const sections = id ? await loadProjectSections(id) : [];
    if (sections === null) return "Project completeness could not be verified.";
    const completeness = getProjectCompleteness(row, sections);
    if (!completeness.publishable) {
      return completeness.blockingIssues.join(" ");
    }

    const firebase = createFirebaseAdminClient();
    const projectId = typeof row.id === "string" ? row.id : null;
    const orderedColumns = [
      ["projects_page_order", "projects-page order"],
      ...(row.featured === true
        ? [["home_featured_order", "homepage-featured order"]]
        : []),
    ] as const;
    for (const [column, label] of orderedColumns) {
      const value = row[column];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      let query = firebase
        .from("projects")
        .select("id")
        .eq("published", true)
        .eq("status", "published")
        .eq(column, value)
        .limit(1);
      if (projectId) query = query.neq("id", projectId);
      const conflict = await query;
      if (conflict.error) {
        return "Project order uniqueness could not be verified.";
      }
      if ((conflict.data ?? []).length > 0) {
        return `Choose a unique ${label} before publishing.`;
      }
    }
    return null;
  }

  if (
    table === "pages"
    && row.is_published === true
    && typeof row.id === "string"
  ) {
    return publishedPageLinkIssue(row.id);
  }

  if (
    table === "page_sections"
    && row.is_visible === true
    && row.is_archived !== true
    && typeof row.page_id === "string"
  ) {
    const firebase = createFirebaseAdminClient();
    const page = await firebase
      .from("pages")
      .select("is_published")
      .eq("id", row.page_id)
      .maybeSingle();
    if (page.error) return "Linked project publication could not be verified.";
    if (page.data?.is_published === true) {
      return publishedPageLinkIssue(
        row.page_id,
        typeof row.id === "string" ? row.id : undefined,
      );
    }
  }

  if (
    table === "project_sections"
    && typeof row.project_id === "string"
  ) {
    return projectInvariantIssue(row.project_id, {
      table: "project_sections",
      row,
    });
  }

  if (
    table === "project_section_items"
    && typeof row.project_section_id === "string"
  ) {
    const firebase = createFirebaseAdminClient();
    const section = await firebase
      .from("project_sections")
      .select("project_id")
      .eq("id", row.project_section_id)
      .maybeSingle();
    if (section.error || typeof section.data?.project_id !== "string") {
      return "Project completeness could not be verified.";
    }
    return projectInvariantIssue(section.data.project_id, {
      table: "project_section_items",
      row,
    });
  }

  if (table === "project_media" && typeof row.project_id === "string") {
    return projectInvariantIssue(row.project_id, {
      table: "project_media",
      row,
    });
  }

  if (
    table === "page_section_items"
    && row.is_visible !== false
    && typeof row.page_section_id === "string"
    && typeof row.link_url === "string"
  ) {
    const linkMatch = /^\/projects\/([^/?#]+)\/?$/.exec(row.link_url.trim());
    if (!linkMatch) return null;

    const firebase = createFirebaseAdminClient();
    const section = await firebase
      .from("page_sections")
      .select("page_id,is_visible,is_archived")
      .eq("id", row.page_section_id)
      .maybeSingle();
    if (section.error) return "Linked project publication could not be verified.";
    if (
      section.data?.is_visible !== true
      || section.data.is_archived === true
      || typeof section.data.page_id !== "string"
    ) return null;

    const [page, project] = await Promise.all([
      firebase
        .from("pages")
        .select("is_published")
        .eq("id", section.data.page_id)
        .maybeSingle(),
      firebase
        .from("projects")
        .select("published,status")
        .eq("slug", linkMatch[1])
        .maybeSingle(),
    ]);
    if (page.error || project.error) {
      return "Linked project publication could not be verified.";
    }
    if (
      page.data?.is_published === true
      && (
        project.data?.published !== true
        || project.data.status !== "published"
      )
    ) {
      return "Published pages may only link to published projects.";
    }
  }

  return null;
};

const deletionPublicationIssue = async (
  table: EditableCmsTable,
  row: Record<string, unknown>,
) => {
  if (table === "projects" && typeof row.slug === "string") {
    return publicLinkToProjectIssue(row.slug);
  }
  if (table === "project_sections" && typeof row.project_id === "string") {
    return projectInvariantIssue(row.project_id, {
      table: "project_sections",
      row: { ...row, is_visible: false, is_archived: true },
    });
  }
  if (
    table === "project_section_items"
    && typeof row.id === "string"
    && typeof row.project_section_id === "string"
  ) {
    const firebase = createFirebaseAdminClient();
    const section = await firebase
      .from("project_sections")
      .select("project_id")
      .eq("id", row.project_section_id)
      .maybeSingle();
    if (section.error || typeof section.data?.project_id !== "string") {
      return "Project completeness could not be verified.";
    }
    return projectInvariantIssue(section.data.project_id, {
      table: "project_section_items",
      removeId: row.id,
    });
  }
  if (
    table === "project_media"
    && typeof row.id === "string"
    && typeof row.project_id === "string"
  ) {
    return projectInvariantIssue(row.project_id, {
      table: "project_media",
      removeId: row.id,
    });
  }
  return null;
};

type UploadAvailabilityIssue = {
  message: string;
  status: number;
  code: string;
};

const uploadAvailabilityIssue = async (
  table: EditableCmsTable,
  row: Record<string, unknown>,
): Promise<UploadAvailabilityIssue | null> => {
  const references = cmsUploadReferences(table, row);
  if (references.length === 0) return null;

  const firebase = createFirebaseAdminClient();
  const exactMatches = await firebase
    .from("uploads")
    .select("id")
    .in("public_url", references)
    .in("deletion_status", ["pending", "failed"])
    .limit(1);
  if (exactMatches.error) {
    return {
      message: "Upload availability could not be verified.",
      status: 503,
      code: "upload_check_unavailable",
    };
  }
  if ((exactMatches.data ?? []).length > 0) {
    return {
      message:
        "This asset is pending deletion or failed deletion reconciliation. Choose an active upload or a built-in asset.",
      status: 409,
      code: "upload_unavailable",
    };
  }

  const storageReferences = [
    ...new Map(references.flatMap((reference) => {
      const parsed = parsePublicStorageReference(reference);
      return parsed
        ? [[`${parsed.bucket}/${parsed.path}`, parsed] as const]
        : [];
    })).values(),
  ];
  for (const reference of storageReferences) {
    const locationMatch = await firebase
      .from("uploads")
      .select("id")
      .eq("bucket", reference.bucket)
      .eq("path", reference.path)
      .in("deletion_status", ["pending", "failed"])
      .limit(1);
    if (locationMatch.error) {
      return {
        message: "Upload availability could not be verified.",
        status: 503,
        code: "upload_check_unavailable",
      };
    }
    if ((locationMatch.data ?? []).length > 0) {
      return {
        message:
          "This asset is pending deletion or failed deletion reconciliation. Choose an active upload or a built-in asset.",
        status: 409,
        code: "upload_unavailable",
      };
    }
  }

  return null;
};

const duplicatedPageItemsUploadIssue = async (
  sectionId: string,
): Promise<UploadAvailabilityIssue | null> => {
  const firebase = createFirebaseAdminClient();
  const result = await firebase
    .from("page_section_items")
    .select(cmsSelectColumns("page_section_items"))
    .eq("page_section_id", sectionId)
    .limit(500);
  if (result.error) {
    return {
      message: "Supporting items could not be verified before duplication.",
      status: 503,
      code: "content_check_unavailable",
    };
  }

  for (const item of result.data ?? []) {
    const issue = await uploadAvailabilityIssue(
      "page_section_items",
      item as unknown as Record<string, unknown>,
    );
    if (issue) return issue;
  }
  return null;
};

export async function GET(request: Request) {
  const admin = await requireAdminApi(request, {
    requireMfa: true,
    sameOrigin: false,
  });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError(
      "CMS server configuration is incomplete.",
      500,
      "server_error",
    );
  }

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  if (table) {
    if (!isEditableCmsTable(table)) {
      return jsonError("Unknown CMS content table.", 400, "validation_error");
    }
    const firebase = createFirebaseAdminClient();
    const { data, error } = await firebase
      .from(table)
      .select(cmsSelectColumns(table))
      .limit(500);
    if (error) return jsonError("Could not load CMS content.", 500, "server_error");
    return jsonOk({ table, rows: data ?? [] });
  }

  return jsonOk({ content: await getAdminContentSnapshot() });
}

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError(
      "CMS server configuration is incomplete.",
      500,
      "server_error",
    );
  }

  const body = await request.json().catch(() => null);
  const builderMutation = builderCompoundMutationSchema.safeParse(body);
  const limited = await mutationLimit(
    request,
    admin.user.id,
    builderMutation.success ? "builder" : "save",
  );
  if (!limited.allowed) return rateLimitResponse(limited);

  if (builderMutation.success) {
    if (!(await ensureRevisionStore())) {
      return jsonError(
        "The CMS hardening migration must be applied before content can change.",
        503,
        "migration_required",
      );
    }
    if (
      builderMutation.data.action === "duplicate"
      && builderMutation.data.table === "page_sections"
    ) {
      const uploadError = await duplicatedPageItemsUploadIssue(
        builderMutation.data.id,
      );
      if (uploadError) {
        return jsonError(
          uploadError.message,
          uploadError.status,
          uploadError.code,
        );
      }
    }

    const firebase = createFirebaseAdminClient();
    const mutationResult = await firebase.rpc("mutate_cms_builder_action", {
      p_action: builderMutation.data.action,
      p_table: builderMutation.data.table,
      p_record_id: builderMutation.data.id,
      p_expected_updated_at: builderMutation.data.expectedUpdatedAt,
      p_related_record_id: builderMutation.data.relatedId ?? null,
      p_related_expected_updated_at:
        builderMutation.data.relatedExpectedUpdatedAt ?? null,
      p_direction: builderMutation.data.direction ?? null,
      p_actor_user_id: admin.user.id,
      p_idempotency_key: builderMutation.data.idempotencyKey ?? null,
    });
    if (mutationResult.error) {
      return atomicMutationErrorResponse(mutationResult.error);
    }

    const mutation = parseAtomicBuilderMutation(mutationResult.data);
    if (
      !mutation
      || mutation.action !== builderMutation.data.action
      || mutation.table !== builderMutation.data.table
      || (
        mutation.action === "duplicate"
        && mutation.idempotencyKey !== builderMutation.data.idempotencyKey
      )
    ) {
      return jsonError(
        "Could not verify the atomic builder mutation.",
        500,
        "server_error",
      );
    }

    if (!mutation.replayed) {
      await writeAdminAudit({
        actorUserId: admin.user.id,
        action: mutation.action === "duplicate"
          ? "cms_builder_section_duplicated"
          : "cms_builder_sections_reordered",
        entityType: mutation.table,
        entityId: builderMutation.data.id,
        metadata: {
          revisionRecorded: true,
          revisionIds: mutation.revisionIds,
          requestIds: mutation.requestIds,
          relatedRecordId: builderMutation.data.relatedId ?? null,
          idempotencyKey: mutation.idempotencyKey,
        },
        request,
      });
    }
    revalidatePublicContent();
    return jsonOk({
      rows: mutation.rows,
      childTable: mutation.childTable,
      children: mutation.children,
      replayed: mutation.replayed,
    });
  }

  const parsed = contentMutationSchema.safeParse(body);
  if (
    !parsed.success
    || !parsed.data.values
    || !isEditableCmsTable(parsed.data.table)
  ) {
    return jsonError("Invalid CMS mutation.", 400, "validation_error");
  }
  if (!(await ensureRevisionStore())) {
    return jsonError(
      "The CMS hardening migration must be applied before content can change.",
      503,
      "migration_required",
    );
  }

  const table = parsed.data.table;
  const validated = validateCmsRow(table, parsed.data.values);
  if (!validated.success) {
    return jsonError(
      validated.error.issues[0]?.message ?? "Invalid CMS fields.",
      400,
      "validation_error",
    );
  }
  const row = validated.data;
  const uploadError = await uploadAvailabilityIssue(table, row);
  if (uploadError) {
    return jsonError(
      uploadError.message,
      uploadError.status,
      uploadError.code,
    );
  }
  const publicationError = await publicationIssue(table, row);
  if (publicationError) {
    return jsonError(publicationError, 409, "project_incomplete");
  }

  const firebase = createFirebaseAdminClient();
  const id = typeof row.id === "string" ? row.id : null;
  const expected = expectedTimestamp(parsed.data);

  if (id) {
    if (!expected) {
      return jsonError(
        "Reload this entry before saving it.",
        409,
        "optimistic_lock_required",
      );
    }

    const existing = await firebase
      .from(table)
      .select(cmsSelectColumns(table))
      .eq("id", id)
      .maybeSingle();
    if (existing.error) {
      return jsonError("Could not load CMS content.", 500, "server_error");
    }
    if (!existing.data) return jsonError("Content not found.", 404, "not_found");
    const previous = existing.data as unknown as Record<string, unknown>;
    const immutableParentKeys: Partial<Record<EditableCmsTable, string>> = {
      projects: "slug",
      project_sections: "project_id",
      project_section_items: "project_section_id",
      project_media: "project_id",
      page_sections: "page_id",
      page_section_items: "page_section_id",
    };
    const parentKey = immutableParentKeys[table];
    if (parentKey && previous[parentKey] !== row[parentKey]) {
      return jsonError(
        "Moving an existing CMS entry between parents is disabled. Create a new entry, then archive the old one.",
        409,
        "relationship_change_unsupported",
      );
    }
  }

  const { id: ignoredId, ...mutationValues } = row;
  void ignoredId;
  const operation: CmsMutationOperation = id ? "update" : "create";
  const mutationResult = await firebase.rpc("mutate_cms_content", {
    p_table: table,
    p_operation: operation,
    p_record_id: id,
    p_expected_updated_at: id ? expected : null,
    p_values: mutationValues,
    p_actor_user_id: admin.user.id,
  });
  if (mutationResult.error) {
    return atomicMutationErrorResponse(mutationResult.error);
  }

  const mutation = parseAtomicCmsMutation(mutationResult.data);
  if (!mutation || !mutation.row) {
    return jsonError(
      "Could not verify the atomic CMS mutation.",
      500,
      "server_error",
    );
  }

  const recordId = String(mutation.row.id ?? id ?? "");
  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: id ? "cms_content_updated" : "cms_content_created",
    entityType: table,
    entityId: recordId,
    metadata: {
      revisionRecorded: true,
      revisionId: mutation.revisionId,
      requestId: mutation.requestId,
    },
    request,
  });
  revalidatePublicContent();
  return jsonOk({ row: mutation.row });
}

export async function PUT(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  return jsonError(
    "Bulk writes are disabled; save one versioned entry at a time.",
    405,
    "unsafe_bulk_write",
  );
}

export async function DELETE(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError(
      "CMS server configuration is incomplete.",
      500,
      "server_error",
    );
  }

  const limited = await mutationLimit(request, admin.user.id, "delete");
  if (!limited.allowed) return rateLimitResponse(limited);
  const parsed = contentMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (
    !parsed.success
    || !parsed.data.id
    || !parsed.data.expectedUpdatedAt
    || !isEditableCmsTable(parsed.data.table)
  ) {
    return jsonError(
      "Reload this entry before deleting it.",
      409,
      "optimistic_lock_required",
    );
  }
  if (!(await ensureRevisionStore())) {
    return jsonError(
      "The CMS hardening migration must be applied before content can change.",
      503,
      "migration_required",
    );
  }

  const table = parsed.data.table;
  const firebase = createFirebaseAdminClient();
  const existing = await firebase
    .from(table)
    .select(cmsSelectColumns(table))
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (existing.error) return jsonError("Could not load CMS content.", 500);
  if (!existing.data) return jsonError("Content not found.", 404, "not_found");
  const deletionIssue = await deletionPublicationIssue(
    table,
    existing.data as unknown as Record<string, unknown>,
  );
  if (deletionIssue) {
    return jsonError(deletionIssue, 409, "project_incomplete");
  }

  const archivableTables: ReadonlySet<EditableCmsTable> = new Set([
    "projects",
    "project_sections",
    "page_sections",
    "volunteering",
  ]);
  const operation: CmsMutationOperation = archivableTables.has(table)
    ? "archive"
    : "delete";
  const mutationResult = await firebase.rpc("mutate_cms_content", {
    p_table: table,
    p_operation: operation,
    p_record_id: parsed.data.id,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
    p_values: {},
    p_actor_user_id: admin.user.id,
  });
  if (mutationResult.error) {
    return atomicMutationErrorResponse(mutationResult.error);
  }

  const mutation = parseAtomicCmsMutation(mutationResult.data);
  if (
    !mutation
    || mutation.operation !== operation
    || (operation === "archive" && !mutation.row)
    || (operation === "delete" && mutation.row !== null)
  ) {
    return jsonError(
      "Could not verify the atomic CMS mutation.",
      500,
      "server_error",
    );
  }

  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: operation === "archive"
      ? "cms_content_archived"
      : "cms_content_deleted",
    entityType: table,
    entityId: parsed.data.id,
    metadata: {
      revisionRecorded: true,
      revisionId: mutation.revisionId,
      requestId: mutation.requestId,
    },
    request,
  });
  revalidatePublicContent();
  return jsonOk({
    row: mutation.row,
    message: operation === "archive" ? "Archived." : "Deleted.",
  });
}
