import "server-only";

import type {
  ProjectWorkspaceLink,
  ProjectWorkspaceMedia,
  ProjectWorkspaceProject,
  ProjectWorkspaceSection,
  ProjectWorkspaceSectionDefinition,
  ProjectWorkspaceSectionItem,
} from "@/lib/projects/project-workspace-types";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";

export const projectWorkspaceProjectSelect = `
  id,
  slug,
  title,
  type,
  summary,
  description,
  cover_image_url,
  card_image_url,
  open_graph_image,
  tags,
  tools,
  seo_title,
  seo_description,
  project_group,
  organisation,
  status,
  home_featured_order,
  projects_page_order,
  featured,
  published,
  sort_order,
  role,
  start_date,
  end_date,
  machine_summary,
  published_at,
  archived_at,
  deletion_status,
  deletion_requested_at,
  deletion_error_code,
  created_at,
  updated_at
` as const;

const projectLinksSelect =
  "id,link_type,label,url,display_order,is_visible" as const;

const projectSectionDefinitionsSelect = `
  id,
  section_key,
  label,
  description,
  default_sort_order,
  default_section_type,
  default_layout_variant,
  default_visible,
  is_required,
  supports_items,
  supports_media,
  is_active
` as const;

const projectSectionsSelect = `
  id,
  project_id,
  definition_id,
  title,
  body,
  bullets,
  sort_order,
  section_type,
  is_visible,
  is_archived,
  layout_variant,
  created_at,
  updated_at
` as const;

const projectSectionItemsSelect = `
  id,
  project_section_id,
  label,
  value,
  description,
  display_order,
  is_visible,
  created_at,
  updated_at
` as const;

const projectMediaSelect = `
  id,
  project_id,
  project_section_id,
  media_url,
  alt_text,
  caption,
  media_type,
  display_order,
  is_visible,
  created_at,
  updated_at
` as const;

type ProjectWorkspaceSectionRow =
  Omit<
    ProjectWorkspaceSection,
    "definition" | "items"
  >;

export type ProjectWorkspaceProjectData = {
  project:
    ProjectWorkspaceProject;

  links:
    ProjectWorkspaceLink[];
};

export type ProjectWorkspaceData =
  ProjectWorkspaceProjectData & {
    sections:
      ProjectWorkspaceSection[];

    sectionDefinitions:
      ProjectWorkspaceSectionDefinition[];

    media:
      ProjectWorkspaceMedia[];

    sectionCount: number;

    mediaCount: number;
  };

export async function getProjectWorkspaceProject(
  projectId: string,
): Promise<
  ProjectWorkspaceProjectData | null
> {
  const firebase =
    createFirebaseAdminClient();

  const [
    projectResult,
    linksResult,
  ] = await Promise.all([
    firebase
      .from("projects")
      .select(
        projectWorkspaceProjectSelect,
      )
      .eq("id", projectId)
      .maybeSingle()
      .overrideTypes<
        ProjectWorkspaceProject,
        { merge: false }
      >(),

    firebase
      .from("project_links")
      .select(
        projectLinksSelect,
      )
      .eq(
        "project_id",
        projectId,
      )
      .order(
        "display_order",
        {
          ascending: true,
        },
      )
      .overrideTypes<
        ProjectWorkspaceLink[],
        { merge: false }
      >(),
  ]);

  if (projectResult.error) {
    throw new Error(
      "Project could not be loaded.",
    );
  }

  if (!projectResult.data) {
    return null;
  }

  if (linksResult.error) {
    throw new Error(
      "Project links could not be loaded.",
    );
  }

  return {
    project:
      projectResult.data,

    links:
      linksResult.data ??
      [],
  };
}

export async function getProjectWorkspaceData(
  projectId: string,
): Promise<
  ProjectWorkspaceData | null
> {
  const firebase =
    createFirebaseAdminClient();

  const [
    projectData,
    definitionsResult,
    sectionsResult,
    mediaResult,
  ] = await Promise.all([
    getProjectWorkspaceProject(
      projectId,
    ),

    firebase
      .from(
        "project_section_definitions",
      )
      .select(
        projectSectionDefinitionsSelect,
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "default_sort_order",
        {
          ascending: true,
        },
      )
      .overrideTypes<
        ProjectWorkspaceSectionDefinition[],
        { merge: false }
      >(),

    firebase
      .from(
        "project_sections",
      )
      .select(
        projectSectionsSelect,
      )
      .eq(
        "project_id",
        projectId,
      )
      .order(
        "sort_order",
        {
          ascending: true,
        },
      )
      .overrideTypes<
        ProjectWorkspaceSectionRow[],
        { merge: false }
      >(),

    firebase
  .from(
    "project_media",
  )
  .select(
    projectMediaSelect,
  )
  .eq(
    "project_id",
    projectId,
  )
  .order(
    "display_order",
    {
      ascending: true,
    },
  )
  .overrideTypes<
    ProjectWorkspaceMedia[],
    { merge: false }
  >(),
  ]);

  if (!projectData) {
    return null;
  }

  if (
    definitionsResult.error
  ) {
    throw new Error(
      "Project section definitions could not be loaded.",
    );
  }

  if (
    sectionsResult.error
  ) {
    throw new Error(
      "Project sections could not be loaded.",
    );
  }

    if (mediaResult.error) {
    throw new Error(
      "Project media could not be loaded.",
    );
  }

  const definitions =
    definitionsResult.data ??
    [];

  const sectionRows =
    sectionsResult.data ??
    [];

  const sectionIds =
    sectionRows.map(
      (section) =>
        section.id,
    );

  let items:
    ProjectWorkspaceSectionItem[] =
    [];

  if (
    sectionIds.length > 0
  ) {
    const itemsResult =
      await firebase
        .from(
          "project_section_items",
        )
        .select(
          projectSectionItemsSelect,
        )
        .in(
          "project_section_id",
          sectionIds,
        )
        .order(
          "display_order",
          {
            ascending: true,
          },
        )
        .overrideTypes<
          ProjectWorkspaceSectionItem[],
          { merge: false }
        >();

    if (
      itemsResult.error
    ) {
      throw new Error(
        "Project section items could not be loaded.",
      );
    }

    items =
      itemsResult.data ??
      [];
  }

  const definitionById =
    new Map(
      definitions.map(
        (definition) => [
          definition.id,
          definition,
        ],
      ),
    );

  const itemsBySection =
    new Map<
      string,
      ProjectWorkspaceSectionItem[]
    >();

  for (
    const item of items
  ) {
    const existing =
      itemsBySection.get(
        item.project_section_id,
      ) ?? [];

    existing.push(item);

    itemsBySection.set(
      item.project_section_id,
      existing,
    );
  }

  const sections:
    ProjectWorkspaceSection[] =
    sectionRows.map(
      (section) => ({
        ...section,

        definition:
          section.definition_id
            ? definitionById.get(
                section.definition_id,
              ) ?? null
            : null,

        items:
          itemsBySection.get(
            section.id,
          ) ?? [],
      }),
    );

  return {
    ...projectData,

    sections,

    sectionDefinitions:
      definitions,

        media:
      mediaResult.data ??
      [],

    sectionCount:
      sections.filter(
        (section) =>
          !section.is_archived,
      ).length,

    mediaCount:
      mediaResult.data
        ?.length ??
      0,
  };
}