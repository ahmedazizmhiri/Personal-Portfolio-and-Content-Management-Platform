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
  projectSlugRenameSchema,
  projectWorkspaceProjectIdSchema,
} from "@/lib/projects/project-workspace-validation";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";

export const dynamic =
  "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

const mutationErrorResponse = (
  error: {
    code?: string | null;
    message?: string | null;
  },
) => {
  switch (
    error.code
  ) {
    case "CMS02":
      return jsonError(
        "This project changed in another session. Reload before renaming the slug.",
        409,
        "edit_conflict",
      );

    case "CMS03":
      return jsonError(
        "Project not found.",
        404,
        "not_found",
      );

    case "CMS08":
    case "23505":
      return jsonError(
        "This slug is already in use or permanently reserved by project history.",
        409,
        "slug_conflict",
      );

    case "CMS01":
    case "CMS07":
    case "22023":
    case "22P02":
    case "23514":
      return jsonError(
        "Invalid project slug.",
        400,
        "validation_error",
      );

    case "42883":
    case "PGRST202":
      return jsonError(
        "The Wave 2D slug migration must be applied first.",
        503,
        "migration_required",
      );

    default:
      return jsonError(
        "The project slug could not be renamed.",
        500,
        "server_error",
      );
  }
};

const revalidateSlugPaths = (
  previousSlug: string,
  newSlug: string,
) => {
  revalidatePath("/");
  revalidatePath(
    "/projects",
  );

  revalidatePath(
    "/projects/[slug]",
    "page",
  );

  if (
    previousSlug
  ) {
    revalidatePath(
      `/projects/${previousSlug}`,
    );
  }

  if (
    newSlug
  ) {
    revalidatePath(
      `/projects/${newSlug}`,
    );
  }

  revalidatePath(
    "/sitemap.xml",
  );

  revalidatePath(
    "/llms.txt",
  );

  for (
    const tag of [
      "public-cms-projects",
      "public-cms-presentation",
    ]
  ) {
    revalidateTag(
      tag,
      "max",
    );
  }
};

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

  const {
    projectId,
  } =
    await context.params;

  const projectIdResult =
    projectWorkspaceProjectIdSchema
      .safeParse(
        projectId,
      );

  if (
    !projectIdResult.success
  ) {
    return jsonError(
      "Invalid project identifier.",
      400,
      "validation_error",
    );
  }

  const limited =
    await consumeRateLimit({
      scope:
        "admin_project_slug_rename",

      identifiers: [
        admin.user.id,
        clientIp(
          request,
        ),
      ],

      limit: 20,

      windowMs:
        10 *
        60 *
        1000,
    });

  if (
    !limited.allowed
  ) {
    return rateLimitResponse(
      limited,
    );
  }

  const body =
    await request
      .json()
      .catch(
        () => null,
      );

  const parsed =
    projectSlugRenameSchema
      .safeParse(
        body,
      );

  if (
    !parsed.success
  ) {
    return jsonError(
      parsed.error
        .issues[0]
        ?.message ??
        "Invalid project slug.",

      400,
      "validation_error",
    );
  }

  const firebase =
    createFirebaseAdminClient();

  const result =
    await firebase.rpc(
      "rename_project_slug",
      {
        p_project_id:
          projectId,

        p_expected_updated_at:
          parsed.data
            .expectedUpdatedAt,

        p_new_slug:
          parsed.data.slug,

        p_actor_user_id:
          admin.user.id,
      },
    );

  if (
    result.error
  ) {
    return mutationErrorResponse(
      result.error,
    );
  }

  const payload =
    result.data &&
    typeof result.data ===
      "object" &&
    !Array.isArray(
      result.data,
    )
      ? result.data as Record<
          string,
          unknown
        >
      : null;

  const project =
    payload?.project &&
    typeof payload.project ===
      "object" &&
    !Array.isArray(
      payload.project,
    )
      ? payload.project as Record<
          string,
          unknown
        >
      : null;

  if (
    !project
  ) {
    return jsonError(
      "Could not verify the renamed project.",
      500,
      "server_error",
    );
  }

  const previousSlug =
    typeof payload
      ?.previousSlug ===
      "string"
      ? payload.previousSlug
      : "";

  const newSlug =
    typeof project.slug ===
      "string"
      ? project.slug
      : "";

  const slugChanged =
    payload
      ?.slugChanged ===
      true;

  if (
    !newSlug
  ) {
    return jsonError(
      "Could not verify the new project slug.",
      500,
      "server_error",
    );
  }

  if (
    slugChanged
  ) {
    await writeAdminAudit({
      actorUserId:
        admin.user.id,

      action:
        "project_slug_renamed",

      entityType:
        "projects",

      entityId:
        projectId,

      metadata: {
        previousSlug,
        newSlug,

        revisionRecorded:
          payload
            ?.revisionRecorded ===
          true,

        revisionId:
          payload
            ?.revisionId ??
          null,

        requestId:
          payload
            ?.requestId ??
          null,
      },

      request,
    });

    revalidateSlugPaths(
      previousSlug,
      newSlug,
    );
  }

  return jsonOk({
    project,

    previousSlug,

    newSlug,

    slugChanged,
  });
}