"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  FiCopy,
  FiExternalLink,
  FiFileText,
  FiHardDrive,
  FiImage,
  FiLock,
  FiRefreshCw,
  FiTrash2,
  FiUploadCloud,
} from "react-icons/fi";

import type { UploadBucket, UploadRecord } from "@/lib/cms-types";
import { uploadDeletionGraceMs } from "@/lib/security/upload-lifecycle";

import {
  adminApiError,
  type AdminRequest,
  parseUploads,
  readJsonObject,
} from "./admin-api";
import { AssetImagePreview } from "./asset-image-preview";

type MediaLibraryProps = {
  initialUploads: UploadRecord[];
  request: AdminRequest;
};

type MediaFilter = "all" | UploadBucket;

const inputClass = "w-full rounded-lg border border-white/10 bg-[#151030] px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-300/60";
const filters: { value: MediaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "public-assets", label: "Public assets" },
  { value: "project-images", label: "Project images" },
  { value: "resumes", label: "Resumes" },
  { value: "uploads", label: "Private uploads (disabled)" },
];

const bucketNotes: { bucket: UploadBucket; title: string; description: string }[] = [
  { bucket: "public-assets", title: "Public assets", description: "Profile avatars, logos, certification images and general public images." },
  { bucket: "project-images", title: "Project images", description: "Project cover images and project artwork." },
  { bucket: "resumes", title: "Resumes", description: "Public PDF and DOCX CV files." },
  { bucket: "uploads", title: "Private uploads", description: "Unavailable: this store is public. Never upload confidential documents here." },
];

const formatBytes = (bytes: number | null) => {
  if (bytes === null || !Number.isFinite(bytes)) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const assetName = (asset: UploadRecord) => asset.original_name || asset.path.split("/").pop() || "Asset";
const sortUploads = (uploads: UploadRecord[]) => [...uploads].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

export function MediaLibrary({ initialUploads, request }: MediaLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState(() => sortUploads(initialUploads));
  const [storageEnabled, setStorageEnabled] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [bucket, setBucket] = useState<UploadBucket>("public-assets");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading Media Library...");

  useEffect(() => {
    const controller = new AbortController();

    const loadUploads = async () => {
      try {
        const response = await request("/api/admin/upload?limit=200", { signal: controller.signal });
        const data = await readJsonObject(response);
        if (!response.ok || data.ok !== true) {
          setStatus(adminApiError(data));
          return;
        }
          setUploads(sortUploads(parseUploads(data.uploads)));
          setStorageEnabled(data.storageEnabled === true);
        setStatus("");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("Could not load the Media Library.");
        }
      }
    };

    void loadUploads();
    const refreshTimer = window.setInterval(() => {
      void loadUploads();
    }, 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      controller.abort();
    };
  }, [request]);

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setStatus("Choose a file to upload.");
      return;
    }

    const formData = new FormData();
    formData.set("bucket", bucket);
    formData.set("file", selectedFile);
    setUploading(true);
    setStatus("Uploading asset...");

    try {
      const response = await request("/api/admin/upload", { method: "POST", body: formData });
      const data = await readJsonObject(response);
      const uploaded = parseUploads([data.upload])[0];
      if (!response.ok || data.ok !== true || !uploaded) {
        setStatus(adminApiError(data));
        return;
      }

      setUploads((current) => sortUploads([uploaded, ...current.filter((item) => item.id !== uploaded.id)]));
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setStatus(`${assetName(uploaded)} uploaded successfully.`);
    } catch {
      setStatus("The asset could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  const deleteUpload = async (asset: UploadRecord) => {
    const name = assetName(asset);
    const reconciliation = asset.deletion_status !== "active";
    if (!window.confirm(
      reconciliation
        ? `Reconcile the scheduled deletion for ${name}? References will be checked again before Storage is changed.`
        : `Schedule ${name} for deletion? The file remains in Storage for at least five minutes and is checked for CMS references before removal.`,
    )) return;

    setDeletingId(asset.id);
    setStatus(
      reconciliation
        ? `Reconciling deletion for ${name}...`
        : `Scheduling deletion for ${name}...`,
    );
    try {
      const response = await request("/api/admin/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id }),
      });
      const data = await readJsonObject(response);
      const returnedUpload = parseUploads([data.upload])[0];
      if (returnedUpload) {
        setUploads((current) => sortUploads([
          returnedUpload,
          ...current.filter((item) => item.id !== returnedUpload.id),
        ]));
      }
      if (!response.ok || data.ok !== true) {
        setStatus(adminApiError(data));
        return;
      }

      if (data.phase === "pending" && returnedUpload) {
        setStatus(
          `${name} is pending deletion. Reconcile it after the five-minute safety window.`,
        );
      } else if (data.phase === "restored" && returnedUpload) {
        setStatus(
          `${name} remains active because CMS content still references it.`,
        );
      } else if (data.phase === "deleted") {
        setUploads((current) =>
          current.filter((item) => item.id !== asset.id));
        setStatus(`${name} deleted.`);
      } else {
        setStatus(
          typeof data.message === "string"
            ? data.message
            : `Deletion state for ${name} was updated.`,
        );
      }
    } catch {
      setStatus("The asset could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  };

  const copyUrl = async (asset: UploadRecord) => {
    if (!asset.public_url) return;
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      setStatus("Clipboard access is unavailable in this browser. Open the asset and copy its URL manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(asset.public_url);
      setStatus(`Copied the URL for ${assetName(asset)}.`);
    } catch {
      setStatus("The browser blocked clipboard access.");
    }
  };

  const openPrivateUpload = async (asset: UploadRecord) => {
    setOpeningId(asset.id);
    setStatus(`Creating a private link for ${assetName(asset)}...`);
    try {
      const response = await request("/api/admin/upload/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id }),
      });
      const data = await readJsonObject(response);
      if (
        !response.ok
        || data.ok !== true
        || typeof data.url !== "string"
      ) {
        setStatus(adminApiError(data));
        return;
      }

      const link = document.createElement("a");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      setStatus(`Opened a 60-second private link for ${assetName(asset)}.`);
    } catch {
      setStatus("The private upload could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  const filteredUploads = filter === "all" ? uploads : uploads.filter((asset) => asset.bucket === filter);

  return (
    <div>
      <h2 className="text-2xl font-bold text-white">Media Library</h2>
      <p className="mt-2 text-sm text-gray-400">Upload, inspect and reuse CMS assets. Repository files under public are included as read-only built-in assets.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {bucketNotes.map((note) => (
          <article key={note.bucket} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <h3 className="font-medium text-white">{note.title}</h3>
            <p className="mt-2 text-xs leading-5 text-gray-400">{note.description}</p>
            <p className="mt-3 font-mono text-[0.65rem] text-cyan-200">{note.bucket}</p>
          </article>
        ))}
      </div>

      {storageEnabled ? <form onSubmit={upload} className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <div className="grid gap-4 lg:grid-cols-[13rem_1fr_auto] lg:items-end">
          <label className="grid gap-2 text-sm text-gray-300">
            <span>Storage bucket</span>
            <select value={bucket} onChange={(event) => setBucket(event.target.value as UploadBucket)} className={inputClass}>
              {bucketNotes.filter((note) => note.bucket !== "uploads").map((note) => <option key={note.bucket} value={note.bucket}>{note.title}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-2 text-sm text-gray-300">
            <span>File</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
              onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={uploading}
            className="button-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          >
            <FiUploadCloud aria-hidden="true" />
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">Accepted: JPG, PNG, WebP, PDF and DOCX, up to 4 MB. Public files only: anyone with the URL can access them. Do not upload personal or confidential documents.</p>
      </form> : <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-gray-300">Assets are served with the site. Choose an existing file below, or add new files to the project&apos;s public directory and redeploy.</p>}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Media Library">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={filter === item.value
                ? "rounded-lg border border-cyan-300/30 bg-cyan-400/15 px-3 py-2 text-xs font-medium text-cyan-100"
                : "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500">{filteredUploads.length} asset{filteredUploads.length === 1 ? "" : "s"}</p>
      </div>

      <p className="mt-4 min-h-5 break-words text-sm text-cyan-100" aria-live="polite">{status}</p>

      <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredUploads.map((asset) => {
          const name = assetName(asset);
          const isImage = asset.mime_type?.startsWith("image/") ?? false;
          const isDocument = asset.mime_type === "application/pdf" || asset.mime_type?.includes("wordprocessingml") === true;
          const isDeleting = deletingId === asset.id;
          const isOpening = openingId === asset.id;
          const isBuiltIn = asset.source === "local";
          const deletionStatus = asset.deletion_status ?? "active";
          const deletionRequestedAt = asset.deletion_requested_at
            ? Date.parse(asset.deletion_requested_at)
            : Number.NaN;
          const reconciliationAt = Number.isFinite(deletionRequestedAt)
            ? new Date(deletionRequestedAt + uploadDeletionGraceMs)
            : null;

          return (
            <article key={asset.id} aria-busy={isDeleting} className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
              <div className="p-3">
                {isImage && asset.public_url ? (
                  <AssetImagePreview key={asset.public_url} src={asset.public_url} alt={`Preview of ${name}`} className="h-40 w-full" />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg bg-black/20 text-cyan-200">
                    {isDocument ? <FiFileText aria-hidden="true" className="h-10 w-10" /> : isImage ? <FiImage aria-hidden="true" className="h-10 w-10" /> : <FiHardDrive aria-hidden="true" className="h-10 w-10" />}
                  </div>
                )}
              </div>

              <div className="min-w-0 border-t border-white/10 p-4">
                <div className="flex items-start gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-semibold text-white" title={name}>{name}</h3>
                  {!asset.public_url && <FiLock aria-label="Private asset" className="mt-1 shrink-0 text-purple-200" />}
                </div>
                <dl className="mt-3 grid gap-1 text-xs text-gray-400">
                  <div className="flex gap-2"><dt className="shrink-0 text-gray-500">Bucket:</dt><dd className="min-w-0 truncate font-mono" title={asset.bucket}>{asset.bucket}</dd></div>
                  <div className="flex gap-2"><dt className="shrink-0 text-gray-500">Type:</dt><dd className="min-w-0 truncate" title={asset.mime_type ?? undefined}>{asset.mime_type ?? "Unknown"}</dd></div>
                  <div className="flex gap-2"><dt className="shrink-0 text-gray-500">Size:</dt><dd>{formatBytes(asset.size_bytes)}</dd></div>
                  <div className="flex gap-2"><dt className="shrink-0 text-gray-500">Source:</dt><dd>{isBuiltIn ? "Built-in file" : "Vercel Blob"}</dd></div>
                  {!isBuiltIn && deletionStatus !== "active" && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-500">Deletion:</dt>
                      <dd className="text-amber-200">
                        {deletionStatus === "pending"
                          ? "pending safety window"
                          : "failed; retry available"}
                      </dd>
                    </div>
                  )}
                  {!isBuiltIn && deletionStatus !== "active" && reconciliationAt && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-500">Reconcile after:</dt>
                      <dd>{formatDateTime(reconciliationAt.toISOString())}</dd>
                    </div>
                  )}
                  {!isBuiltIn && asset.deletion_error_code && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-500">Last result:</dt>
                      <dd className="min-w-0 truncate font-mono" title={asset.deletion_error_code}>
                        {asset.deletion_error_code}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-2"><dt className="shrink-0 text-gray-500">{isBuiltIn ? "Modified:" : "Uploaded:"}</dt><dd>{formatDateTime(asset.created_at)}</dd></div>
                </dl>
                {asset.public_url ? (
                  <p className="mt-3 truncate font-mono text-[0.65rem] text-gray-500" title={asset.public_url}>{asset.public_url}</p>
                ) : (
                  <p className="mt-3 text-xs text-purple-200">Private CMS-only file — no public URL.</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {asset.public_url && deletionStatus === "active" && (
                    <>
                      <button type="button" onClick={() => void copyUrl(asset)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                        <FiCopy aria-hidden="true" />Copy URL
                      </button>
                      <a href={asset.public_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                        <FiExternalLink aria-hidden="true" />Open
                      </a>
                    </>
                  )}
                  {!asset.public_url
                    && asset.source === "storage"
                    && asset.bucket === "uploads"
                    && deletionStatus === "active" && (
                      <button
                        type="button"
                        disabled={isOpening}
                        onClick={() => void openPrivateUpload(asset)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300/20 bg-purple-500/10 px-3 py-2 text-xs text-purple-100 hover:bg-purple-500/20 disabled:cursor-wait disabled:opacity-50"
                      >
                        <FiExternalLink aria-hidden="true" />
                        {isOpening ? "Opening..." : "Open privately"}
                      </button>
                    )}
                  {isBuiltIn ? (
                    <span className="inline-flex items-center rounded-lg border border-cyan-300/15 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100">
                      Read-only built-in
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void deleteUpload(asset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 hover:bg-red-500/20 disabled:cursor-wait disabled:opacity-50"
                    >
                      {deletionStatus === "active"
                        ? <FiTrash2 aria-hidden="true" />
                        : <FiRefreshCw aria-hidden="true" />}
                      {isDeleting
                        ? "Working..."
                        : deletionStatus === "active"
                          ? "Schedule deletion"
                          : "Reconcile deletion"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!filteredUploads.length && status !== "Loading Media Library..." && (
        <p className="mt-6 rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-gray-400">No assets match this filter.</p>
      )}
    </div>
  );
}
