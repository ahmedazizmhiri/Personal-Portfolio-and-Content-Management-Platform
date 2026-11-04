const publicPrefixes = new Set(["public-assets", "project-images", "resumes"]);

export const parseFirebaseAsset = (value: string, storageBucket: string) => {
  try {
    if (!storageBucket) return null;
    const url = new URL(value);
    const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || url.port || url.username || url.password || !match || decodeURIComponent(match[1]) !== storageBucket) return null;
    const object = decodeURIComponent(match[2]);
    const slash = object.indexOf("/");
    const bucket = object.slice(0, slash), path = object.slice(slash + 1);
    if (!publicPrefixes.has(bucket) || !path || path.split("/").some((part) => part === ".." || part === ".") || path.includes("\\")) return null;
    return { bucket, path };
  } catch { return null; }
};
