// Headless CMS: Blog contract — Phase 9 Completion, T14/T22/T32
// (docs/plans/phase-9-completion.md). Backs `model BlogCategory` + `model BlogPost`.
//
// `body` carries rich text/MDX-ish content — MUST be sanitized (DOMPurify) at every
// render sink (frontend-builder, T19 rich-text sink), never trusted raw.
// Admin CRUD (draft/publish workflow) under /api/v1/crm/blog/*; public read
// (status=published only, no draft leakage) under /api/v1/public/blog/*.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "./common.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Blog categories (admin)
// ─────────────────────────────────────────────────────────────────────────

export const CreateBlogCategoryRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(140).regex(/^[a-z0-9-]+$/),
  })
  .strict();
export type CreateBlogCategoryRequest = z.infer<typeof CreateBlogCategoryRequestSchema>;

export const UpdateBlogCategoryRequestSchema = CreateBlogCategoryRequestSchema.partial().strict();
export type UpdateBlogCategoryRequest = z.infer<typeof UpdateBlogCategoryRequestSchema>;

export const BlogCategorySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  slug: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type BlogCategory = z.infer<typeof BlogCategorySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Blog posts (admin CRUD)
// ─────────────────────────────────────────────────────────────────────────

export const CreateBlogPostRequestSchema = z
  .object({
    categoryId: UuidSchema.nullable().optional(),
    title: z.string().min(1).max(200),
    slug: z.string().min(1).max(220).regex(/^[a-z0-9-]+$/),
    excerpt: z.string().max(500).optional(),
    body: z.string().min(1),
    coverImageKey: z.string().min(1).optional().describe("StorageProvider object key, not a raw URL."),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(160).optional(),
    status: ContentStatusSchema.default("draft"),
  })
  .strict();
export type CreateBlogPostRequest = z.infer<typeof CreateBlogPostRequestSchema>;

export const UpdateBlogPostRequestSchema = CreateBlogPostRequestSchema.partial().strict();
export type UpdateBlogPostRequest = z.infer<typeof UpdateBlogPostRequestSchema>;

export const ListBlogPostsQuerySchema = z
  .object({
    categoryId: UuidSchema.optional(),
    status: ContentStatusSchema.optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBlogPostsQuery = z.infer<typeof ListBlogPostsQuerySchema>;

export const BlogPostSummarySchema = z.object({
  id: UuidSchema,
  categoryId: UuidSchema.nullable(),
  categoryName: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  coverImageUrl: z.string().url().nullable().describe("CDN URL minted server-side from coverImageKey."),
  status: ContentStatusSchema,
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type BlogPostSummary = z.infer<typeof BlogPostSummarySchema>;

export const BlogPostDetailSchema = BlogPostSummarySchema.extend({
  body: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  authorId: UuidSchema.nullable(),
  authorName: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type BlogPostDetail = z.infer<typeof BlogPostDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Public read (published only)
// ─────────────────────────────────────────────────────────────────────────

export const ListPublicBlogPostsQuerySchema = z
  .object({
    categorySlug: z.string().min(1).max(140).optional(),
    search: z.string().min(1).max(200).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListPublicBlogPostsQuery = z.infer<typeof ListPublicBlogPostsQuerySchema>;

export const PublicBlogPostSummarySchema = z.object({
  id: UuidSchema,
  categoryName: z.string().nullable(),
  categorySlug: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  coverImageUrl: z.string().url().nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
});
export type PublicBlogPostSummary = z.infer<typeof PublicBlogPostSummarySchema>;

export const PublicBlogPostDetailSchema = PublicBlogPostSummarySchema.extend({
  body: z.string().describe("Raw authored content. MUST be sanitized (DOMPurify) at the render sink."),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  authorName: z.string().nullable(),
});
export type PublicBlogPostDetail = z.infer<typeof PublicBlogPostDetailSchema>;

// Compile-time no-leak assertion — public blog DTOs must never carry tenantId/status/deletedAt.
type ForbiddenPublicContentField = "tenantId" | "status" | "deletedAt" | "categoryId" | "coverImageKey";
type AssertNoForbiddenFields<T, K extends string> = [K extends keyof T ? "FORBIDDEN FIELD IN PUBLIC DTO" : "ok"] extends ["ok"]
  ? true
  : never;
type _AssertPublicBlogPostSummaryNoLeak = AssertNoForbiddenFields<PublicBlogPostSummary, ForbiddenPublicContentField>;
type _AssertPublicBlogPostDetailNoLeak = AssertNoForbiddenFields<PublicBlogPostDetail, ForbiddenPublicContentField>;
const _assertPublicBlogPostSummary: _AssertPublicBlogPostSummaryNoLeak = true;
const _assertPublicBlogPostDetail: _AssertPublicBlogPostDetailNoLeak = true;
void _assertPublicBlogPostSummary;
void _assertPublicBlogPostDetail;
