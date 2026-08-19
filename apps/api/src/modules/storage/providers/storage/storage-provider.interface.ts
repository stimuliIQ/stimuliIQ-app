// apps/api/src/modules/storage/providers/storage/storage-provider.interface.ts
//
// Vendor-swappable object-storage provider interface (CLAUDE.md §3.7).
//
// Feature modules (certificates, submissions, invoice-gen) depend ONLY on this
// interface via the STORAGE_PROVIDER DI token.  Swapping S3 → R2 → any
// S3-compatible endpoint means changing one env var and potentially one adapter —
// every consumer is unaffected.
//
// References:
//   docs/04-trd-architecture.md §2.10 (StorageProvider: S3/R2)
//   docs/04-trd-architecture.md §2.12 (signed media security checklist)
//   docs/05-database-design.md  §7    (storage)
//   docs/plans/phase-4.md       §3    ("New provider interfaces")
//
// ─── SECURITY CONTRACT ───────────────────────────────────────────────────────
//
// 1. getSignedUploadUrl MUST return a SHORT-LIVED presigned PUT URL only.
//    The response includes requiredHeaders (Content-Type + x-amz-content-sha256
//    as appropriate) so the client MUST include them — without these headers the
//    PUT is rejected by S3/R2 because the presigned signature covers them.
//    A size constraint (Content-Length-Range condition) is embedded in the
//    presigned policy via PresignedPost / PutObject conditions.
//
// 2. getSignedDownloadUrl MUST return a SHORT-LIVED presigned GET URL only.
//    No raw bucket URL, no public-read ACL, no unsigned CDN link ever leaves
//    this method.  TTL is always server-supplied — never a client value.
//
// 3. FAIL CLOSED: if keys are missing/invalid, construction logs a warning
//    and any call throws (surfaces as 503 from the service layer).
//    The app boots cleanly when STORAGE_PROVIDER=noop or unset.
//
// 4. Keys are validated LAZILY at call time (not in the constructor) — the same
//    pattern as VideoProvider / PaymentProvider (ADR-0023, DEFECT-1 lesson).
//    The constructor MUST NOT throw when keys are absent.
//
// 5. All signing keys / access credentials are consumed ONLY inside the concrete
//    adapter.  They MUST NEVER appear in any return value, log line, error
//    message, or thrown string from this interface or its implementations.
//
// 6. storageKey scoping: the adapter exposes a static buildKey() helper that
//    constructs scoped keys (`submissions/{tenant}/{enrollment}/{uuid}-{filename}`
//    etc.) with sanitisation that prevents path traversal and tenant escape.
//    Callers are expected to use buildKey() rather than constructing raw keys.

// ─────────────────────────────────────────────────────────────────────────────
// Input / output shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface GetSignedUploadUrlInput {
  /**
   * The storage key (path) to write to.
   * MUST be a scoped key built via S3StorageProvider.buildKey() or equivalent
   * — never a caller-constructed raw path.  The adapter does NOT re-validate
   * the key structure because the caller is expected to have used buildKey().
   */
  key: string;

  /**
   * MIME type of the object being uploaded (e.g. "application/pdf").
   * Embedded in the presigned URL / policy so the S3 PUT request is rejected
   * if the client sends a different Content-Type.
   */
  contentType: string;

  /**
   * Maximum allowed upload size in bytes.
   * Used to set the Content-Length-Range condition in the presigned policy
   * (for PutObject presigner this is carried via requiredHeaders; for
   * PresignedPost it becomes a policy condition).
   * Required — callers must supply a reasonable ceiling (e.g. 50 MB for PDFs).
   */
  maxBytes: number;

  /**
   * URL lifetime in seconds.  The presigned URL expires after this many
   * seconds.  Defaults to DEFAULT_STORAGE_UPLOAD_TTL_SECONDS (300 s = 5 min).
   * The backend always supplies a server-side constant — never a client value.
   */
  ttlSeconds?: number;
}

export interface GetSignedUploadUrlResult {
  /**
   * The SHORT-LIVED presigned PUT URL.  The client uses this URL to upload
   * the object directly to S3/R2 (no server proxy).  Expires at `expiresAt`.
   *
   * S3/R2: AWS Signature V4 presigned PUT URL.
   * Noop:  https://noop.local/storage/upload/{key}?sig=noop&exp={expS}
   *
   * SECURITY: this URL is a bearer credential for the PUT operation.  It
   * must NOT be logged, cached beyond the current request lifetime, or
   * forwarded to a third party.
   */
  url: string;

  /**
   * The storage key that was signed.  Store this in the DB row so that
   * getSignedDownloadUrl can later produce a signed GET URL for the same
   * object.  NEVER store the presigned upload URL — only the key.
   */
  storageKey: string;

  /**
   * Absolute UTC datetime when `url` expires.
   */
  expiresAt: Date;

  /**
   * HTTP headers the client MUST include in the PUT request.  Without these
   * headers the signature verification on S3/R2 will fail.
   *
   * Always includes at minimum `{ "Content-Type": <contentType> }`.
   * May also include `{ "x-amz-content-sha256": "UNSIGNED-PAYLOAD" }` for
   * R2/virtual-hosted endpoints that require it.
   *
   * Noop: `{ "Content-Type": <contentType> }` (no real signing).
   */
  requiredHeaders: Record<string, string>;
}

/**
 * Sanitises a filename for a Content-Disposition header: strips quotes, control chars and
 * path separators (a raw filename could otherwise inject header directives or traverse).
 */
export function sanitizeDownloadFilename(filename: string): string {
  // Keep only what is safe INSIDE a quoted Content-Disposition filename: word chars,
  // spaces, dots, hyphens, parens. Quotes, CR/LF and slashes are what would let a filename
  // break out of the header or traverse a path, so they are dropped.
  const cleaned = filename.replace(/[^\w .()-]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "download";
}

export interface GetSignedDownloadUrlInput {
  /**
   * The storage key (path) to read from.  This is the value previously
   * returned as `storageKey` from getSignedUploadUrl.
   */
  key: string;

  /**
   * Optional filename that forces a "save as" download instead of in-browser rendering:
   * the object is served with `Content-Disposition: attachment; filename="..."` (S3:
   * ResponseContentDisposition on the presigned GET).
   *
   * This is what makes a download work CROSS-ORIGIN. The HTML `download` attribute is
   * IGNORED when the href points at another origin — exactly the case here (API on one
   * origin, web app on another) — so without this header the browser just renders the PDF
   * in a tab instead of saving it.
   */
  downloadFilename?: string;

  /**
   * URL lifetime in seconds.  Defaults to DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS
   * (300 s = 5 min).  Always a server-supplied constant.
   */
  ttlSeconds?: number;
}

export interface GetSignedDownloadUrlResult {
  /**
   * The SHORT-LIVED presigned GET URL.  The client uses this URL to download
   * the object directly from S3/R2.  Expires at `expiresAt`.
   *
   * SECURITY: treat as a bearer credential for the GET.  Do not cache beyond
   * the current response TTL.  Re-mint on expiry.
   */
  url: string;

  /**
   * Absolute UTC datetime when `url` expires.
   */
  expiresAt: Date;
}

export interface PutObjectInput {
  /**
   * The storage key (path) to write to. MUST be built via
   * S3StorageProvider.buildKey() / buildStorageKey() — never a caller-constructed
   * raw path.
   */
  key: string;

  /**
   * The raw bytes to write. Used for SERVER-SIDE generated artifacts (CSV/PDF
   * exports, reports) where there is no browser client to perform a presigned
   * PUT — the server itself holds the bytes and must push them to the bucket
   * directly. Never proxy a browser upload through this method (use
   * getSignedUploadUrl for that — it keeps large user uploads off the API
   * process's memory/CPU).
   */
  body: Buffer;

  /** MIME type of the object (e.g. "text/csv", "application/pdf"). */
  contentType: string;
}

export interface DeleteInput {
  /**
   * The storage key to delete.  Permanent; cannot be undone.
   * Callers MUST verify RBAC and soft-delete the DB row before calling this.
   */
  key: string;
}

/**
 * Read an object's BYTES into the API process.
 *
 * Deliberately narrow. Presigned URLs are the default for every download in this codebase
 * precisely so that large files never occupy the API's memory — this method is the
 * exception, for the one case where the server itself must hold the bytes: attaching an
 * offer letter to the candidate's email (docs/specs/careers-hiring.md). A signed link would
 * have been cheaper, but an offer letter is a document somebody keeps, and a link that
 * expires is not that.
 *
 * Callers MUST bound the size before calling (see `maxBytes`) — an unbounded read of a
 * caller-supplied key is a memory-exhaustion primitive.
 */
export interface GetObjectInput {
  /** The storage key to read. */
  key: string;

  /**
   * Hard ceiling on the object size, in bytes. The adapter HEADs the object first and
   * throws without downloading when it is larger. Required — there is no safe default for
   * "read this whole thing into memory".
   */
  maxBytes: number;
}

export interface GetObjectResult {
  /** The object's full contents. */
  body: Buffer;

  /** MIME type stored on the object, when the provider reported one. */
  contentType: string | null;

  /** Object size in bytes (`body.length`). */
  size: number;
}

export interface HeadInput {
  /**
   * The storage key to probe.
   */
  key: string;
}

export interface HeadResult {
  /**
   * Whether the object exists in the bucket.
   */
  exists: boolean;

  /**
   * Object size in bytes, if it exists and the provider returned it.
   */
  size?: number;

  /**
   * MIME type stored on the object, if the provider returned it.
   */
  contentType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageProvider {
  /**
   * Mints a SHORT-LIVED presigned PUT URL for a direct browser → S3/R2 upload.
   *
   * The URL embeds the Content-Type and (via required headers) enforces the
   * maximum upload size so the bucket rejects oversized or wrong-type payloads.
   *
   * FAIL CLOSED: if the adapter's credentials are not configured, this MUST
   * throw (never return a raw bucket URL).  The service layer catches the throw
   * and returns HTTP 503.
   *
   * Callers MUST:
   *   1. Build the key via S3StorageProvider.buildKey() to enforce scoping.
   *   2. Persist `storageKey` to the DB row immediately — not the presigned URL.
   *   3. Return only `{ url, expiresAt, requiredHeaders }` to the client; never
   *      the bucket name, region, or any credential-bearing env var.
   */
  getSignedUploadUrl(input: GetSignedUploadUrlInput): Promise<GetSignedUploadUrlResult>;

  /**
   * Mints a SHORT-LIVED presigned GET URL for a direct S3/R2 download.
   *
   * Used by: certificate download, submission file view, invoice download,
   * and lesson-resource download endpoints.
   *
   * FAIL CLOSED: if credentials are absent, this MUST throw (never return a
   * raw/public URL).  The service layer returns HTTP 503.
   *
   * Re-mint on every request — do NOT cache the signed URL on the server.
   */
  getSignedDownloadUrl(input: GetSignedDownloadUrlInput): Promise<GetSignedDownloadUrlResult>;

  /**
   * Writes bytes directly to the bucket from the SERVER side (no presigned URL
   * round-trip). For server-generated artifacts only (CSV/PDF exports, reports) —
   * see `PutObjectInput.body` doc comment. The caller is responsible for calling
   * getSignedDownloadUrl afterwards to hand the client a short-lived link; this
   * method itself never returns a client-facing URL.
   *
   * FAIL CLOSED: throws if credentials are absent (service layer surfaces 503).
   */
  putObject(input: PutObjectInput): Promise<void>;

  /**
   * Permanently deletes an object from the bucket.
   *
   * Callers are responsible for ensuring the DB soft-delete row is updated
   * before or after this call as appropriate for their rollback strategy.
   * Deleting a non-existent key is a safe no-op (S3 returns 204; adapter
   * must not throw on 404).
   *
   * FAIL CLOSED: throws if credentials are absent.
   */
  delete(input: DeleteInput): Promise<void>;

  /**
   * Returns metadata about an object without downloading it (HTTP HEAD).
   *
   * Returns `{ exists: false }` when the key does not exist (S3 404).
   * FAIL CLOSED: throws if credentials are absent.
   */
  head(input: HeadInput): Promise<HeadResult>;

  /**
   * Downloads an object's bytes into the API process.
   *
   * Throws when the key does not exist, and throws when the object exceeds
   * `input.maxBytes` WITHOUT downloading it. Use only where the server genuinely needs
   * the bytes (email attachments) — every client-facing download goes through
   * getSignedDownloadUrl instead. See GetObjectInput.
   *
   * FAIL CLOSED: throws if credentials are absent.
   */
  getObject(input: GetObjectInput): Promise<GetObjectResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the StorageProvider.
 *
 * Feature modules (submissions, certificates, invoice-gen, resources) import and
 * inject this token — NEVER import S3StorageProvider or any concrete class from a
 * feature module.
 *
 * StorageProviderModule binds this token to the adapter selected by the
 * STORAGE_PROVIDER env variable.
 *
 * Usage in a feature module:
 *
 *   // certificates.module.ts
 *   import { StorageProviderModule } from '../storage/providers/storage/storage-provider.module';
 *
 *   @Module({ imports: [StorageProviderModule, ...], ... })
 *   export class CertificatesModule {}
 *
 *   // certificates.service.ts
 *   import { Inject } from '@nestjs/common';
 *   import { STORAGE_PROVIDER, StorageProvider }
 *     from '../storage/providers/storage/storage-provider.interface';
 *
 *   @Injectable()
 *   export class CertificatesService {
 *     constructor(
 *       @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
 *     ) {}
 *   }
 *
 * Test wiring (unit tests — bind the Noop directly):
 *
 *   const noop = new NoopStorageProvider();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       CertificatesService,
 *       { provide: STORAGE_PROVIDER, useValue: noop },
 *     ],
 *   }).compile();
 */
export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

/**
 * Default TTL (seconds) for presigned upload URLs.
 * 300 s = 5 minutes — gives the client enough time to upload without leaving
 * a long-lived credential window open.
 */
export const DEFAULT_STORAGE_UPLOAD_TTL_SECONDS = 300;

/**
 * Default TTL (seconds) for presigned download URLs.
 * 300 s = 5 minutes — short enough to limit credential exposure; the client
 * must re-mint on expiry.
 */
export const DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS = 300;
