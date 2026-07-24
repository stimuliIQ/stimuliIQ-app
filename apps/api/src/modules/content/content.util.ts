// apps/api/src/modules/content/content.util.ts
//
// Shared helpers for the Phase-9 headless-CMS module (docs/plans/phase-9-completion.md
// T22). Every content service uses these — kept in one file so the CDN-URL convention and
// tenant resolution never drift between blog/testimonials/partners/faculty-bios/pages.

import { Prisma } from "@prisma/client";
import { validateEnv } from "../../config/env";

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

/**
 * Convert a raw S3/R2 object key to a public asset URL. Returns null if the key is absent.
 * The base is `PUBLIC_ASSET_BASE_URL` (default the production CDN) — for local dev with
 * STORAGE_PROVIDER=local it points at `http://localhost:4000/api/v1/assets`, so images
 * actually resolve. The raw key is NEVER returned to any client (CRM or public).
 */
export function mintCdnUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? DEFAULT_ASSET_BASE).replace(/\/+$/, "");
  return `${base}/${key}`;
}
