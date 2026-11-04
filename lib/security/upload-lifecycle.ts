import type { UploadBucket } from "@/lib/cms-types";
import { parseFirebaseAsset } from "@/lib/firebase/assets";
import type { EditableCmsTable } from "@/lib/security/validation";

export const uploadDeletionGraceMs = 5 * 60 * 1_000;

export type UploadDeletionStatus = "active" | "pending" | "failed";
export type UploadDeletionPhase = "schedule" | "wait" | "reconcile";

export const uploadReferenceFields: Partial<
  Record<EditableCmsTable, readonly string[]>
> = {
  profile: ["avatar_url"],
  about: ["avatar_url"],
  projects: ["cover_image_url", "card_image_url", "open_graph_image"],
  experience: ["logo_url"],
  certifications: ["image_url"],
  resumes: ["pdf_url", "docx_url"],
  pages: ["open_graph_image"],
  page_section_items: ["media_url"],
  project_media: ["media_url"],
  volunteering: ["logo_url"],
};

const uploadBucketSet = new Set<UploadBucket>([
  "public-assets",
  "project-images",
  "resumes",
  "uploads",
]);

export const getUploadDeletionPhase = ({
  status,
  requestedAt,
  now = Date.now(),
}: {
  status: UploadDeletionStatus;
  requestedAt: string | null;
  now?: number;
}): UploadDeletionPhase => {
  if (status === "active") return "schedule";

  const requestedAtMs = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  if (!Number.isFinite(requestedAtMs)) return "schedule";
  return now - requestedAtMs >= uploadDeletionGraceMs
    ? "reconcile"
    : "wait";
};

export const cmsUploadReferences = (
  table: EditableCmsTable,
  row: Record<string, unknown>,
) =>
  [...new Set((uploadReferenceFields[table] ?? []).flatMap((field) => {
    const value = row[field];
    return typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
  }))];

export const parsePublicStorageReference = (value: string): {
  bucket: UploadBucket;
  path: string;
} | null => {
  const firebase = parseFirebaseAsset(value, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? "");
  if (firebase) return { bucket: firebase.bucket as UploadBucket, path: firebase.path };
  let pathname: string;
  try {
    pathname = value.startsWith("/")
      ? new URL(value, "https://portfolio.invalid").pathname
      : new URL(value).pathname;
  } catch {
    return null;
  }

  const match =
    /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(pathname);
  if (!match) return null;

  try {
    const bucket = decodeURIComponent(match[1]) as UploadBucket;
    const path = match[2]
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (!uploadBucketSet.has(bucket) || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
};

export const uploadReferenceCandidates = ({
  bucket,
  path,
  publicUrl,
}: {
  bucket: UploadBucket;
  path: string;
  publicUrl: string | null;
}) =>
  [...new Set([
    path,
    publicUrl,
    `/storage/v1/object/public/${bucket}/${path}`,
  ].filter((value): value is string => Boolean(value)))];
