// apps/api/src/modules/storage/local-storage.controller.ts
//
// PUBLIC (unauthenticated) HTTP surface for the DEV "local" storage provider. Authenticated
// by the HMAC signature embedded in the signed URL (a bearer credential), NOT a browser
// session — so these routes are CSRF-excluded (see app.module.ts) and carry no guards,
// exactly like the HMAC-verified webhook controllers.
//
//   PUT  /api/v1/storage/local/<key>?sig&exp        — accept a signed upload, write to disk.
//   GET  /api/v1/storage/local/<key>?sig&exp&op=download — signed private download.
//   GET  /api/v1/assets/<key>                       — public asset serve (mentor/faculty photos).
//
// Only meaningful when STORAGE_PROVIDER=local; with any other provider these keys are never
// minted, so the routes simply 404/403 on stray requests.

import { Controller, Get, Put, Req, Res } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SkipEnvelope } from "../../common/decorators/skip-envelope.decorator";
import { validateEnv } from "../../config/env";
import {
  verifyStorageToken,
  resolveObjectPath,
  contentTypeForKey,
  resolveLocalStorageDir,
} from "./providers/storage/local-storage.lib";
import { sanitizeDownloadFilename } from "./providers/storage/storage-provider.interface";
import { isPrivateStorageKey } from "./providers/storage/s3-storage.provider";

const STORAGE_LOCAL_PREFIX = "/api/v1/storage/local/";
const ASSETS_PREFIX = "/api/v1/assets/";

// Hard cap for a local dev upload. Sized for source video (the CRM video-ingest drawer
// offers 5 GB client-side); images/PDFs sit far below it. The body is streamed to disk,
// so a large upload costs disk, not RSS.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/** Extract the (possibly slash-containing) storage key that follows a known route prefix. */
function keyFromPath(reqPath: string, prefix: string): string {
  const idx = reqPath.indexOf(prefix);
  if (idx < 0) return "";
  try {
    return decodeURIComponent(reqPath.slice(idx + prefix.length));
  } catch {
    return reqPath.slice(idx + prefix.length);
  }
}

/** Thrown by the size meter so the handler can answer 413 rather than a generic failure. */
class UploadTooLargeError extends Error {}

/**
 * Stream the raw request bytes to `destPath`, enforcing MAX_UPLOAD_BYTES as they flow.
 *
 * NestJS's `rawBody` only populates for content-types a body parser handles
 * (json/urlencoded/text) — a binary `video/mp4` or `image/png` PUT matches none, so the
 * stream is left unread and we consume it here. Streaming (rather than buffering into a
 * Buffer) is what keeps a multi-hundred-MB source video off the heap.
 *
 * Returns the number of bytes written.
 */
async function writeRawBodyToDisk(
  req: RawBodyRequest<Request>,
  destPath: string,
): Promise<number> {
  if (req.rawBody && req.rawBody.length > 0) {
    if (req.rawBody.length > MAX_UPLOAD_BYTES) throw new UploadTooLargeError();
    await writeFile(destPath, req.rawBody);
    return req.rawBody.length;
  }

  let total = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        cb(new UploadTooLargeError());
        return;
      }
      cb(null, chunk);
    },
  });

  await pipeline(req, meter, createWriteStream(destPath));
  return total;
}

@SkipEnvelope()
@Controller()
export class LocalStorageController {
  private readonly baseDir: string;
  private readonly secret: string;

  constructor() {
    const env = validateEnv();
    this.baseDir = resolveLocalStorageDir(env.LOCAL_STORAGE_DIR);
    this.secret = env.COOKIE_SECRET;
  }

  /** Accept a signed direct upload and write it to disk. */
  @Put("storage/local/*")
  async upload(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const key = keyFromPath(req.path, STORAGE_LOCAL_PREFIX);
    const sig = String(req.query.sig ?? "");
    const expS = Number(req.query.exp ?? 0);
    if (!key || !verifyStorageToken(this.secret, "upload", key, expS, sig)) {
      res.status(403).json({ error: "Invalid or expired upload signature" });
      return;
    }
    const p = resolveObjectPath(this.baseDir, key);
    await mkdir(dirname(p), { recursive: true });

    let written: number;
    try {
      written = await writeRawBodyToDisk(req, p);
    } catch (err) {
      // A partial object on disk is worse than none — a later signed GET would serve a
      // truncated file as if it were whole.
      await unlink(p).catch(() => undefined);
      const tooLarge = err instanceof UploadTooLargeError;
      res
        .status(tooLarge ? 413 : 400)
        .json({ error: tooLarge ? "Upload too large" : "Upload failed" });
      return;
    }

    if (written === 0) {
      await unlink(p).catch(() => undefined);
      res.status(400).json({ error: "Empty request body" });
      return;
    }
    res.status(200).json({ ok: true });
  }

  /** Signed private download (submissions, certificates). */
  @Get("storage/local/*")
  async download(@Req() req: Request, @Res() res: Response): Promise<void> {
    const key = keyFromPath(req.path, STORAGE_LOCAL_PREFIX);
    const sig = String(req.query.sig ?? "");
    const expS = Number(req.query.exp ?? 0);
    if (!key || !verifyStorageToken(this.secret, "download", key, expS, sig)) {
      res.status(403).end();
      return;
    }
    // `filename` (set when the caller asked for an attachment) is NOT part of the signed
    // payload — it only affects the response header, never which object is served — so it
    // is sanitised rather than verified. The S3 provider expresses the same thing via
    // ResponseContentDisposition on the presigned GET.
    const filename = req.query.filename ? sanitizeDownloadFilename(String(req.query.filename)) : undefined;
    await this.serve(key, res, filename, req.header("range"));
  }

  /**
   * Public asset serve (mentor photos, programme images, college logos) — no signature.
   *
   * The namespace check is what makes "no signature" acceptable. This route reads the
   * SAME `baseDir` through the SAME `resolveObjectPath` as the signed download above,
   * and it verifies nothing — so without it, any key at all was fetchable by anyone who
   * knew or guessed one: `submissions/…` (student work), `careers/…` (resumes),
   * `onboarding/…` (payment receipts), `invoices/…`, `receipts/…`, `exports/…` (PII
   * CSVs). Path traversal was already blocked; the namespace was not.
   *
   * `isPrivateStorageKey` is the same predicate `mintCdnUrl` uses to decide what may be
   * published, so the two surfaces cannot drift: if a URL would not be minted for a key,
   * this will not serve it either.
   */
  @Get("assets/*")
  async asset(@Req() req: Request, @Res() res: Response): Promise<void> {
    const key = keyFromPath(req.path, ASSETS_PREFIX);
    if (!key || isPrivateStorageKey(key)) {
      // 404, not 403: an unsigned caller must not learn that the object exists.
      res.status(404).end();
      return;
    }
    await this.serve(key, res, undefined, req.header("range"));
  }

  private async serve(
    key: string,
    res: Response,
    downloadFilename?: string,
    rangeHeader?: string,
  ): Promise<void> {
    try {
      const buf = await readFile(resolveObjectPath(this.baseDir, key));
      const contentType = contentTypeForKey(key);
      res.setHeader("Content-Type", contentType);
      // The declared type is the type. Without nosniff a browser may sniff an uploaded
      // file's bytes and execute what it decides is HTML, which turns any upload
      // namespace into a script-hosting origin.
      res.setHeader("X-Content-Type-Options", "nosniff");
      // SVG is a document, not just a picture: opened directly it can carry <script> and
      // run it on THIS origin. `default-src 'none'` leaves it renderable inside an
      // <img>/<object> (which is how logos are used) while stripping its ability to
      // execute anything, so college and partner logos keep working.
      if (contentType === "image/svg+xml") {
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (downloadFilename) {
        res.setHeader("Content-Disposition", `attachment; filename="${downloadFilename}"`);
      }

      // RANGE SUPPORT (video seeking). A <video> element scrubs by requesting byte
      // ranges; answering every request with the full body makes the timeline
      // unseekable (and Safari refuses to start playback at all without a 206 path).
      // Advertised via Accept-Ranges so the browser knows it can seek.
      res.setHeader("Accept-Ranges", "bytes");
      const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
      if (match) {
        const size = buf.length;
        const startRaw = match[1];
        const endRaw = match[2];
        // Suffix form ("bytes=-500") means "the last N bytes".
        const start = startRaw ? Number(startRaw) : Math.max(0, size - Number(endRaw || 0));
        const end = startRaw ? (endRaw ? Math.min(Number(endRaw), size - 1) : size - 1) : size - 1;

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          res.setHeader("Content-Range", `bytes */${size}`);
          res.status(416).end();
          return;
        }

        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        res.status(206).end(buf.subarray(start, end + 1));
        return;
      }

      res.status(200).send(buf);
    } catch {
      res.status(404).end();
    }
  }
}
