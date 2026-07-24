// Headless CMS: generic content pages contract — Phase 9 Completion, T14/T22/T32.
// Backs `model ContentPage` — a block-based CMS page. `body` is a JSON array of typed
// content blocks (e.g. [{type:"hero", data:{...}}, {type:"richtext", data:{html:"..."}}]),
// rendered through the DOMPurify sink (@repo/ui, T19). Admin CRUD under
// /api/v1/crm/content-pages; public read (published only, by slug) under
// /api/v1/public/pages/:slug.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema, ObjectKeySchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "./common.schemas.js";
import { PageBuilderBlockSchema, ResolvedPageBuilderBlockSchema } from "./page-builder-blocks.schemas.js";

/**
 * `seoImagePath` — Phase-11 locked templates, api-designer P1
 * (docs/plans/phase-11-locked-templates.md): a per-page social/OG image, closing the
 * "OG image is sitewide-only today" gap (`SiteSetting`'s `seo.defaults.defaultOgImagePath`
 * remains the fallback when a page has none). Reuses `ObjectKeySchema` — same
 * "stored object key, never a raw/remote URL" contract as every other `*ImageKey`/
 * `*Key` field in this registry (never a bare `z.string().url()`, which would reopen the
 * open-redirect/XSS surface `ObjectKeySchema`'s hardening (common/primitives.ts) exists to
 * close). ADDITIVE + optional/nullable everywhere it appears below — every existing
 * `ContentPage`/`ContentPageVersion` row is unaffected (`null` until a super_admin sets one).
 */
const SeoImagePathSchema = ObjectKeySchema;

/** One typed content block. `data` is open-shape per block `type` (rendered client-side per type). */
export const ContentBlockSchema = z
  .object({
    type: z.string().min(1).max(60),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const CreateContentPageRequestSchema = z
  .object({
    slug: z.string().min(1).max(220).regex(/^[a-z0-9-/]+$/, "lowercase kebab-case slug (may contain /)"),
    title: z.string().min(1).max(200),
    body: z.array(ContentBlockSchema),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(160).optional(),
    seoImagePath: SeoImagePathSchema.optional(),
    status: ContentStatusSchema.default("draft"),
  })
  .strict();
export type CreateContentPageRequest = z.infer<typeof CreateContentPageRequestSchema>;

export const UpdateContentPageRequestSchema = CreateContentPageRequestSchema.partial().strict();
export type UpdateContentPageRequest = z.infer<typeof UpdateContentPageRequestSchema>;

export const ListContentPagesQuerySchema = z
  .object({
    status: ContentStatusSchema.optional(),
    search: z.string().min(1).max(200).optional(),
    /** Phase-10 page builder: filter to/away-from builder-managed rows (routes the CRM
     *  list row to the block-builder editor vs. the legacy generic-block editor). */
    isBuilderManaged: z.coerce.boolean().optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListContentPagesQuery = z.infer<typeof ListContentPagesQuerySchema>;

export const ContentPageSummarySchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  title: z.string(),
  status: ContentStatusSchema,
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Phase-10 page builder (docs/specs/phase-10-page-builder.md): `true` -> row is
   *  authored through the block-based page builder (save-is-live, `content.builder`
   *  permission, version history); `false` -> the legacy generic draft/publish CMS row
   *  (`content.edit`/`content.publish`). Drives which CRM editor UI a row opens in. */
  isBuilderManaged: z.boolean(),
});
export type ContentPageSummary = z.infer<typeof ContentPageSummarySchema>;

export const ContentPageDetailSchema = ContentPageSummarySchema.extend({
  body: z.array(ContentBlockSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoImagePath: SeoImagePathSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type ContentPageDetail = z.infer<typeof ContentPageDetailSchema>;

// ── Public read ──────────────────────────────────────────────────────────

/**
 * `body` is a UNION so the wire shape stays the same `{type,data}[]` envelope either way,
 * while TS callers get real per-block typing:
 *   - `isBuilderManaged=true`  -> `ResolvedPageBuilderBlockSchema[]` (the strict Phase-10
 *     registry, `live_collection_ref` pre-resolved server-side + published-filtered).
 *   - `isBuilderManaged=false` -> `ContentBlockSchema[]` (the legacy generic envelope,
 *     rendered client-side per `type`; `richtext` blocks pass through the DOMPurify sink).
 * zod tries the first member first; a legacy page's blocks (e.g. `richtext`) never match
 * the closed builder union's literal `type`s and correctly fall through to the generic shape.
 */
export const PublicContentPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  isBuilderManaged: z.boolean(),
  body: z.union([z.array(ResolvedPageBuilderBlockSchema), z.array(ContentBlockSchema)]).describe(
    "isBuilderManaged=true: resolved Phase-10 block registry. isBuilderManaged=false: generic {type,data} blocks, rendered through the DOMPurify sink at every block of type='richtext'.",
  ),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoImagePath: SeoImagePathSchema.nullable(),
});
export type PublicContentPage = z.infer<typeof PublicContentPageSchema>;

// ── Phase-10 page builder ───────────────────────────────────────────────
// docs/specs/phase-10-page-builder.md. Endpoints extend the existing
// /api/v1/crm/content-pages surface above; permission `content.builder` throughout
// (super_admin-only — see prisma/seed.ts). `ContentPageVersion` snapshots are
// SAVE-BEFORE-APPLY: on every save/revert, the row's state PRIOR to that mutation is
// written as the new version (version = expectedVersion+1), THEN the new content is
// applied to the live `ContentPage` row. `currentVersion` (== the count of version rows
// so far, 0 for a never-yet-saved page) is both "the version I'm looking at" for the CRM
// UI and the concurrency token the client echoes back as `expectedVersion` on its next
// save/revert (Edge case #5) — a mismatch means someone else saved in between, and the
// endpoint returns 409 rather than silently clobbering their change.

/**
 * Builder-specific detail projection — same as `ContentPageDetail` but `body` is the
 * STRICT block union (builder rows are always `isBuilderManaged=true`) plus
 * `currentVersion`. Returned by create/save/revert.
 */
export const ContentPageBuilderDetailSchema = ContentPageDetailSchema.extend({
  isBuilderManaged: z.literal(true),
  body: z.array(PageBuilderBlockSchema),
  currentVersion: z.number().int().min(0),
});
export type ContentPageBuilderDetail = z.infer<typeof ContentPageBuilderDetailSchema>;

/**
 * `POST /crm/content-pages/builder` — create a new, empty (`body: []`) builder-managed
 * page. `status` is forced `published` immediately (AC 5/13: an empty page is a valid,
 * live save). No version row is created on bare creation — there is no "previous state"
 * to snapshot yet; the FIRST real `PUT .../builder` save creates version 1. Slug is set
 * once here and is NOT editable via the builder save endpoint (matches the 6
 * code-owned-slug migrated pages' precedent, Edge case #7); reserved-slug denylist
 * enforcement (Edge case #8) is a `backend-builder` service-layer concern on this create
 * path, same as the existing `content.slug_taken` check.
 */
export const CreateBuilderPageRequestSchema = z
  .object({
    slug: z.string().min(1).max(220).regex(/^[a-z0-9-/]+$/, "lowercase kebab-case slug (may contain /)"),
    title: z.string().min(1).max(200),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(160).optional(),
    seoImagePath: SeoImagePathSchema.optional(),
  })
  .strict();
export type CreateBuilderPageRequest = z.infer<typeof CreateBuilderPageRequestSchema>;

/**
 * `PUT /crm/content-pages/:id/builder` — save (AC 1/2/3/5/6/12/13). `body` is validated
 * against the STRICT block union (`PageBuilderBlockSchema`) — an unknown/malformed block
 * fails the whole save with a field-level error naming the block/field (AC 12), no
 * partial write. `expectedVersion` MUST equal the page's current `currentVersion`
 * (0 if never saved) or the request is rejected with 409 (Edge case #5).
 */
export const SaveBuilderPageRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    // Bounded (security review L1): no explicit block-count cap existed previously —
    // 60 mirrors the largest single-block-type array bound already in the registry
    // (media_gallery.items, page-builder-blocks.schemas.ts) as a sane page-level ceiling.
    body: z.array(PageBuilderBlockSchema).max(60),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(160).optional(),
    seoImagePath: SeoImagePathSchema.optional(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type SaveBuilderPageRequest = z.infer<typeof SaveBuilderPageRequestSchema>;

/**
 * `POST /crm/content-pages/:id/preview` — unsaved-edit preview (AC 4). Read-only: no
 * persistence, no version bump, no audit-log write. `live_collection_ref` blocks are
 * resolved through the SAME server-side resolver the public read path uses (identical
 * published-filtered source data), so preview is a faithful "what will visitors see"
 * render of unsaved edits — see api-designer decision notes (preview is NOT purely
 * client-side, precisely because reference-block resolution must not be duplicated/
 * re-implemented in the frontend).
 */
export const PreviewBuilderPageRequestSchema = z
  .object({
    // Bounded (security review L1) — same 60-block page-level ceiling as SaveBuilderPageRequestSchema.
    body: z.array(PageBuilderBlockSchema).max(60),
  })
  .strict();
export type PreviewBuilderPageRequest = z.infer<typeof PreviewBuilderPageRequestSchema>;

export const PreviewBuilderPageResponseSchema = z.object({
  blocks: z.array(ResolvedPageBuilderBlockSchema),
});
export type PreviewBuilderPageResponse = z.infer<typeof PreviewBuilderPageResponseSchema>;

// ── Version history (AC 6/7) ────────────────────────────────────────────

export const ListContentPageVersionsQuerySchema = PageQuerySchema.strict();
export type ListContentPageVersionsQuery = z.infer<typeof ListContentPageVersionsQuerySchema>;

/** Metadata only — no `body` (kept out of the list response by design; fetch a single
 *  version via `GET .../versions/:version` for the body). Newest-first (AC 6). */
export const ContentPageVersionSummarySchema = z.object({
  version: z.number().int().min(1),
  title: z.string(),
  createdBy: z.object({ id: UuidSchema, name: z.string() }),
  createdAt: IsoDateTimeSchema,
});
export type ContentPageVersionSummary = z.infer<typeof ContentPageVersionSummarySchema>;

export const ContentPageVersionDetailSchema = ContentPageVersionSummarySchema.extend({
  body: z.array(PageBuilderBlockSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoImagePath: SeoImagePathSchema.nullable(),
});
export type ContentPageVersionDetail = z.infer<typeof ContentPageVersionDetailSchema>;

/**
 * `POST /crm/content-pages/:id/versions/:version/revert` — AC 7. Same optimistic-
 * concurrency contract as save (`expectedVersion` required, 409 on mismatch). Applies the
 * target version's `title`/`body`/`seoTitle`/`seoDescription` as the new live content and
 * itself creates a new version snapshot of what was live immediately before the revert —
 * history is append-only, never rewound or deleted (AC 7).
 */
export const RevertContentPageVersionRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type RevertContentPageVersionRequest = z.infer<typeof RevertContentPageVersionRequestSchema>;

// ── Marketing image uploads (page-builder blocks: hero/image/media_gallery/etc.) ──────

/**
 * `POST /crm/content-pages/media-upload-url` — mint a short-lived signed PUT URL for a
 * page-builder marketing image (e.g. a `hero`/`image`/`media_gallery` block's image
 * field). Permission `content.builder` (super_admin-only, same as every other builder
 * endpoint). The client PUTs the image directly to the returned URL, then embeds the
 * returned `storageKey` in the relevant block field on save. SVG is deliberately
 * excluded — an SVG served from the public marketing site is a stored-XSS vector
 * (inline `<script>`/event handlers), unlike raster formats. Response is the shared
 * `SignedUploadResponse` (learning/storage.schemas.ts). Mirrors
 * `ProgramImageUploadUrlRequestSchema` (crm/courses.schemas.ts) /
 * `MentorPhotoUploadUrlRequestSchema` (crm/mentors.schemas.ts).
 */
export const ContentPageMediaUploadUrlRequestSchema = z
  .object({
    contentType: z
      .enum(["image/jpeg", "image/png", "image/webp"])
      .describe("Marketing images are raster images only — no SVG (stored XSS vector on the public site)."),
    fileName: z.string().min(1).max(255).describe("Original filename — sanitised server-side before use in the storage key."),
    sizeBytes: z.number().int().min(1).max(5_242_880).describe("Max 5 MB per marketing image."),
  })
  .strict();
export type ContentPageMediaUploadUrlRequest = z.infer<typeof ContentPageMediaUploadUrlRequestSchema>;
