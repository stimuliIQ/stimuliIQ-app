// apps/api/src/modules/storage/providers/storage/noop-storage.provider.ts
//
// Test / sandbox double for StorageProvider.  Used in unit tests, integration
// tests, and local dev environments where no real S3/R2 credentials are
// configured.  Selected automatically when STORAGE_PROVIDER=noop (the default)
// or when STORAGE_PROVIDER is unset.
//
// This class is NEVER bound in production.  StorageProviderModule binds the
// real adapter when STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2.
//
// ─── BEHAVIOUR ────────────────────────────────────────────────────────────────
//
//   getSignedUploadUrl:
//     Returns a DETERMINISTIC fake presigned PUT URL:
//       https://noop.local/storage/upload/{key}?sig=noop&exp={expS}
//     requiredHeaders always includes { "Content-Type": <contentType> }.
//     No real S3 call; safe for any test environment.
//
//   getSignedDownloadUrl:
//     Returns a DETERMINISTIC fake presigned GET URL:
//       https://noop.local/storage/download/{key}?sig=noop&exp={expS}
//
//   delete:
//     No-op.  Logs the key at debug level for test observability.
//
//   head:
//     Returns { exists: true, size: 1024, contentType: "application/octet-stream" }
//     by default (the headExistsDefault option controls this for fail-path tests).
//
// ─── SECURITY NOTE ────────────────────────────────────────────────────────────
//
//   The fake URLs returned here are NOT real presigned URLs — they contain no
//   valid AWS Signature V4 material and will be rejected by any real S3/R2
//   endpoint.  They MUST NEVER be used in production.

import { Injectable, Logger } from "@nestjs/common";
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
} from "./storage-provider.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface NoopStorageProviderOptions {
  /**
   * Controls the return value of head().
   * Default: true (object "exists").
   * Set to false in tests that exercise the "not found" path.
   */
  headExistsDefault?: boolean;

  /**
   * Default size returned by head() when headExistsDefault is true.
   * Default: 1024.
   */
  headSizeDefault?: number;

  /**
   * Default contentType returned by head() when headExistsDefault is true.
   * Default: "application/octet-stream".
   */
  headContentTypeDefault?: string;
}

@Injectable()
export class NoopStorageProvider implements StorageProvider {
  private readonly logger = new Logger(NoopStorageProvider.name);
  private readonly headExists: boolean;
  private readonly headSize: number;
  private readonly headContentType: string;

  constructor(options: NoopStorageProviderOptions = {}) {
    this.headExists = options.headExistsDefault ?? true;
    this.headSize = options.headSizeDefault ?? 1024;
    this.headContentType = options.headContentTypeDefault ?? "application/octet-stream";

    this.logger.warn(
      "[NoopStorageProvider] Running with the no-op/test storage provider. " +
        "Returned presigned URLs are FAKE and will be rejected by any real S3/R2 endpoint. " +
        "Do NOT use this in production. Set STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2 " +
        "with real credentials for staging/prod.",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // getSignedUploadUrl — DETERMINISTIC fake presigned PUT URL
  // ───────────────────────────────────────────────────────────────────────────

  async getSignedUploadUrl(input: GetSignedUploadUrlInput): Promise<GetSignedUploadUrlResult> {
    const { key, contentType, ttlSeconds = DEFAULT_STORAGE_UPLOAD_TTL_SECONDS } = input;

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    const encodedKey = encodeURIComponent(key);
    const url = `https://noop.local/storage/upload/${encodedKey}?sig=noop&exp=${expS}`;

    return {
      url,
      storageKey: key,
      expiresAt: new Date(expS * 1000),
      requiredHeaders: { "Content-Type": contentType },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // getSignedDownloadUrl — DETERMINISTIC fake presigned GET URL
  // ───────────────────────────────────────────────────────────────────────────

  async getSignedDownloadUrl(
    input: GetSignedDownloadUrlInput,
  ): Promise<GetSignedDownloadUrlResult> {
    const { key, ttlSeconds = DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS } = input;

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    const encodedKey = encodeURIComponent(key);
    const url = `https://noop.local/storage/download/${encodedKey}?sig=noop&exp=${expS}`;

    return {
      url,
      expiresAt: new Date(expS * 1000),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // putObject — no-op (logs size for test observability)
  // ───────────────────────────────────────────────────────────────────────────

  async putObject(input: PutObjectInput): Promise<void> {
    this.logger.debug(
      `[NoopStorageProvider] putObject: key=${input.key} bytes=${input.body.length} contentType=${input.contentType} (no-op)`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // delete — no-op
  // ───────────────────────────────────────────────────────────────────────────

  async delete(input: DeleteInput): Promise<void> {
    this.logger.debug(`[NoopStorageProvider] delete: key=${input.key} (no-op)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // head — returns configured default
  // ───────────────────────────────────────────────────────────────────────────

  async head(_input: HeadInput): Promise<HeadResult> {
    if (!this.headExists) {
      return { exists: false };
    }
    return {
      exists: true,
      size: this.headSize,
      contentType: this.headContentType,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static test helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Computes the expected fake upload URL for a given (key, expS) pair.
   * Useful in unit tests for asserting the URL shape without constructing
   * a full provider instance.
   *
   *   const expS = Math.floor(Date.now() / 1000) + 300;
   *   const expected = NoopStorageProvider.buildExpectedUploadUrl(key, expS);
   *   expect(result.url).toBe(expected);  // allow ±1 s boundary
   */
  static buildExpectedUploadUrl(key: string, expS: number): string {
    return `https://noop.local/storage/upload/${encodeURIComponent(key)}?sig=noop&exp=${expS}`;
  }

  /**
   * Computes the expected fake download URL for a given (key, expS) pair.
   */
  static buildExpectedDownloadUrl(key: string, expS: number): string {
    return `https://noop.local/storage/download/${encodeURIComponent(key)}?sig=noop&exp=${expS}`;
  }
}
