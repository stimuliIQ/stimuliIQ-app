// apps/api/src/modules/storage/providers/storage/local-storage.provider.ts
//
// DEV/LOCAL StorageProvider: stores objects on the API server's own disk and mints signed
// URLs that point back at the API (LocalStorageController serves + accepts them). This lets
// file uploads and public image serving work on localhost with NO cloud credentials/CDN.
//
// Selected when STORAGE_PROVIDER=local. NEVER bound in production (StorageProviderModule
// binds S3/R2 there). The signing secret is COOKIE_SECRET (always present, ≥32 chars).

import { Injectable, Logger } from "@nestjs/common";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  StorageProvider,
  GetSignedUploadUrlInput,
  GetSignedUploadUrlResult,
  GetSignedDownloadUrlInput,
  GetSignedDownloadUrlResult,
  PutObjectInput,
  DeleteInput,
  HeadInput,
  HeadResult,
} from "./storage-provider.interface";
import {
  DEFAULT_STORAGE_UPLOAD_TTL_SECONDS,
  DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS,
  sanitizeDownloadFilename,
} from "./storage-provider.interface";
import { signStorageToken, resolveObjectPath } from "./local-storage.lib";

export interface LocalStorageConfig {
  /** On-disk root uploaded objects are written under. */
  baseDir: string;
  /** API's externally-reachable base URL, e.g. `http://localhost:4000` (no trailing slash). */
  apiBaseUrl: string;
  /** HMAC secret for signing upload/download URLs. */
  secret: string;
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);

  constructor(private readonly config: LocalStorageConfig) {
    this.logger.log(
      `[LocalStorageProvider] DEV storage — objects on disk at "${config.baseDir}", served via ${config.apiBaseUrl}/api/v1/*. Not for production.`,
    );
  }

  async getSignedUploadUrl(input: GetSignedUploadUrlInput): Promise<GetSignedUploadUrlResult> {
    const { key, contentType, ttlSeconds = DEFAULT_STORAGE_UPLOAD_TTL_SECONDS } = input;
    const expS = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = signStorageToken(this.config.secret, "upload", key, expS);
    const url = `${this.config.apiBaseUrl}/api/v1/storage/local/${key}?sig=${sig}&exp=${expS}`;
    return {
      url,
      storageKey: key,
      expiresAt: new Date(expS * 1000),
      requiredHeaders: { "Content-Type": contentType },
    };
  }

  async getSignedDownloadUrl(input: GetSignedDownloadUrlInput): Promise<GetSignedDownloadUrlResult> {
    const { key, ttlSeconds = DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS, downloadFilename } = input;
    const expS = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = signStorageToken(this.config.secret, "download", key, expS);
    // `filename` sits OUTSIDE the signature deliberately: it selects a response header, not
    // an object, so tampering with it can't reach a different file (the controller
    // sanitises it before echoing it into Content-Disposition).
    const attachment = downloadFilename
      ? `&filename=${encodeURIComponent(sanitizeDownloadFilename(downloadFilename))}`
      : "";
    const url = `${this.config.apiBaseUrl}/api/v1/storage/local/${key}?sig=${sig}&exp=${expS}&op=download${attachment}`;
    return { url, expiresAt: new Date(expS * 1000) };
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const p = resolveObjectPath(this.config.baseDir, input.key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, input.body);
  }

  async delete(input: DeleteInput): Promise<void> {
    try {
      await unlink(resolveObjectPath(this.config.baseDir, input.key));
    } catch {
      /* already gone — delete is idempotent */
    }
  }

  async head(input: HeadInput): Promise<HeadResult> {
    try {
      const s = await stat(resolveObjectPath(this.config.baseDir, input.key));
      return { exists: true, size: s.size };
    } catch {
      return { exists: false };
    }
  }
}
