import "server-only";
import { randomUUID } from "node:crypto";
import { firebaseBucket } from "./core";
import { firebaseEnv } from "./config";

const validPath = (path: string) => path && !path.startsWith("/") && !path.split("/").some((part) => part === ".." || part === ".") && !path.includes("\\");
export const firebaseObjectPath = (bucket: string, path: string) => {
  if (!["public-assets", "project-images", "resumes", "uploads"].includes(bucket) || !validPath(path)) throw new Error("Invalid storage path.");
  return `${bucket}/${path}`;
};
export const publicStorageUrl = (bucket: string, path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseEnv.storageBucket)}/o/${encodeURIComponent(firebaseObjectPath(bucket, path))}?alt=media`;

export const createStorageClient = () => ({
  from: (bucket: string) => ({
    upload: async (path: string, buffer: Buffer, options: { contentType?: string; upsert?: boolean; cacheControl?: string } = {}) => {
      try {
        const object = firebaseBucket().file(firebaseObjectPath(bucket, path));
        await object.save(buffer, {
          resumable: false,
          preconditionOpts: options.upsert ? undefined : { ifGenerationMatch: 0 },
          metadata: { contentType: options.contentType, cacheControl: bucket !== "uploads" ? "public, max-age=3600" : "private, no-store", metadata: { uploadId: randomUUID() } },
        });
        return { data: { path }, error: null };
      } catch { return { data: null, error: { message: "Storage upload failed." } }; }
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: publicStorageUrl(bucket, path) } }),
    createSignedUrl: async (path: string, expiresIn: number, _options?: unknown) => {
      try {
        const [signedUrl] = await firebaseBucket().file(firebaseObjectPath(bucket, path)).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + Math.min(3600, expiresIn) * 1000 });
        return { data: { signedUrl }, error: null };
      } catch { return { data: null, error: { message: "Storage URL could not be created." } }; }
    },
    remove: async (paths: string[]) => {
      try {
        await Promise.all(paths.map((path) => firebaseBucket().file(firebaseObjectPath(bucket, path)).delete({ ignoreNotFound: true })));
        return { data: paths.map((name) => ({ name })), error: null };
      } catch { return { data: null, error: { message: "Storage deletion failed." } }; }
    },
  }),
});
