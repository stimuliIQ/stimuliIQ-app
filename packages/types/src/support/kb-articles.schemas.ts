// Knowledge-base article contract — Phase 9 Completion, T14/T21. Backs `model KbArticle`.
// Admin CRUD under /api/v1/crm/kb-articles; public read (published=true only) under
// /api/v1/public/kb-articles for the LMS/web help-center surfaces.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Admin (CRM) CRUD
// ─────────────────────────────────────────────────────────────────────────

export const CreateKbArticleRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    slug: z.string().min(1).max(220).regex(/^[a-z0-9-]+$/, "lowercase kebab-case slug"),
    body: z.string().min(1),
    category: z.string().min(1).max(80).optional(),
    published: z.boolean().default(false),
  })
  .strict();
export type CreateKbArticleRequest = z.infer<typeof CreateKbArticleRequestSchema>;

export const UpdateKbArticleRequestSchema = CreateKbArticleRequestSchema.partial().strict();
export type UpdateKbArticleRequest = z.infer<typeof UpdateKbArticleRequestSchema>;

export const ListKbArticlesQuerySchema = z
  .object({
    category: z.string().min(1).max(80).optional(),
    published: z.coerce.boolean().optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListKbArticlesQuery = z.infer<typeof ListKbArticlesQuerySchema>;

export const KbArticleSummarySchema = z.object({
  id: UuidSchema,
  title: z.string(),
  slug: z.string(),
  category: z.string().nullable(),
  published: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type KbArticleSummary = z.infer<typeof KbArticleSummarySchema>;

export const KbArticleDetailSchema = KbArticleSummarySchema.extend({
  body: z.string(),
  updatedAt: IsoDateTimeSchema,
});
export type KbArticleDetail = z.infer<typeof KbArticleDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Public read (published only — no tenant/status leakage)
// ─────────────────────────────────────────────────────────────────────────

export const ListPublicKbArticlesQuerySchema = z
  .object({
    category: z.string().min(1).max(80).optional(),
    search: z.string().min(1).max(200).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListPublicKbArticlesQuery = z.infer<typeof ListPublicKbArticlesQuerySchema>;

export const PublicKbArticleSummarySchema = z.object({
  id: UuidSchema,
  title: z.string(),
  slug: z.string(),
  category: z.string().nullable(),
});
export type PublicKbArticleSummary = z.infer<typeof PublicKbArticleSummarySchema>;

export const PublicKbArticleDetailSchema = PublicKbArticleSummarySchema.extend({
  body: z.string(),
});
export type PublicKbArticleDetail = z.infer<typeof PublicKbArticleDetailSchema>;
