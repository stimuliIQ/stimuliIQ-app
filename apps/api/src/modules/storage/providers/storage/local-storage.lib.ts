// apps/api/src/modules/storage/providers/storage/local-storage.lib.ts
//
// Pure helpers shared by LocalStorageProvider (mints signed URLs, writes objects) and
// LocalStorageController (verifies signatures, reads/writes objects). Kept dependency-free
// so both sides agree on the signing scheme + on-disk layout with no DI coupling.
//
// The "local" storage provider is a DEV/LOCAL adapter only — it lets file uploads + public
// image serving work on localhost with no cloud credentials. It is never selected in
// production (StorageProviderModule binds S3/R2 there).

import { createHmac, timingSafeEqual } from "node:crypto";
import * as path from "node:path";

export type StorageOp = "upload" | "download";

/** HMAC-SHA256 over `op:key:exp`. The signed URL is a short-lived bearer credential. */
export function signStorageToken(secret: string, op: StorageOp, key: string, expS: number): string {
  return createHmac("sha256", secret).update(`${op}:${key}:${expS}`).digest("hex");
}

/** Constant-time verify of a signed token, also enforcing expiry. */
export function verifyStorageToken(
  secret: string,
  op: StorageOp,
  key: string,
  expS: number,
  sig: string,
): boolean {
  if (!Number.isFinite(expS) || expS * 1000 < Date.now()) return false;
  const expected = signStorageToken(secret, op, key, expS);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolve a storage key to an absolute on-disk path INSIDE `baseDir`, rejecting traversal.
 * Keys are our own `buildKey()` output (namespace/tenant/uuid-file), so segment
 * sanitisation is defence-in-depth. Write and read both call this with the same key, so
 * the mapping is deterministic.
 */
export function resolveObjectPath(baseDir: string, key: string): string {
  const safeSegments = key
    .split("/")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter((seg) => seg && seg !== "." && seg !== "..");
  const root = path.resolve(baseDir);
  const full = path.resolve(root, ...safeSegments);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("Resolved storage path escapes the storage root");
  }
  return full;
}

/** Best-effort content-type from a key's extension (for serving public assets). */
export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "m3u8":
      return "application/vnd.apple.mpegurl";
    case "vtt":
      return "text/vtt";
    default:
      // Source videos are stored under `video/…` with an OPAQUE, extensionless key
      // (the provider asset id), so the extension switch can't classify them. Serving
      // them as application/octet-stream makes <video> refuse to play the file — the
      // browser needs a video/* type. mp4 is the only container the upload flow
      // accepts for source video, so it is the correct default here.
      if (key.startsWith("video/")) return "video/mp4";
      return "application/octet-stream";
  }
}

/** The on-disk root the local provider writes to (env override or `<cwd>/.local-storage`). */
export function resolveLocalStorageDir(localStorageDir: string | undefined): string {
  return localStorageDir ? path.resolve(localStorageDir) : path.resolve(process.cwd(), ".local-storage");
}
