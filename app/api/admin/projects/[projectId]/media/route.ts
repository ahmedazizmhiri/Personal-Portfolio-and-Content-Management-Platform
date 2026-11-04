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
  projectMediaCreateSchema,
  projectMediaDeleteSchema,
  projectMediaProjectIdSchema,
  projectMediaUpdateSchema,
} from "@/lib/projects/project-media-validation";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";

export const dynamic =
  "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type MediaAction =
  | "create"
  | "update"
  | "delete";

type AtomicMediaMutation = {
  row:
    | Record<string, unknown>
    | null;

  operation:
    MediaAction;

  revisionRecorded: true;

  revisionId: string;

  requestId: string;
};

const mutationError = (
  error: {
    code?: string | null;
    message?: string | null;
  },
) => {
  switch (error.code) {
    case "CMS02":
      return jsonError(
        "This media item changed in another session. Reload before saving.",
        409,
        "edit_conflict",
      );

    case "CMS03":
      return jsonError(
        "Media item not found.",
        404,
        "not_found",
      );

    case "CMS05":
      return jsonError(
        "This change would leave a visible section without meaningful evidence.",
        409,
        "project_incomplete",
      );

    case "CMS01":
    case "CMS07":
    case "22023":
    case "22P02":
    case "23514":
      return jsonError(
        "Invalid project media data.",
        400,
        "validation_error",
      );

    case "42883":
    case "PGRST202":
      return jsonError(
        "The Wave 2C-B media migration must be applied first.",
        503,
        "migration_required",
      );

    default:
      return jsonError(
        "Project media could not be changed.",
        500,
        "server_error",
      );
  }
};

const parseMutation = (
  value: unknown,
): AtomicMediaMutation | null => {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const result =
    value as Record<
      string,
      unknown
    >;

  if (
    ![
      "create",
      "update",
      "delete",
    ].includes(
      String(
        result.operation,
      ),
    ) ||
    result.revisionRecorded !==
      true ||
    typeof result.revisionId !==
      "string" ||
    typeof result.requestId !==
      "string" ||
    (
      result.row !==
        null &&
      (
        typeof result.row !==
          "object" ||
        Array.isArray(
          result.row,
        )
      )
    )
  ) {
    return null;
  }

  return result as
    AtomicMediaMutation;
};

const revalidateMedia = async (
  projectId: string,
) => {
  const firebase =
    createFirebaseAdminClient();

  const project =
    await firebase
      .from("projects")
      .select("slug")
      .eq(
        "id",
        projectId,
      )
      .maybeSingle();

  revalidatePath("/");
  revalidatePath(
    "/projects",
  );

  revalidatePath(
    "/projects/[slug]",
    "page",
  );

  if (
    typeof project.data?.slug ===
    "string"
  ) {
    revalidatePath(
      `/projects/${project.data.slug}`,
    );
  }

  revalidateTag(
    "public-cms-projects",
    "max",
  );
};

const executeMutation =
  async (
    request: Request,
    context: RouteContext,
    action: MediaAction,
  ) => {
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

    if (
      !projectMediaProjectIdSchema
        .safeParse(
          projectId,
        )
        .success
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
          "admin_project_media",

        identifiers: [
          admin.user.id,
          clientIp(request),
        ],

        limit: 60,

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
        .catch(() => null);

    let mediaId:
      | string
      | null = null;

    let expectedUpdatedAt:
      | string
      | null = null;

    let values:
      Record<
        string,
        unknown
      > = {};

    if (
      action ===
      "create"
    ) {
      const parsed =
        projectMediaCreateSchema
          .safeParse(body);

      if (
        !parsed.success
      ) {
        return jsonError(
          parsed.error
            .issues[0]
            ?.message ??
            "Invalid media data.",

          400,
          "validation_error",
        );
      }

      values =
        parsed.data
          .values;
    }

    if (
      action ===
      "update"
    ) {
      const parsed =
        projectMediaUpdateSchema
          .safeParse(body);

      if (
        !parsed.success
      ) {
        return jsonError(
          parsed.error
            .issues[0]
            ?.message ??
            "Invalid media data.",

          400,
          "validation_error",
        );
      }

      mediaId =
        parsed.data.id;

      expectedUpdatedAt =
        parsed.data
          .expectedUpdatedAt;

      values =
        parsed.data
          .values;
    }

    if (
      action ===
      "delete"
    ) {
      const parsed =
        projectMediaDeleteSchema
          .safeParse(body);

      if (
        !parsed.success
      ) {
        return jsonError(
          "Reload this media item before deleting it.",
          409,
          "optimistic_lock_required",
        );
      }

      mediaId =
        parsed.data.id;

      expectedUpdatedAt =
        parsed.data
          .expectedUpdatedAt;
    }

    const firebase =
      createFirebaseAdminClient();

    const result =
      await firebase.rpc(
        "mutate_project_media",
        {
          p_action:
            action,

          p_project_id:
            projectId,

          p_media_id:
            mediaId,

          p_expected_updated_at:
            expectedUpdatedAt,

          p_values:
            values,

          p_actor_user_id:
            admin.user.id,
        },
      );

    if (
      result.error
    ) {
      return mutationError(
        result.error,
      );
    }

    const mutation =
      parseMutation(
        result.data,
      );

    if (
      !mutation ||
      mutation.operation !==
        action
    ) {
      return jsonError(
        "Could not verify the media mutation.",
        500,
        "server_error",
      );
    }

    const entityId =
      mutation.row &&
      typeof mutation
        .row.id ===
        "string"
        ? mutation.row.id
        : mediaId;

    await writeAdminAudit({
      actorUserId:
        admin.user.id,

      action:
        `project_media_${action}d`,

      entityType:
        "project_media",

      entityId:
        entityId ??
        projectId,

      metadata: {
        projectId,

        revisionRecorded:
          true,

        revisionId:
          mutation.revisionId,

        requestId:
          mutation.requestId,

        storageDeleted:
          false,
      },

      request,
    });

    await revalidateMedia(
      projectId,
    );

    return jsonOk({
      row:
        mutation.row,

      operation:
        mutation.operation,
    });
  };

export async function POST(
  request: Request,
  context: RouteContext,
) {
  return executeMutation(
    request,
    context,
    "create",
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  return executeMutation(
    request,
    context,
    "update",
  );
}

export async function DELETE(
  request: Request,
  context: RouteContext,
) {
  return executeMutation(
    request,
    context,
    "delete",
  );
}