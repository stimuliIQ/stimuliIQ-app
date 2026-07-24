// packages/types/src/growth/public-seo.schemas.ts
//
// Shared contract for growth public SEO surfaces (Phase 9 Completion T30) — PROMOTED
// from the STOPGAP local schema at apps/api/src/modules/growth/dto/growth.schemas.ts
// (see that file's header for the full original rationale). This package is now the
// canonical shared contract; the backend controller/service currently still import
// their own local copy — the two shapes MUST stay structurally identical.
//
// PUBLIC, unauthenticated, GET-only (mirrors PublicCatalogController's "separate
// controller class, NO guards" convention, ADR-0019).
//
// Endpoints:
//   GET /api/v1/public/seo/cities            — per-city program-count index
//   GET /api/v1/public/seo/cities/:citySlug  — per-city SEO landing detail
//   GET /api/v1/public/bundles               — programs grouped by `domain` ("track")
//
// Reuses `PublicProgramSummarySchema` (the SAME forbidden-field-safe public program
// projection every other public catalog endpoint returns) rather than inventing a
// second program shape.

import { z } from "zod";
import { PublicProgramSummarySchema } from "../public/programs.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Per-city SEO
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/public/seo/cities */
export const CitySeoIndexItemSchema = z.object({
  city: z.string(),
  programCount: z.number().int().min(0),
  citySlug: z
    .string()
    .describe("Pre-built SEO slug segment for /programs/city/:citySlug (lowercased, hyphenated)."),
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
  seoTitle: z
    .string()
    .describe('Server-generated SEO title, e.g. "Best Full Stack Development Courses in Hyderabad".'),
  seoDescription: z.string(),
  programs: z.array(PublicProgramSummarySchema),
});
export type CitySeoDetailResponse = z.infer<typeof CitySeoDetailResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Bundles / tracks pricing (programs grouped by `domain`)
// ─────────────────────────────────────────────────────────────────────────

export const BundleSchema = z.object({
  domain: z
    .string()
    .describe('`programs.domain` — used as the "track" grouping key (e.g. "Full Stack Development").'),
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
