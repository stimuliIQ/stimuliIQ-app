// apps/api/src/modules/growth/dto/growth.schemas.ts
//
// STOPGAP CONTRACT — same class of documented deviation as
// apps/api/src/modules/bulk-actions/dto/bulk-actions.schemas.ts (no city-SEO or
// bundles/tracks-pricing schema exists anywhere under packages/types/src as of this
// task; T30's brief scopes backend-builder to apps/api only). FOLLOW-UP: promote to
// packages/types/src/public/growth.schemas.ts in a later pass so the `web` app's
// per-city landing pages / bundles page can share this contract via @repo/api-client.
//
// Reuses `PublicProgramSummarySchema` from @repo/types (the SAME forbidden-field-safe
// public program projection every other public catalog endpoint returns) rather than
// inventing a second program shape.

import { z } from "zod";
import { PublicProgramSummarySchema } from "@repo/types";

// ─────────────────────────────────────────────────────────────────────────
// Per-city SEO
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/public/seo/cities */
export const CitySeoIndexItemSchema = z.object({
  city: z.string(),
  programCount: z.number().int().min(0),
  /** Pre-built SEO slug segment for /programs/city/:citySlug (lowercased, hyphenated). */
  citySlug: z.string(),
});
export type CitySeoIndexItem = z.infer<typeof CitySeoIndexItemSchema>;

export const CitySeoIndexResponseSchema = z.object({
  cities: z.array(CitySeoIndexItemSchema),
});
export type CitySeoIndexResponse = z.infer<typeof CitySeoIndexResponseSchema>;

/** GET /api/v1/public/seo/cities/:citySlug */
export const CitySeoDetailResponseSchema = z.object({
  city: z.string(),
  citySlug: z.string(),
  /** Server-generated SEO title, e.g. "Best Full Stack Development Courses in Hyderabad". */
  seoTitle: z.string(),
  seoDescription: z.string(),
  programs: z.array(PublicProgramSummarySchema),
});
export type CitySeoDetailResponse = z.infer<typeof CitySeoDetailResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Bundles / tracks pricing (programs grouped by `domain`)
// ─────────────────────────────────────────────────────────────────────────

export const BundleSchema = z.object({
  /** `programs.domain` — used as the "track" grouping key (e.g. "Full Stack Development"). */
  domain: z.string(),
  programCount: z.number().int().min(0),
  minPricePaise: z.number().int().min(0),
  maxPricePaise: z.number().int().min(0),
  programs: z.array(PublicProgramSummarySchema),
});
export type Bundle = z.infer<typeof BundleSchema>;

/** GET /api/v1/public/bundles */
export const ListBundlesResponseSchema = z.object({
  bundles: z.array(BundleSchema),
});
export type ListBundlesResponse = z.infer<typeof ListBundlesResponseSchema>;
