import {
  revalidatePath,
  revalidateTag,
} from "next/cache";
import {
  requireAdminApi,
  writeAdminAudit,
} from "@/lib/security/admin-auth";

import {
  clientIp,
  jsonError,
  jsonOk,
} from "@/lib/security/http";

import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

import {
  projectWorkspaceMutationSchema,
  projectWorkspaceProjectIdSchema,
} from "@/lib/projects/project-workspace-validation";

import { getProjectWorkspaceProject } from "@/lib/projects/project-workspace-data";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

const revalidateProjectContent = (
  slug: string,
) => {
  revalidatePath("/");
  revalidatePath("/projects");

  revalidatePath(
    `/projects/${slug}`,
  );

  revalidatePath(
    "/projects/[slug]",
    "page",
  );

  revalidatePath("/sitemap.xml");
  revalidatePath("/llms.txt");

  for (const tag of [
    "public-cms-projects",
    "public-cms-presentation",
  ]) {
    revalidateTag(tag, "max");
  }
};

const mutationErrorResponse = (
  error: {
    code?: string | null;
    message?: string | null;
  },
) => {
  switch (error.code) {
    case "CMS02":
      return jsonError(
        "This project changed in another session. Reload the workspace before saving.",
        409,
        "edit_conflict",
      );

    case "CMS03":
      return jsonError(
        "Project not found.",
        404,
        "not_found",
      );

    case "CMS05":
      return jsonError(
        "This project does not satisfy the publication requirements.",
        409,
        "project_incomplete",
      );

    case "CMS06":
      return jsonError(
        "This project is still linked from published page content.",
        409,
        "project_link_conflict",
      );

    case "23505":
      return jsonError(
        "A project order or link conflicts with an existing value.",
        409,
        "content_conflict",
      );

    case "CMS01":
    case "CMS07":
    case "22007":
    case "22023":
    case "22P02":
      return jsonError(
        "Invalid project workspace data.",
        400,
        "validation_error",
      );

    default:
      return jsonError(
        "Could not save the project workspace.",
        500,
        "server_error",
      );
  }
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  const admin =
    await requireAdminApi(
      request,
      {
        requireMfa: true,
        sameOrigin: false,
      },
    );

  if (!admin.ok) {
    return admin.response;
  }

  const { projectId } =
    await context.params;

  const idResult =
    projectWorkspaceProjectIdSchema
      .safeParse(projectId);

  if (!idResult.success) {
    return jsonError(
      "Invalid project identifier.",
      400,
      "validation_error",
    );
  }

  let data;
  try {
    data = await getProjectWorkspaceProject(projectId);
  } catch {
    return jsonError(
      "Could not load project.",
      500,
      "server_error",
    );
  }

  if (!data) {
    return jsonError(
      "Project not found.",
      404,
      "not_found",
    );
  }

  return jsonOk({
    project: data.project,
    links: data.links,
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  const admin =
    await requireAdminApi(
      request,
      {
        requireMfa: true,
      },
    );

  if (!admin.ok) {
    return admin.response;
  }

  const { projectId } =
    await context.params;

  const idResult =
    projectWorkspaceProjectIdSchema
      .safeParse(projectId);

  if (!idResult.success) {
    return jsonError(
      "Invalid project identifier.",
      400,
      "validation_error",
    );
  }

  const limited =
    await consumeRateLimit({
      scope:
        "admin_project_workspace_save",

      identifiers: [
        admin.user.id,
        clientIp(request),
      ],

      limit: 60,

      windowMs:
        10 * 60 * 1000,
    });

  if (!limited.allowed) {
    return rateLimitResponse(limited);
  }

  const body =
    await request
      .json()
      .catch(() => null);

  const parsed =
    projectWorkspaceMutationSchema
      .safeParse(body);

  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]
        ?.message ??
        "Invalid project data.",

      400,
      "validation_error",
    );
  }

  const firebase =
    createFirebaseAdminClient();

  const result =
    await firebase.rpc(
      "mutate_project_workspace",
      {
        p_project_id:
          projectId,

        p_expected_updated_at:
          parsed.data
            .expectedUpdatedAt,

        p_values:
          parsed.data.values,

        p_links:
          parsed.data.links,

        p_actor_user_id:
          admin.user.id,
      },
    );

  if (result.error) {
    return mutationErrorResponse(
      result.error,
    );
  }

  const payload =
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
      ? result.data as Record<
          string,
          unknown
        >
      : null;

  const project =
    payload?.project &&
    typeof payload.project === "object" &&
    !Array.isArray(
      payload.project,
    )
      ? payload.project as Record<
          string,
          unknown
        >
      : null;

  const links =
    Array.isArray(payload?.links)
      ? payload.links
      : [];

  if (!project) {
    return jsonError(
      "Could not verify saved project.",
      500,
      "server_error",
    );
  }

  const slug =
    typeof project.slug === "string"
      ? project.slug
      : "";

  await writeAdminAudit({
    actorUserId:
      admin.user.id,

    action:
      "project_workspace_saved",

    entityType:
      "projects",

    entityId:
      projectId,

    metadata: {
      revisionRecorded:
        payload
          ?.revisionRecorded === true,

      revisionId:
        payload?.revisionId ?? null,

      requestId:
        payload?.requestId ?? null,
    },

    request,
  });

  if (slug) {
    revalidateProjectContent(slug);
  }

  return jsonOk({
    project,
    links,
  });
}