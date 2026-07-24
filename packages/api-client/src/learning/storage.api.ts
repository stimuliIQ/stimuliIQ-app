// Storage SDK — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2).
//
// Namespace: client.learning.storage.*
//
// Endpoints covered:
//   POST /storage/upload-url → getUploadUrl()
//
// USAGE FLOW for file uploads:
//   1. Call `getUploadUrl({ contentType, fileName, sizeBytes, purpose, enrollmentId })`
//   2. PUT the file directly to the returned `uploadUrl` with Content-Type header.
//      Do NOT route the file through the API server.
//   3. Include the returned `storageKey` in the submission payload.
//
// SECURITY:
//   - `uploadUrl` is a short-lived signed S3/R2 PUT URL (never a raw bucket URL).
//   - Server scopes the storage key to submissions/{tenantId}/{enrollmentId}/...
//   - Key path traversal attempts are rejected server-side.
//   - NoopStorageProvider returns deterministic fake URLs for test/local environments.

import type { GetUploadUrlRequest, SignedUploadResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class StorageApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/storage/upload-url
   *
   * Request a signed PUT URL for direct-to-storage file upload.
   *
   * USAGE:
   *   1. Call this to get `{ storageKey, uploadUrl, expiresAt, additionalHeaders, maxSizeBytes }`.
   *   2. PUT the file to `uploadUrl` with `Content-Type: <originalContentType>`.
   *      Include any headers from `additionalHeaders` if present.
   *   3. After a successful 204, include `storageKey` in the submission payload.
   *
   * NEVER:
   *   - Store the `uploadUrl` long-term (it expires at `expiresAt` ≤15 min from now).
   *   - Proxy the file through the API server — PUT directly to `uploadUrl`.
   *   - Expose `uploadUrl` to other users (it is scoped to this request context).
   *
   * Permission: submissions.create (scope: own) for student uploads.
   */
  async getUploadUrl(body: GetUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/storage/upload-url", {
      body,
    });
  }
}
