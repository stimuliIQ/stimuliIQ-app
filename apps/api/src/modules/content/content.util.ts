// apps/api/src/modules/content/content.util.ts
//
// Shared helpers for the Phase-9 headless-CMS module (docs/plans/phase-9-completion.md
// T22). Every content service uses these — kept in one file so the CDN-URL convention and
// tenant resolution never drift between blog/testimonials/partners/faculty-bios/pages.

import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { validateEnv } from "../../config/env";
import { isPrivateStorageKey } from "../storage/providers/storage/s3-storage.provider";

export const TENANT_SLUG = "stimuliiq"; // Single-tenant (mirrors public-catalog.service.ts).

/**
 * Shared P2002 (unique-constraint-violation) detector — every content service that
 * writes a partial-unique-after-soft-delete `slug`/`key` column (ContentPage.slug,
 * SiteSetting.key, etc.) uses this to translate a DB-level conflict into a 409
 * ConflictException at the service layer, without duplicating the Prisma error-shape
 * check per file.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Production default when PUBLIC_ASSET_BASE_URL is unset. */
const DEFAULT_ASSET_BASE = "https://cdn.stimuliiq.com";

const cdnLogger = new Logger("mintCdnUrl");

/**
 * Convert a raw S3/R2 object key to a public asset URL. Returns null if the key is absent
 * or does not belong to a publicly-served namespace. The base is `PUBLIC_ASSET_BASE_URL`
 * (default the production CDN) — for local dev with STORAGE_PROVIDER=local it points at
 * `http://localhost:4000/api/v1/assets`, so images actually resolve. The raw key is NEVER
 * returned to any client (CRM or public).
 *
 * THE NAMESPACE CHECK IS THE POINT. Most key-bearing fields are minted server-side and
 * are trustworthy, but several are plain strings a CRM user types into a form —
 * `ogImageKey` and `brochureKey` on a course, `logoKey` on a college or partner,
 * `photoKey`, `coverImageKey`, `seoImagePath` — validated only as "1..1024 characters".
 * Concatenated blindly, a content editor with `courses.edit` could set `ogImageKey` to
 * `careers/{tenantId}/{uuid}-resume.pdf` and the public programme page would publish a
 * permanent, unauthenticated link to a job applicant's CV. Whoever may rewrite the
 * homepage should not thereby be able to republish somebody's private document.
 *
 * The refusal is scoped to keys in the namespaces this system MANAGES as private (see
 * `isPrivateStorageKey`), not to everything outside the public list — the partners
 * manager, for one, takes a hand-typed key for a file an operator uploaded to the bucket
 * themselves, and those must keep working.
 *
 * A refused key returns null (every caller already handles a missing image) and is
 * logged, because it is either a bug or an attempt — never routine.
 */
export function mintCdnUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (isPrivateStorageKey(key)) {
    cdnLogger.warn(
      `Refusing to mint a public URL for "${key}": that namespace holds private objects ` +
        "(submissions, exports, invoices, receipts, certificates, resumes, onboarding files, " +
        "source video), which are delivered only through short-lived signed URLs.",
    );
    return null;
  }
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? DEFAULT_ASSET_BASE).replace(/\/+$/, "");
  return `${base}/${key}`;
}
