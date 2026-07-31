// apps/api/src/modules/storage/providers/storage/s3-storage.provider.ts
//
// S3 / R2 implementation of StorageProvider using AWS SDK v3.
//
// Works with:
//   - AWS S3 (leave STORAGE_ENDPOINT unset; use STORAGE_REGION + STORAGE_BUCKET)
//   - Cloudflare R2 (set STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com;
//     STORAGE_REGION can be "auto")
//   - Any other S3-compatible service (Minio, Tigris, etc.)
//
// Adapter selection:
//   STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2 → both bind this adapter (same code,
//   same SDK, just different endpoint/region config).
//
// ─── SIGNED URL STRATEGY ────────────────────────────────────────────────────
//
//   Upload (presigned PUT):
//     - Uses @aws-sdk/s3-request-presigner + PutObjectCommand.
//     - Content-Type is locked in via the command params (included in the
//       V4 canonical request, so a client that sends a different Content-Type
//       gets a 403 from S3/R2).
//     - maxBytes is carried as the x-amz-meta-max-bytes metadata header on the
//       presigned URL; servers (and proxy/CDN layers that understand it) can
//       enforce the size.  A hard server-side max is enforced by CORS/bucket
//       policy configuration (documented in the env key comments).
//     - requiredHeaders includes Content-Type so the service layer can return
//       it to the client for inclusion in the PUT fetch call.
//
//   Download (presigned GET):
//     - Uses @aws-sdk/s3-request-presigner + GetObjectCommand.
//     - Short-TTL (default 300 s).  Re-mint on every request.
//
// ─── KEY SCOPING ───────────────────────────────────────────────────────────
//
//   S3StorageProvider.buildKey() constructs tenant-scoped storage keys with
//   path sanitisation that prevents path traversal and tenant escape:
//
//     submissions/{tenantId}/{enrollmentId}/{uuid}-{sanitisedFilename}
//     certificates/{tenantId}/{certUid}.pdf
//     invoices/{tenantId}/{invoiceId}.pdf
//     resources/{tenantId}/{lessonId}/{uuid}-{sanitisedFilename}
//     exports/{tenantId}/{exportJobId}.{csv|pdf}
//     receipts/{tenantId}/{paymentId}.pdf
//     careers/{tenantId}/{uuid}-{sanitisedFilename}
//     mentor_photos/{tenantId}/{uuid}-{sanitisedFilename}
//     program_images/{tenantId}/{uuid}-{sanitisedFilename}
//     marketing_images/{tenantId}/{uuid}-{sanitisedFilename}
//
//   Sanitisation rules (applied to filename component only):
//     - Strip or encode path separators (/ \\ ..).
//     - Allow only [a-zA-Z0-9._-] characters.
//     - Truncate to 200 bytes.
//     - A filename that reduces to empty after sanitisation is replaced by "file".
//
//   Callers MUST use buildKey() (or an equivalent that applies the same rules)
//   rather than constructing raw paths.  The adapter performs a defence-in-depth
//   check on the key prefix to ensure it starts with a known namespace prefix (see
//   ALLOWED_KEY_PREFIXES — kept in lockstep with every StorageKeyNamespace member,
//   regression-tested below) and does NOT contain ".." or null bytes.
//
// ─── FAIL-CLOSED PATTERN ────────────────────────────────────────────────────
//
//   Constructor logs a warning if credentials are absent; does NOT throw (lazy
//   validation).  Any public method call on an unconfigured adapter throws with a
//   clear message ("StorageProvider: credentials not configured ...").
//   The service layer catches the throw and returns HTTP 503.
//
// ─── SECURITY INVARIANTS ────────────────────────────────────────────────────
//
//   - STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY: consumed only inside
//     this file; never logged, never returned, never in any error string.
//   - STORAGE_BUCKET: the raw bucket name is never returned to the client in any
//     response.  Only signed URLs appear in responses.
//   - Presigned URLs are the ONLY mechanism by which object data is accessible
//     from outside the server; no ACL-based public access is ever set.
//   - All key inputs are sanitised before being passed to AWS SDK commands.

import { Injectable, Logger } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateEnv } from "../../../../config/env";
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

// ─────────────────────────────────────────────────────────────────────────────
// Key scoping constants
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed namespace prefixes.  Keys not starting with one of these are rejected. */
const ALLOWED_KEY_PREFIXES = [
  "submissions/",
  "certificates/",
  "invoices/",
  "resources/",
  // Phase-7 (docs/plans/phase-7.md task #8): on-demand/scheduled report CSV/PDF
  // exports (exports.service.ts). Key shape: exports/{tenantId}/{exportJobId}.{csv|pdf}.
  "exports/",
  // Phase-9 Completion T27 (docs/plans/phase-9-completion.md, B8 fix): payment receipt
  // PDFs. Key shape: receipts/{tenantId}/{paymentId}.pdf — deterministic (no DB column
  // needed; readiness is checked via StorageProvider.head(), see commerce.service.ts).
  "receipts/",
  // Phase-9-completion gap #3: anonymous career-application resume uploads (public,
  // captcha-gated). Key shape: careers/{tenantId}/{uuid}-{sanitisedFilename}.
  "careers/",
  // Phase-8 WS-1 (mentors.service.ts#getPhotoUploadUrl) / courses "OG image"
  // (courses.service.ts#getImageUploadUrl): public marketing images, served via CDN.
  // Key shape: {namespace}/{tenantId}/{uuid}-{sanitisedFilename}. These two namespaces
  // were already valid `buildStorageKey()` targets (see StorageKeyNamespace below) but
  // were MISSING here — a raw mint against either would have thrown inside
  // `getSignedUploadUrl()`'s `validateStorageKey()` call (defence-in-depth gap, not
  // reachable via the callers above because they always round-trip through `buildKey()`
  // first, but latent nonetheless). Backfilled together with `marketing_images/` below.
  "mentor_photos/",
  "program_images/",
  // Page-builder marketing images (CRM `content.builder`, super_admin-only). Key shape:
  // marketing_images/{tenantId}/{uuid}-{sanitisedFilename}. Same public-CDN convention as
  // mentor_photos/program_images above.
  "marketing_images/",
  // Phase-11 locked templates (docs/plans/phase-11-locked-templates.md) — college logos
  // (crm/colleges.schemas.ts's `CollegeLogoUploadUrlRequestSchema`, colleges.service.ts#
  // getLogoUploadUrl). Key shape: college_logos/{tenantId}/{uuid}-{sanitisedFilename}. Same
  // public-CDN convention as marketing_images/mentor_photos above.
  "college_logos/",
  // Downloadable course brochure PDFs (courses.service.ts#getBrochureUploadUrl). Key shape:
  // program_brochures/{tenantId}/{uuid}-{sanitisedFilename}. Public marketing collateral —
  // served straight from the CDN URL minted by `mintCdnUrl(row.brochureKey)`, exactly like
  // the image namespaces above, so it belongs in PUBLIC_ASSET_PREFIXES too.
  "program_brochures/",
] as const;

/**
 * The namespaces whose objects a browser fetches directly from the public marketing site —
 * `<img>` for the image namespaces, a `<a download>` link for `program_brochures/` — i.e.
 * the ONLY ones minted into a public CDN URL by `mintCdnUrl` (courses.service.ts,
 * mentors.service.ts, content.util.ts, public-catalog.service.ts).
 *
 * When STORAGE_PUBLIC_BUCKET is configured these live in that separate, publicly-readable
 * bucket; everything else stays in the private one. The split matters because R2 grants
 * public access per BUCKET: without it, serving course thumbnails over a CDN would also
 * expose `submissions/` (student work), `exports/` (PII CSVs), `invoices/`, `receipts/`
 * (deterministic keys — not even guess-resistant) and `careers/` (applicant resumes).
 *
 * DELIBERATELY EXCLUDES `receipts/` and `careers/`: both appear in ALLOWED_KEY_PREFIXES
 * above but neither is ever minted as a CDN URL — they are delivered through short-lived
 * signed URLs, and both carry personal data.
 */
const PUBLIC_ASSET_PREFIXES = [
  "program_images/",
  "marketing_images/",
  "mentor_photos/",
  "college_logos/",
  "program_brochures/",
] as const;

/**
 * True when `key` belongs to a publicly-served image namespace. Prefix match against
 * PUBLIC_ASSET_PREFIXES only — a key is private unless it is explicitly public, so a new
 * namespace added to ALLOWED_KEY_PREFIXES defaults to the private bucket rather than
 * silently becoming world-readable.
 */
export function isPublicAssetKey(key: string): boolean {
  return PUBLIC_ASSET_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Maximum length of the sanitised filename component. */
const MAX_FILENAME_LENGTH = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Key sanitisation helpers (exported for testability)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitises a user-supplied filename to prevent path traversal and restrict
 * to safe characters.
 *
 * Rules:
 *   - Remove null bytes.
 *   - Remove path separators (/, \, and ..).
 *   - Keep only [a-zA-Z0-9._-] characters.
 *   - Truncate to MAX_FILENAME_LENGTH bytes.
 *   - If empty after sanitisation, return "file".
 *
 * @throws never — returns a safe replacement string if the input is fully stripped.
 */
export function sanitiseFilename(filename: string): string {
  if (!filename) return "file";

  const safe = filename
    // Remove null bytes (defence against null-byte injection).
    .replace(/\0/g, "")
    // Remove traversal sequences (../ and ..\).
    .replace(/\.\.(\/|\\)/g, "")
    // Replace path separators with underscores.
    .replace(/[/\\]/g, "_")
    // STRIP (not replace) disallowed characters so the result can be empty.
    .replace(/[^a-zA-Z0-9._-]/g, "")
    // Truncate.
    .slice(0, MAX_FILENAME_LENGTH);

  return safe.length > 0 ? safe : "file";
}

/**
 * Validates that a storage key:
 *   1. Starts with a known namespace prefix.
 *   2. Does NOT contain ".." (path traversal).
 *   3. Does NOT contain null bytes.
 *
 * Throws a descriptive error if the key is invalid (fail-closed: the adapter
 * would throw anyway when the SDK rejects a malformed key, but we throw first
 * with a useful message to aid debugging).
 */
export function validateStorageKey(key: string): void {
  if (!key || typeof key !== "string") {
    throw new Error("StorageProvider: storage key must be a non-empty string.");
  }

  if (key.includes("\0")) {
    throw new Error("StorageProvider: storage key contains null bytes (rejected).");
  }

  if (key.includes("..")) {
    throw new Error(
      `StorageProvider: storage key contains path traversal sequence '..' (rejected). key=${key}`,
    );
  }

  const startsWithAllowed = ALLOWED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (!startsWithAllowed) {
    throw new Error(
      `StorageProvider: storage key does not start with a known namespace prefix. ` +
        `Allowed prefixes: ${ALLOWED_KEY_PREFIXES.join(", ")}. key=${key}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Key builder — exported so callers can construct scoped keys without
// importing the concrete adapter class directly.
// ─────────────────────────────────────────────────────────────────────────────

export type StorageKeyNamespace =
  | "submissions"
  | "certificates"
  | "invoices"
  | "resources"
  | "exports"
  | "receipts"
  | "careers"
  | "mentor_photos"
  | "program_images"
  | "program_brochures"
  | "marketing_images"
  | "college_logos";

export interface BuildKeyOptions {
  namespace: StorageKeyNamespace;
  tenantId: string;
  /** UUID v4 — a random ID to ensure uniqueness per upload attempt. */
  uniqueId: string;
  /**
   * For "submissions": the enrollment id (scopes the key to the student).
   * For "resources": the lesson id.
   * Omit for "certificates" and "invoices" (just tenantId + uniqueId are used).
   */
  scopeId?: string;
  /**
   * Original filename supplied by the user.  Sanitised before inclusion.
   * For "certificates" and "invoices" this is typically a generated name
   * (e.g. "certificate.pdf") — still sanitised.
   */
  filename?: string;
  /**
   * File extension WITHOUT the leading dot (e.g. "csv", "pdf"). Required for
   * namespace "exports" only — unlike certificates/invoices (always .pdf), an
   * export can be either format (docs/plans/phase-7.md task #8).
   */
  extension?: "csv" | "pdf";
}

/**
 * Builds a scoped, sanitised storage key.
 *
 * Namespace layouts:
 *   submissions/{tenantId}/{scopeId(enrollmentId)}/{uniqueId}-{sanitisedFilename}
 *   resources/{tenantId}/{scopeId(lessonId)}/{uniqueId}-{sanitisedFilename}
 *   certificates/{tenantId}/{uniqueId}.pdf
 *   invoices/{tenantId}/{uniqueId}.pdf
 *
 * The tenant id and scope id are embedded in the key so that objects are
 * trivially partitioned in the bucket and cross-tenant access is impossible
 * without knowledge of both the bucket name (never client-visible) and the
 * tenantId.
 *
 * @throws if tenantId or uniqueId are empty, or if the namespace requires a
 *   scopeId but none is provided.
 */
export function buildStorageKey(opts: BuildKeyOptions): string {
  const { namespace, tenantId, uniqueId, scopeId, filename, extension } = opts;

  if (!tenantId?.trim()) {
    throw new Error("StorageProvider.buildKey: tenantId is required.");
  }
  if (!uniqueId?.trim()) {
    throw new Error("StorageProvider.buildKey: uniqueId is required.");
  }

  // Sanitise the IDs used in the path (they are UUIDs from our DB, so this is
  // defence-in-depth — they should already be safe, but we still strip bad chars).
  const safeTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeUniqueId = uniqueId.replace(/[^a-zA-Z0-9_-]/g, "_");

  switch (namespace) {
    case "submissions":
    case "resources": {
      if (!scopeId?.trim()) {
        throw new Error(
          `StorageProvider.buildKey: scopeId is required for namespace '${namespace}'.`,
        );
      }
      const safeScopeId = scopeId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeFilename = filename ? sanitiseFilename(filename) : "file";
      return `${namespace}/${safeTenantId}/${safeScopeId}/${safeUniqueId}-${safeFilename}`;
    }

    case "careers": {
      // No scopeId: an anonymous applicant has no enrollment/lesson to scope to —
      // uniqueness comes from uniqueId (a fresh UUID per upload-url request).
      const safeFilename = filename ? sanitiseFilename(filename) : "resume";
      return `${namespace}/${safeTenantId}/${safeUniqueId}-${safeFilename}`;
    }

    case "mentor_photos":
    case "program_images":
    case "program_brochures":
    case "marketing_images":
    case "college_logos": {
      // Public marketing assets (served via CDN) — mentor photos, course card/OG images,
      // course brochure PDFs, page-builder marketing images (super_admin-only
      // `content.builder`), and college logos (Phase-11 locked templates,
      // colleges.service.ts#getLogoUploadUrl). No scopeId — the owning row may not exist
      // yet when the file is uploaded (create flow uploads first, then submits the
      // returned key); uniqueness comes from the per-request uniqueId.
      const safeFilename = filename ? sanitiseFilename(filename) : "photo";
      return `${namespace}/${safeTenantId}/${safeUniqueId}-${safeFilename}`;
    }

    case "certificates":
    case "invoices":
    case "receipts": {
      // For certificates/invoices/receipts the key is deterministic (based on the
      // unique ID) and always has a .pdf extension. The caller may supply a filename
      // but we ignore its extension and always use .pdf.
      return `${namespace}/${safeTenantId}/${safeUniqueId}.pdf`;
    }

    case "exports": {
      // Export jobs (docs/plans/phase-7.md task #8): deterministic key based on the
      // export_jobs.id (uniqueId) — csv or pdf per the job's requested format.
      if (!extension) {
        throw new Error("StorageProvider.buildKey: extension ('csv'|'pdf') is required for namespace 'exports'.");
      }
      return `${namespace}/${safeTenantId}/${safeUniqueId}.${extension}`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// S3StorageProvider
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);

  /** Memoised S3 client — created lazily on first call. */
  private client: S3Client | undefined;
  /** Whether credentials are present (determined at construction). */
  private readonly configured: boolean;

  constructor() {
    const env = validateEnv();

    const hasCredentials =
      !!env.STORAGE_ACCESS_KEY_ID &&
      !!env.STORAGE_SECRET_ACCESS_KEY &&
      !!env.STORAGE_BUCKET;

    this.configured = hasCredentials;

    if (!hasCredentials) {
      this.logger.warn(
        "[S3StorageProvider] STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, or " +
          "STORAGE_BUCKET is not configured.  Any call to this provider will throw " +
          "(fail-closed).  Set STORAGE_PROVIDER=noop for local dev / tests, or supply " +
          "all three credentials for staging/prod.",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns the memoised S3Client; throws if credentials are absent. */
  private getClient(): S3Client {
    if (!this.configured) {
      throw new Error(
        "StorageProvider: credentials not configured (STORAGE_ACCESS_KEY_ID / " +
          "STORAGE_SECRET_ACCESS_KEY / STORAGE_BUCKET missing). " +
          "Call is rejected (fail-closed). See .env.example for configuration.",
      );
    }

    if (this.client) return this.client;

    const env = validateEnv();

    this.client = new S3Client({
      region: env.STORAGE_REGION ?? "auto",
      credentials: {
        // These are guaranteed non-empty by the `configured` check above.
        accessKeyId: env.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!,
      },
      // STORAGE_ENDPOINT is set for R2 / S3-compatible services.
      // AWS S3 does not require an explicit endpoint; leave it undefined there.
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
      // For R2 / non-AWS endpoints, path-style addressing is required.
      ...(env.STORAGE_ENDPOINT ? { forcePathStyle: false } : {}),
    });

    return this.client;
  }

  /**
   * Resolves the bucket a given key lives in; throws if unconfigured (should not happen
   * post-check).
   *
   * Public image namespaces go to STORAGE_PUBLIC_BUCKET when it is set, everything else
   * to STORAGE_BUCKET. With STORAGE_PUBLIC_BUCKET unset this is exactly the previous
   * single-bucket behaviour, so existing deployments are unaffected until they opt in.
   *
   * Every S3 call in this provider routes through here, so a key is read from, written
   * to, HEADed and deleted in the SAME bucket — there is no path where an upload lands
   * in one bucket and the download URL is signed against the other.
   */
  private getBucket(key: string): string {
    const env = validateEnv();
    if (env.STORAGE_PUBLIC_BUCKET && isPublicAssetKey(key)) {
      return env.STORAGE_PUBLIC_BUCKET;
    }
    if (!env.STORAGE_BUCKET) {
      throw new Error("StorageProvider: STORAGE_BUCKET not configured.");
    }
    return env.STORAGE_BUCKET;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getSignedUploadUrl
  // ─────────────────────────────────────────────────────────────────────────

  async getSignedUploadUrl(input: GetSignedUploadUrlInput): Promise<GetSignedUploadUrlResult> {
    const { key, contentType, ttlSeconds = DEFAULT_STORAGE_UPLOAD_TTL_SECONDS } = input;

    validateStorageKey(key);

    const client = this.getClient();
    const bucket = this.getBucket(key);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      // Embed maxBytes as metadata so it is visible in bucket policy / logging.
      // Note: presigned PUT does NOT natively enforce a byte ceiling the way
      // PresignedPost does; this is documented as a bucket-policy responsibility.
      Metadata: {
        "max-bytes": String(input.maxBytes),
      },
    });

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    const url = await getSignedUrl(client, command, { expiresIn: ttlSeconds });

    return {
      url,
      storageKey: key,
      expiresAt: new Date(expS * 1000),
      requiredHeaders: {
        "Content-Type": contentType,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getSignedDownloadUrl
  // ─────────────────────────────────────────────────────────────────────────

  async getSignedDownloadUrl(
    input: GetSignedDownloadUrlInput,
  ): Promise<GetSignedDownloadUrlResult> {
    const { key, ttlSeconds = DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS } = input;

    validateStorageKey(key);

    const client = this.getClient();
    const bucket = this.getBucket(key);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Forces "save as" instead of in-browser rendering, and is what makes the download
      // work cross-origin (the HTML `download` attribute is ignored for a foreign origin).
      ...(input.downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${sanitizeDownloadFilename(
              input.downloadFilename,
            )}"`,
          }
        : {}),
    });

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    const url = await getSignedUrl(client, command, { expiresIn: ttlSeconds });

    return {
      url,
      expiresAt: new Date(expS * 1000),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // putObject — server-side write (no presigned round-trip; see interface doc).
  // ─────────────────────────────────────────────────────────────────────────

  async putObject(input: PutObjectInput): Promise<void> {
    validateStorageKey(input.key);

    const client = this.getClient();
    const bucket = this.getBucket(input.key);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // delete
  // ─────────────────────────────────────────────────────────────────────────

  async delete(input: DeleteInput): Promise<void> {
    validateStorageKey(input.key);

    const client = this.getClient();
    const bucket = this.getBucket(input.key);

    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: input.key,
        }),
      );
    } catch (err) {
      // S3 returns 204 for both found + deleted and not-found keys.  If we
      // somehow get a non-204 error, log and rethrow.
      this.logger.error(
        `[S3StorageProvider] delete failed: key=${input.key} err=${String(err)}`,
      );
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // head
  // ─────────────────────────────────────────────────────────────────────────

  async head(input: HeadInput): Promise<HeadResult> {
    validateStorageKey(input.key);

    const client = this.getClient();
    const bucket = this.getBucket(input.key);

    try {
      const response = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: input.key,
        }),
      );

      return {
        exists: true,
        size: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch (err) {
      // S3 returns a 404 / "NotFound" / "NoSuchKey" error when the object
      // does not exist.  Normalise this to { exists: false }.
      if (
        err instanceof S3ServiceException &&
        (err.$metadata?.httpStatusCode === 404 ||
          err.name === "NotFound" ||
          err.name === "NoSuchKey")
      ) {
        return { exists: false };
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static helpers (mirrors pattern from NoopVideoProvider)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Builds a scoped, sanitised storage key.
   * Delegates to the top-level buildStorageKey() function.
   *
   * Example:
   *   S3StorageProvider.buildKey({
   *     namespace: 'submissions',
   *     tenantId: enrollment.tenantId,
   *     scopeId: enrollment.id,
   *     uniqueId: randomUUID(),
   *     filename: 'assignment.pdf',
   *   });
   *   // → "submissions/<tenantId>/<enrollmentId>/<uuid>-assignment.pdf"
   */
  static buildKey(opts: BuildKeyOptions): string {
    return buildStorageKey(opts);
  }
}
