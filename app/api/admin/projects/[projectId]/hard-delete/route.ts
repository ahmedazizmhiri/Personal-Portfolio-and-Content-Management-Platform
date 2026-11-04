import {
  revalidatePath,
  revalidateTag,
} from "next/cache";

import type {
  SecureUploadBucket,
} from "@/lib/security/uploads";

import {
  uploadBuckets,
} from "@/lib/security/uploads";

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
  uploadReferenceCandidates,
  uploadReferenceFields,
} from "@/lib/security/upload-lifecycle";

import {
  projectHardDeleteSchema,
  projectWorkspaceProjectIdSchema,
} from "@/lib/projects/project-workspace-validation";

import {
  createFirebaseAdminClient,
} from "@/lib/firebase/admin";

export const dynamic =
  "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type ProjectDeletionStatus =
  | "active"
  | "pending"
  | "failed";

type ProjectDeleteRow = {
  id: string;
  slug: string;
  status: string;
  published: boolean;

  deletion_status:
    ProjectDeletionStatus;

  deletion_requested_at:
    string | null;

  deletion_error_code:
    string | null;

  updated_at: string;
};

type PreparedUpload = {
  uploadId: string;

  bucket:
    SecureUploadBucket;

  path: string;

  publicUrl:
    string | null;

  mimeType:
    string | null;

  deletionStatus:
    ProjectDeletionStatus;

  projectReferenceCount:
    number;

  exclusiveToProject:
    boolean;
};

const uploadBucketSet =
  new Set<string>(
    uploadBuckets,
  );

const deletionStatuses =
  new Set<
    ProjectDeletionStatus
  >([
    "active",
    "pending",
    "failed",
  ]);

const isRecord = (
  value: unknown,
): value is Record<
  string,
  unknown
> =>
  Boolean(value) &&
  typeof value ===
    "object" &&
  !Array.isArray(value);

const parseProject = (
  value: unknown,
): ProjectDeleteRow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const deletionStatus =
    typeof value
      .deletion_status ===
      "string"
      ? value
          .deletion_status as
          ProjectDeletionStatus
      : null;

  if (
    typeof value.id !==
      "string" ||
    typeof value.slug !==
      "string" ||
    typeof value.status !==
      "string" ||
    typeof value.published !==
      "boolean" ||
    typeof value.updated_at !==
      "string" ||
    !deletionStatus ||
    !deletionStatuses.has(
      deletionStatus,
    )
  ) {
    return null;
  }

  return {
    id:
      value.id,

    slug:
      value.slug,

    status:
      value.status,

    published:
      value.published,

    deletion_status:
      deletionStatus,

    deletion_requested_at:
      typeof value
        .deletion_requested_at ===
        "string"
        ? value
            .deletion_requested_at
        : null,

    deletion_error_code:
      typeof value
        .deletion_error_code ===
        "string"
        ? value
            .deletion_error_code
        : null,

    updated_at:
      value.updated_at,
  };
};

const parsePreparedUpload = (
  value: unknown,
): PreparedUpload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const bucket =
    typeof value.bucket ===
      "string" &&
    uploadBucketSet.has(
      value.bucket,
    )
      ? value
          .bucket as
          SecureUploadBucket
      : null;

  const deletionStatus =
    typeof value
      .deletionStatus ===
      "string"
      ? value
          .deletionStatus as
          ProjectDeletionStatus
      : null;

  const referenceCount =
    typeof value
      .projectReferenceCount ===
      "number"
      ? value
          .projectReferenceCount
      : Number(
          value
            .projectReferenceCount,
        );

  if (
    typeof value.uploadId !==
      "string" ||
    !bucket ||
    typeof value.path !==
      "string" ||
    !value.path ||
    !deletionStatus ||
    !deletionStatuses.has(
      deletionStatus,
    ) ||
    !Number.isFinite(
      referenceCount,
    ) ||
    referenceCount < 1 ||
    typeof value
      .exclusiveToProject !==
      "boolean"
  ) {
    return null;
  }

  return {
    uploadId:
      value.uploadId,

    bucket,

    path:
      value.path,

    publicUrl:
      typeof value
        .publicUrl ===
        "string"
        ? value.publicUrl
        : null,

    mimeType:
      typeof value
        .mimeType ===
        "string"
        ? value.mimeType
        : null,

    deletionStatus,

    projectReferenceCount:
      referenceCount,

    exclusiveToProject:
      value
        .exclusiveToProject,
  };
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
        "This project changed in another session. Reload before permanently deleting it.",
        409,
        "edit_conflict",
      );

    case "CMS03":
      return jsonError(
        "Project not found.",
        404,
        "not_found",
      );

    case "CMS06":
      return jsonError(
        "This project is still linked from published page content.",
        409,
        "project_link_conflict",
      );

    case "CMS09":
      return jsonError(
        "The typed project slug does not match the current project slug.",
        400,
        "slug_confirmation_mismatch",
      );

    case "CMS10":
      return jsonError(
        "Only archived and unpublished projects can be permanently deleted.",
        409,
        "project_not_archived",
      );

    case "CMS11":
      return jsonError(
        "Project deletion is already pending.",
        409,
        "deletion_in_progress",
      );

    case "CMS01":
    case "CMS07":
    case "22023":
    case "22P02":
    case "23514":
      return jsonError(
        "Invalid permanent project deletion request.",
        400,
        "validation_error",
      );

    case "42883":
    case "PGRST202":
      return jsonError(
        "The Wave 2E hard-delete migration must be applied first.",
        503,
        "migration_required",
      );

    default:
      return jsonError(
        "The project could not be permanently deleted.",
        500,
        "server_error",
      );
  }
};

const loadProject = async (
  firebase:
    ReturnType<
      typeof createFirebaseAdminClient
    >,
  projectId: string,
) => {
  const result =
    await firebase
      .from("projects")
            .select(
        "id,slug,status,published,deletion_status,deletion_requested_at,deletion_error_code,updated_at",
      )
      .eq(
        "id",
        projectId,
      )
      .maybeSingle();

  if (
    result.error
  ) {
    return {
      error:
        result.error,
      project:
        null,
    };
  }

  return {
    error:
      null,

    project:
      parseProject(
        result.data,
      ),
  };
};

const loadPendingInventory =
  async (
    firebase:
      ReturnType<
        typeof createFirebaseAdminClient
      >,
    projectId: string,
  ): Promise<{
    uploads:
      PreparedUpload[] |
      null;
  }> => {
    const projectLinks =
      await firebase
        .from(
          "project_uploads",
        )
        .select(
          "upload_id",
        )
        .eq(
          "project_id",
          projectId,
        );

    if (
      projectLinks.error
    ) {
      return {
        uploads:
          null,
      };
    }

    const uploadIds =
      [
        ...new Set(
          (
            projectLinks
              .data ??
            []
          )
            .map(
              (
                relation,
              ) =>
                typeof relation
                  .upload_id ===
                  "string"
                  ? relation
                      .upload_id
                  : "",
            )
            .filter(Boolean),
        ),
      ];

    if (
      uploadIds.length ===
      0
    ) {
      return {
        uploads: [],
      };
    }

    const [
      uploadsResult,
      referencesResult,
    ] =
      await Promise.all([
                firebase
          .from("uploads")
          .select(
            "id,bucket,path,public_url,mime_type,deletion_status",
          )
          .in(
            "id",
            uploadIds,
          ),

        firebase
          .from(
            "project_uploads",
          )
          .select(
            "upload_id,project_id",
          )
          .in(
            "upload_id",
            uploadIds,
          ),
      ]);

    if (
      uploadsResult.error ||
      referencesResult.error
    ) {
      return {
        uploads:
          null,
      };
    }

    const projectsByUpload =
      new Map<
        string,
        Set<string>
      >();

    for (
      const relation of
      referencesResult.data ??
      []
    ) {
      const uploadId =
        typeof relation
          .upload_id ===
          "string"
          ? relation
              .upload_id
          : "";

      const relationProjectId =
        typeof relation
          .project_id ===
          "string"
          ? relation
              .project_id
          : "";

      if (
        !uploadId ||
        !relationProjectId
      ) {
        continue;
      }

      const projects =
        projectsByUpload.get(
          uploadId,
        ) ??
        new Set<string>();

      projects.add(
        relationProjectId,
      );

      projectsByUpload.set(
        uploadId,
        projects,
      );
    }

    const uploads:
      PreparedUpload[] = [];

    for (
      const upload of
      uploadsResult.data ??
      []
    ) {
      const uploadId =
        typeof upload.id ===
          "string"
          ? upload.id
          : "";

      const projectCount =
        projectsByUpload
          .get(
            uploadId,
          )
          ?.size ?? 0;

      const parsed =
        parsePreparedUpload({
          uploadId,

          bucket:
            upload.bucket,

          path:
            upload.path,

          publicUrl:
            upload.public_url,

          mimeType:
            upload.mime_type,

          deletionStatus:
            upload
              .deletion_status,

          projectReferenceCount:
            projectCount,

          exclusiveToProject:
            projectCount ===
            1,
        });

      if (!parsed) {
        return {
          uploads:
            null,
        };
      }

      uploads.push(
        parsed,
      );
    }

    return {
      uploads,
    };
  };

const hardDeleteReferenceFields:
  Record<
    string,
    readonly string[]
  > = {
    ...uploadReferenceFields,

    projects: [
      ...(
        uploadReferenceFields
          .projects ??
        []
      ),

      "placeholder_image_url",
    ],
  };

const hasExternalCmsReference =
  async (
    firebase:
      ReturnType<
        typeof createFirebaseAdminClient
      >,
    projectId: string,
    candidates: string[],
  ): Promise<{
    ok: boolean;
    referenced: boolean;
  }> => {
    for (
      const [
        table,
        fields,
      ] of Object.entries(
        hardDeleteReferenceFields,
      )
    ) {
      for (
        const field of
        fields
      ) {
        const baseQuery =
          firebase
            .from(table)
            .select("id")
            .in(
              field,
              candidates,
            )
            .limit(1);

        const result =
          table ===
          "projects"
            ? await baseQuery
                .neq(
                  "id",
                  projectId,
                )
            : table ===
                "project_media"
              ? await baseQuery
                  .neq(
                    "project_id",
                    projectId,
                  )
              : await baseQuery;

        if (
          result.error
        ) {
          return {
            ok: false,
            referenced:
              false,
          };
        }

        if (
          (
            result.data ??
            []
          ).length > 0
        ) {
          return {
            ok: true,
            referenced:
              true,
          };
        }
      }
    }

    return {
      ok: true,
      referenced:
        false,
    };
  };

const markFailed = async ({
  firebase,
  projectId,
  actorUserId,
  errorCode,
  request,
}: {
  firebase:
    ReturnType<
      typeof createFirebaseAdminClient
    >;

  projectId: string;

  actorUserId:
    string;

  errorCode:
    string;

  request:
    Request;
}) => {
  const result =
    await firebase.rpc(
      "mark_project_hard_delete_failed",
      {
        p_project_id:
          projectId,

        p_error_code:
          errorCode,

        p_actor_user_id:
          actorUserId,
      },
    );

  if (
    result.error
  ) {
    console.error(
      "Project hard-delete failure state could not be recorded.",
      {
        incidentId:
          "CMS-PROJECT-HARD-DELETE-FAILURE-STATE",
      },
    );
  }

  await writeAdminAudit({
    actorUserId,

    action:
      "project_hard_delete_failed",

    entityType:
      "projects",

    entityId:
      projectId,

    metadata: {
      errorCode,

      failureStateRecorded:
        !result.error,
    },

    request,
  });
};

const revalidateDeletedProject = (
  slug: string,
) => {
  revalidatePath("/");
  revalidatePath(
    "/admin",
  );
  revalidatePath(
    "/projects",
  );

  revalidatePath(
    "/projects/[slug]",
    "page",
  );

  if (slug) {
    revalidatePath(
      `/projects/${slug}`,
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

export async function DELETE(
  request: Request,
  context: RouteContext,
) {
  const admin =
    await requireAdminApi(
      request,
      {
        requireMfa:
          true,
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
        "admin_project_hard_delete",

      identifiers: [
        admin.user.id,
        clientIp(
          request,
        ),
      ],

      limit: 5,

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
    projectHardDeleteSchema
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
        "Invalid permanent deletion request.",

      400,
      "validation_error",
    );
  }

  const firebase =
    createFirebaseAdminClient();

  const loaded =
    await loadProject(
      firebase,
      projectId,
    );

  if (
    loaded.error
  ) {
    return jsonError(
      "Could not load the project.",
      500,
      "server_error",
    );
  }

  let project =
    loaded.project;

  if (!project) {
    return jsonError(
      "Project not found.",
      404,
      "not_found",
    );
  }

  if (
    project.slug !==
    parsed.data
      .confirmSlug
  ) {
    return jsonError(
      "Type the current project slug exactly before permanently deleting it.",
      400,
      "slug_confirmation_mismatch",
    );
  }

  if (
    project.status !==
      "archived" ||
    project.published
  ) {
    return jsonError(
      "Archive and unpublish the project before permanently deleting it.",
      409,
      "project_not_archived",
    );
  }

  let resumed =
    project
      .deletion_status ===
    "pending";

  let prepareRevisionId:
    string | null =
      null;

  let prepareRequestId:
    string | null =
      null;

  let uploads:
    PreparedUpload[] |
    null = null;

  if (resumed) {
    if (
      project.updated_at !==
      parsed.data
        .expectedUpdatedAt
    ) {
      return jsonError(
        "This pending deletion changed after the workspace was loaded. Reload before reconciling it.",
        409,
        "edit_conflict",
      );
    }

    const inventory =
      await loadPendingInventory(
        firebase,
        projectId,
      );

    uploads =
      inventory.uploads;

    if (!uploads) {
      await markFailed({
        firebase,
        projectId,
        actorUserId:
          admin.user.id,
        errorCode:
          "pending_inventory_failed",
        request,
      });

      return jsonError(
        "The pending deletion inventory could not be reconstructed.",
        503,
        "delete_reconciliation_failed",
      );
    }
  } else {
    const prepared =
      await firebase.rpc(
        "prepare_project_hard_delete",
        {
          p_project_id:
            projectId,

          p_expected_updated_at:
            parsed.data
              .expectedUpdatedAt,

          p_confirm_slug:
            parsed.data
              .confirmSlug,

          p_actor_user_id:
            admin.user.id,
        },
      );

    if (
      prepared.error
    ) {
      return mutationErrorResponse(
        prepared.error,
      );
    }

    const payload =
      isRecord(
        prepared.data,
      )
        ? prepared.data
        : null;

    const preparedProject =
      parseProject(
        payload
          ?.project,
      );

    const rawUploads =
      Array.isArray(
        payload?.uploads,
      )
        ? payload.uploads
        : null;

    const parsedUploads =
      rawUploads
        ?.map(
          parsePreparedUpload,
        )
        .filter(
          (
            upload,
          ): upload is
            PreparedUpload =>
            Boolean(
              upload,
            ),
        ) ??
      null;

    if (
      !preparedProject ||
      !rawUploads ||
      !parsedUploads ||
      parsedUploads.length !==
        rawUploads.length
    ) {
      await markFailed({
        firebase,
        projectId,
        actorUserId:
          admin.user.id,
        errorCode:
          "prepare_payload_invalid",
        request,
      });

      return jsonError(
        "The prepared deletion payload could not be verified.",
        500,
        "server_error",
      );
    }

    project =
      preparedProject;

    uploads =
      parsedUploads;

    prepareRevisionId =
      typeof payload
        ?.revisionId ===
        "string"
        ? payload
            .revisionId
        : null;

    prepareRequestId =
      typeof payload
        ?.requestId ===
        "string"
        ? payload
            .requestId
        : null;
  }

  if (!uploads) {
    return jsonError(
      "Project upload inventory could not be verified.",
      500,
      "server_error",
    );
  }

  await writeAdminAudit({
    actorUserId:
      admin.user.id,

    action:
      resumed
        ? "project_hard_delete_resumed"
        : "project_hard_delete_started",

    entityType:
      "projects",

    entityId:
      projectId,

    metadata: {
      slug:
        project.slug,

      resumed,

      uploadCount:
        uploads.length,

      prepareRevisionId,

      prepareRequestId,
    },

    request,
  });

  const deletedUploadIds:
    string[] = [];

  const alreadyMissingUploadIds:
    string[] = [];

  const preservedSharedUploadIds:
    string[] = [];

  const preservedExternalUploadIds:
    string[] = [];

  const fail = async (
    message: string,
    status: number,
    code: string,
    errorCode: string,
  ) => {
    await markFailed({
      firebase,
      projectId,
      actorUserId:
        admin.user.id,
      errorCode,
      request,
    });

    return jsonError(
      message,
      status,
      code,
    );
  };

  for (
    const upload of
    uploads
  ) {
    if (
      !upload
        .exclusiveToProject
    ) {
      preservedSharedUploadIds
        .push(
          upload.uploadId,
        );

      continue;
    }

        const current =
      await firebase
        .from("uploads")
        .select(
          "id,bucket,path,public_url,deletion_status",
        )
        .eq(
          "id",
          upload.uploadId,
        )
        .maybeSingle();
    if (
      current.error
    ) {
      return fail(
        "An upload could not be verified before project deletion.",
        503,
        "upload_check_unavailable",
        "upload_lookup_failed",
      );
    }

    if (
      !current.data
    ) {
      alreadyMissingUploadIds
        .push(
          upload.uploadId,
        );

      continue;
    }

    const bucket =
      typeof current
        .data.bucket ===
        "string" &&
      uploadBucketSet.has(
        current.data.bucket,
      )
        ? current.data
            .bucket as
            SecureUploadBucket
        : null;

    const path =
      typeof current
        .data.path ===
        "string"
        ? current.data.path
        : "";

    if (
      !bucket ||
      !path ||
      bucket !==
        upload.bucket ||
      path !==
        upload.path
    ) {
      return fail(
        "An upload changed while permanent project deletion was running.",
        409,
        "delete_conflict",
        "upload_identity_changed",
      );
    }

    if (
      current
        .data
        .deletion_status !==
      "active"
    ) {
      return fail(
        "A project upload is already in another deletion lifecycle. Reconcile that upload first.",
        409,
        "upload_unavailable",
        "upload_not_active",
      );
    }

    const candidates =
      uploadReferenceCandidates({
        bucket,
        path,

        publicUrl:
          typeof current
            .data
            .public_url ===
            "string"
            ? current
                .data
                .public_url
            : null,
      });

    const externalReference =
      await hasExternalCmsReference(
        firebase,
        projectId,
        candidates,
      );

    if (
      !externalReference.ok
    ) {
      return fail(
        "Could not verify whether a project upload is used elsewhere.",
        503,
        "reference_check_unavailable",
        "reference_check_unavailable",
      );
    }

    if (
      externalReference
        .referenced
    ) {
      preservedExternalUploadIds
        .push(
          upload.uploadId,
        );

      continue;
    }

    const removed =
      await firebase
        .storage
        .from(bucket)
        .remove([
          path,
        ]);

    if (
      removed.error
    ) {
      return fail(
        "The stored project file could not be deleted.",
        500,
        "storage_remove_failed",
        "storage_remove_failed",
      );
    }

    const deleted =
      await firebase
        .from("uploads")
        .delete()
        .eq(
          "id",
          upload.uploadId,
        )
        .eq(
          "bucket",
          bucket,
        )
        .eq(
          "path",
          path,
        )
        .eq(
          "deletion_status",
          "active",
        )
        .select("id")
        .maybeSingle();

    if (
      deleted.error
    ) {
      return fail(
        "The project file was removed from Storage, but its metadata could not be deleted.",
        500,
        "metadata_delete_failed",
        "metadata_delete_failed",
      );
    }

    if (
      !deleted.data
    ) {
      const stillExists =
        await firebase
          .from("uploads")
          .select("id")
          .eq(
            "id",
            upload.uploadId,
          )
          .maybeSingle();

      if (
        stillExists.error ||
        stillExists.data
      ) {
        return fail(
          "The project file metadata changed while deletion was running.",
          409,
          "delete_conflict",
          "metadata_delete_conflict",
        );
      }
    }

    deletedUploadIds.push(
      upload.uploadId,
    );
  }

  const finalized =
    await firebase.rpc(
      "finalize_project_hard_delete",
      {
        p_project_id:
          projectId,

        p_confirm_slug:
          project.slug,

        p_actor_user_id:
          admin.user.id,
      },
    );

  if (
    finalized.error
  ) {
    return fail(
      "Storage cleanup completed, but the project database deletion could not be finalized.",
      500,
      "finalize_failed",
      "finalize_failed",
    );
  }

  const finalPayload =
    isRecord(
      finalized.data,
    )
      ? finalized.data
      : null;

  if (
    !finalPayload ||
    finalPayload.phase !==
      "deleted"
  ) {
    const remaining =
      await firebase
        .from("projects")
        .select("id")
        .eq(
          "id",
          projectId,
        )
        .maybeSingle();

    if (
      remaining.error ||
      remaining.data
    ) {
      return fail(
        "The final project deletion result could not be verified.",
        500,
        "finalize_failed",
        "finalize_result_invalid",
      );
    }
  }

  const deletedSlug =
    typeof finalPayload
      ?.deletedSlug ===
      "string"
      ? finalPayload
          .deletedSlug
      : project.slug;

  await writeAdminAudit({
    actorUserId:
      admin.user.id,

    action:
      "project_hard_deleted",

    entityType:
      "projects",

    entityId:
      projectId,

    metadata: {
      deletedSlug,

      resumed,

      deletedUploadIds,

      alreadyMissingUploadIds,

      preservedSharedUploadIds,

      preservedExternalUploadIds,

      prepareRevisionId,

      prepareRequestId,

      finalizeRevisionId:
        typeof finalPayload
          ?.revisionId ===
          "string"
          ? finalPayload
              .revisionId
          : null,

      finalizeRequestId:
        typeof finalPayload
          ?.requestId ===
          "string"
          ? finalPayload
              .requestId
          : null,
    },

    request,
  });

  revalidateDeletedProject(
    deletedSlug,
  );

  return jsonOk({
    phase:
      "deleted",

    projectId,

    deletedSlug,

    deletedUploadIds,

    alreadyMissingUploadIds,

    preservedSharedUploadIds,

    preservedExternalUploadIds,
  });
}