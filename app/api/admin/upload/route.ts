import { createHash, randomUUID } from "crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { z } from "zod";

import type { UploadBucket, UploadRecord } from "@/lib/cms-types";
import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import { isFirebaseAdminConfigured, isFirebaseStorageConfigured } from "@/lib/firebase/config";
import { requireAdminApi, writeAdminAudit } from "@/lib/security/admin-auth";
import { clientIp, jsonError, jsonOk } from "@/lib/security/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import {
  getUploadDeletionPhase,
  uploadReferenceCandidates,
  uploadReferenceFields,
} from "@/lib/security/upload-lifecycle";
import {
  extensionForUpload,
  uploadBuckets,
  validateUpload,
} from "@/lib/security/uploads";

export const dynamic = "force-dynamic";

const bucketSchema = z.enum(uploadBuckets);

const allowedMimeByExt: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

const publicBuckets = new Set(["public-assets", "project-images", "resumes"]);
const maxFileSize = 10 * 1024 * 1024;
const uploadFields = "id,bucket,path,public_url,mime_type,size_bytes,original_name,uploaded_by,created_at,sha256,deletion_status,deletion_requested_at,deletion_error_code";

const uploadListSchema = z.object({
  bucket: bucketSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
}).strict();

const uploadDeleteSchema = z.object({
  id: z.string().uuid(),
}).strict();

const localBucketFor = (path: string): UploadBucket => {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("projects/")) return "project-images";
  if (normalized.startsWith("cv/")) return "resumes";
  return "public-assets";
};

const publicUrlFor = (path: string) =>
  `/${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;

const readLocalPublicAssets = async (): Promise<UploadRecord[]> => {
  const publicRoot = join(process.cwd(), "public");
  const files: string[] = [];

  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && allowedMimeByExt[extensionForUpload(entry.name)]) {
        files.push(absolutePath);
      }
    }
  };

  try {
    await visit(publicRoot);
  } catch (error) {
    console.error("Could not scan built-in public assets.", error);
    return [];
  }

  const assets: UploadRecord[] = [];
  for (const absolutePath of files) {
    try {
      const file = await stat(absolutePath);
      const path = absolutePath.slice(publicRoot.length + 1).split(sep).join("/");
      const extension = extname(path).slice(1).toLowerCase();
      const mimeType = allowedMimeByExt[extension]?.[0];
      if (!mimeType) continue;

      assets.push({
        id: `local:${path}`,
        source: "local",
        bucket: localBucketFor(path),
        path,
        public_url: publicUrlFor(path),
        mime_type: mimeType,
        size_bytes: file.size,
        original_name: basename(path),
        uploaded_by: null,
        created_at: file.mtime.toISOString(),
      });
    } catch (error) {
      console.error("Could not inspect a built-in public asset.", error);
    }
  }

  return assets;
};

export async function GET(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true, sameOrigin: false });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError("CMS server configuration is incomplete.", 500, "server_error");
  }

  const url = new URL(request.url);
  const parsed = uploadListSchema.safeParse({
    bucket: url.searchParams.get("bucket") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    return jsonError("Invalid upload filters.", 400, "validation_error");
  }

  const localAssetsPromise = readLocalPublicAssets();
  const firebase = createFirebaseAdminClient();
  let query = firebase
    .from("uploads")
    .select(uploadFields)
    .in("deletion_status", ["active", "pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.bucket) {
    query = query.eq("bucket", parsed.data.bucket);
  }

  const { data, error } = await query;
  if (error) return jsonError("Could not load uploads.", 500, "server_error");

  const localAssets = (await localAssetsPromise).filter((asset) =>
    !parsed.data.bucket || asset.bucket === parsed.data.bucket,
  );
  const storageAssets = (data ?? []).map((asset) => ({
    ...(asset as UploadRecord),
    source: "storage" as const,
  }));
  const uploads = [...storageAssets, ...localAssets]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, parsed.data.limit);

  return jsonOk({ uploads, storageEnabled: isFirebaseStorageConfigured() });
}

export async function POST(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) return jsonError("CMS server configuration is incomplete.", 500, "server_error");
  if (!isFirebaseStorageConfigured()) return jsonError("Cloud uploads are not enabled. Choose an existing site asset or add files to the project and redeploy.", 409, "storage_not_enabled");

  const limited = await consumeRateLimit({
    scope: "admin_upload",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 20,
    windowMs: 10 * 60 * 1_000,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) {
    return jsonError("Upload request is too large.", 413, "payload_too_large");
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError("Invalid upload request.", 400, "validation_error");
  const bucketParsed = bucketSchema.safeParse(String(formData.get("bucket") ?? "uploads"));
  if (!bucketParsed.success) return jsonError("Invalid upload bucket.", 400, "validation_error");

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) return jsonError("File is required.", 400, "validation_error");

  if (fileValue.name.length > 255 || fileValue.size <= 0 || fileValue.size > maxFileSize) {
    return jsonError("File size is not allowed.", 400, "validation_error");
  }

  const buffer = Buffer.from(await fileValue.arrayBuffer());
  const bucket = bucketParsed.data;
  const validation = validateUpload({
    bucket,
    name: fileValue.name,
    mime: fileValue.type,
    size: fileValue.size,
    buffer,
  });
  if (!validation.ok) {
    return jsonError(
      validation.code === "invalid_docx"
        ? "The DOCX package is malformed or contains unsupported embedded content."
        : "File type, bucket, size, or signature is not allowed.",
      400,
      validation.code,
    );
  }

  const digest = createHash("sha256").update(buffer).digest("hex");
  const path = `${admin.user.id}/${randomUUID()}.${validation.extension}`;
  const firebase = createFirebaseAdminClient();

  const duplicate = await firebase
    .from("uploads")
    .select("id,bucket,path")
    .eq("sha256", digest)
    .eq("deletion_status", "active")
    .limit(1)
    .maybeSingle();
  if (duplicate.error) {
    return jsonError(
      "Upload hardening migration is required before files can be added.",
      503,
      "migration_required",
    );
  }
  if (duplicate.data) {
    return jsonError(
      "An identical file is already stored.",
      409,
      "duplicate_upload",
    );
  }

  const uploaded = await firebase.storage.from(bucket).upload(path, buffer, {
    contentType: fileValue.type,
    upsert: false,
  });

  if (uploaded.error) {
    return jsonError("Upload failed.", 500, "server_error");
  }

  const publicUrl = publicBuckets.has(bucket)
    ? firebase.storage.from(bucket).getPublicUrl(uploaded.data.path).data.publicUrl
    : null;

  const { data, error } = await firebase
    .from("uploads")
    .insert({
      bucket,
      path: uploaded.data.path,
      public_url: publicUrl,
      mime_type: fileValue.type,
      size_bytes: fileValue.size,
      original_name: fileValue.name,
      uploaded_by: admin.user.id,
      sha256: digest,
      deletion_status: "active",
    })
    .select(uploadFields)
    .single();

  if (error || !data) {
    await firebase.storage.from(bucket).remove([uploaded.data.path]);
    return jsonError("Upload metadata could not be saved.", 500, "server_error");
  }

  await writeAdminAudit({ actorUserId: admin.user.id, action: "upload_created", entityType: "uploads", entityId: data.id, request });
  return jsonOk({ upload: data, publicUrl });
}

export async function DELETE(request: Request) {
  const admin = await requireAdminApi(request, { requireMfa: true });
  if (!admin.ok) return admin.response;
  if (!isFirebaseAdminConfigured()) {
    return jsonError("CMS server configuration is incomplete.", 500, "server_error");
  }

  const parsed = uploadDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Invalid upload deletion.", 400, "validation_error");
  }

  const limited = await consumeRateLimit({
    scope: "admin_upload_delete",
    identifiers: [admin.user.id, clientIp(request)],
    limit: 10,
    windowMs: 10 * 60 * 1_000,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const firebase = createFirebaseAdminClient();
  const existing = await firebase
    .from("uploads")
    .select(
      "id,bucket,path,public_url,deletion_status,deletion_requested_at,deletion_error_code",
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (existing.error) {
    return jsonError("Could not load the upload.", 500, "server_error");
  }
  if (!existing.data) {
    return jsonError("Upload not found.", 404, "not_found");
  }

  const bucketParsed = bucketSchema.safeParse(existing.data.bucket);
  if (!bucketParsed.success || !existing.data.path) {
    return jsonError("Stored upload metadata is invalid.", 500, "server_error");
  }

  const status =
    existing.data.deletion_status === "pending"
    || existing.data.deletion_status === "failed"
      ? existing.data.deletion_status
      : "active";
  const phase = getUploadDeletionPhase({
    status,
    requestedAt: existing.data.deletion_requested_at,
  });

  if (phase === "schedule") {
    const requestedAt = new Date().toISOString();
    const pending = await firebase
      .from("uploads")
      .update({
        deletion_status: "pending",
        deletion_requested_at: requestedAt,
        deletion_error_code: null,
      })
      .eq("id", existing.data.id)
      .eq("deletion_status", status)
      .select(uploadFields)
      .maybeSingle();
    if (pending.error || !pending.data) {
      return jsonError(
        "Could not schedule upload deletion.",
        409,
        "delete_conflict",
      );
    }

    await writeAdminAudit({
      actorUserId: admin.user.id,
      action: "upload_deletion_scheduled",
      entityType: "uploads",
      entityId: existing.data.id,
      metadata: { bucket: bucketParsed.data },
      request,
    });

    return jsonOk({
      phase: "pending",
      upload: pending.data,
      message:
        "Deletion scheduled. The stored file will remain available for at least five minutes before reconciliation.",
    }, 202);
  }

  if (phase === "wait") {
    return jsonError(
      "Upload deletion is already in progress. Retry reconciliation after five minutes.",
      409,
      "deletion_in_progress",
    );
  }

  const reconciliationClaim = `reconciling:${randomUUID()}`;
  let claimQuery = firebase
    .from("uploads")
    .update({
      deletion_error_code: reconciliationClaim,
    })
    .eq("id", existing.data.id)
    .eq("deletion_status", status)
    .eq("deletion_requested_at", existing.data.deletion_requested_at);
  claimQuery = existing.data.deletion_error_code === null
    ? claimQuery.is("deletion_error_code", null)
    : claimQuery.eq(
      "deletion_error_code",
      existing.data.deletion_error_code,
    );
  const claim = await claimQuery
    .select(uploadFields)
    .maybeSingle();
  if (claim.error || !claim.data) {
    return jsonError(
      "Upload deletion is being reconciled by another request.",
      409,
      "delete_conflict",
    );
  }

  const candidates = uploadReferenceCandidates({
    bucket: bucketParsed.data,
    path: existing.data.path,
    publicUrl: existing.data.public_url,
  });
  let isReferenced = false;
  let referenceCheckFailed = false;

  for (const [table, fields] of Object.entries(uploadReferenceFields)) {
    for (const field of fields) {
      const references = await firebase
        .from(table)
        .select("id")
        .in(field, candidates)
        .limit(1);
      if (references.error) {
        referenceCheckFailed = true;
        break;
      }
      if ((references.data ?? []).length > 0) {
        isReferenced = true;
        break;
      }
    }
    if (isReferenced || referenceCheckFailed) break;
  }

  if (referenceCheckFailed) {
    await firebase
      .from("uploads")
      .update({
        deletion_status: "failed",
        deletion_error_code: "reference_check_unavailable",
      })
      .eq("id", existing.data.id)
      .eq("deletion_error_code", reconciliationClaim);
    return jsonError(
      "Could not verify whether this upload is in use.",
      503,
      "reference_check_unavailable",
    );
  }

  if (isReferenced) {
    const restored = await firebase
      .from("uploads")
      .update({
        deletion_status: "active",
        deletion_requested_at: null,
        deletion_error_code: null,
      })
      .eq("id", existing.data.id)
      .eq("deletion_error_code", reconciliationClaim)
      .select(uploadFields)
      .maybeSingle();
    if (restored.error || !restored.data) {
      return jsonError(
        "The upload is in use, but its active state could not be restored.",
        500,
        "restore_failed",
      );
    }

    await writeAdminAudit({
      actorUserId: admin.user.id,
      action: "upload_deletion_cancelled_in_use",
      entityType: "uploads",
      entityId: existing.data.id,
      metadata: { bucket: bucketParsed.data },
      request,
    });

    return jsonOk({
      phase: "restored",
      upload: restored.data,
      message:
        "Deletion was cancelled because the upload is referenced by CMS content.",
    });
  }

  const removed = await firebase.storage
    .from(bucketParsed.data)
    .remove([existing.data.path]);
  if (removed.error) {
    await firebase
      .from("uploads")
      .update({
        deletion_status: "failed",
        deletion_error_code: "storage_remove_failed",
      })
      .eq("id", existing.data.id)
      .eq("deletion_error_code", reconciliationClaim);
    return jsonError("Could not delete the stored file.", 500, "server_error");
  }

  const deleted = await firebase
    .from("uploads")
    .delete()
    .eq("id", existing.data.id)
    .eq("deletion_error_code", reconciliationClaim)
    .select("id")
    .maybeSingle();
  if (deleted.error || !deleted.data) {
    await firebase
      .from("uploads")
      .update({
        deletion_status: "failed",
        deletion_error_code: "metadata_delete_failed",
      })
      .eq("id", existing.data.id)
      .eq("deletion_error_code", reconciliationClaim);
    return jsonError("Could not delete upload metadata.", 500, "server_error");
  }

  await writeAdminAudit({
    actorUserId: admin.user.id,
    action: "upload_deleted",
    entityType: "uploads",
    entityId: existing.data.id,
    metadata: { bucket: bucketParsed.data },
    request,
  });

  return jsonOk({
    id: existing.data.id,
    phase: "deleted",
    message: "Deleted.",
  });
}
