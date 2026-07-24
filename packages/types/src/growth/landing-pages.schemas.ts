// Landing pages contract — Phase 9 Completion, T12/T14/T33/T40. Backs `model
// LandingPage` — a campaign-specific marketing page, optionally A/B tested via
// `variant`. `content` is a JSON array of typed content blocks, same shape as
// `ContentBlockSchema` (content/pages.schemas.ts) — rendered through the DOMPurify
// sink (@repo/ui, T19). Admin CRUD under /api/v1/crm/landing-pages; public render
// (published only, resolves a (slug, variant) pair for A/B serving) under
// /api/v1/public/landing-pages/:slug.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "../content/common.schemas.js";
import { ContentBlockSchema } from "../content/pages.schemas.js";

export const CreateLandingPageRequestSchema = z
  .object({
    campaign: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(220).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(200),
    variant: z.string().min(1).max(20).default("a"),
    content: z.array(ContentBlockSchema),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(160).optional(),
    status: ContentStatusSchema.default("draft"),
  })
  .strict();
export type CreateLandingPageRequest = z.infer<typeof CreateLandingPageRequestSchema>;

export const UpdateLandingPageRequestSchema = CreateLandingPageRequestSchema.partial().strict();
export type UpdateLandingPageRequest = z.infer<typeof UpdateLandingPageRequestSchema>;

export const ListLandingPagesQuerySchema = z
  .object({
    campaign: z.string().min(1).max(120).optional(),
    status: ContentStatusSchema.optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListLandingPagesQuery = z.infer<typeof ListLandingPagesQuerySchema>;

export const LandingPageSummarySchema = z.object({
  id: UuidSchema,
  campaign: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  variant: z.string(),
  status: ContentStatusSchema,
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type LandingPageSummary = z.infer<typeof LandingPageSummarySchema>;

export const LandingPageDetailSchema = LandingPageSummarySchema.extend({
  content: z.array(ContentBlockSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type LandingPageDetail = z.infer<typeof LandingPageDetailSchema>;

// ── Public render ───────────────────────────────────────────────────────

/** GET /api/v1/public/landing-pages/:slug?variant=b — variant optional, server picks a live A/B split when omitted. */
export const GetPublicLandingPageQuerySchema = z
  .object({
    variant: z.string().min(1).max(20).optional(),
  })
  .strict();
export type GetPublicLandingPageQuery = z.infer<typeof GetPublicLandingPageQuerySchema>;

export const PublicLandingPageSchema = z.object({
  slug: z.string(),
  variant: z.string(),
  title: z.string(),
  content: z.array(ContentBlockSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
});
export type PublicLandingPage = z.infer<typeof PublicLandingPageSchema>;
