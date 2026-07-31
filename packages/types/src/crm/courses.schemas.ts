// Courses/curriculum contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// `programs`/`modules`/`lessons` tables already existed pre-P1 (P0 schema);
// this Wave adds the CRM-facing CRUD + curriculum-tree + publish/unpublish
// contracts for them. `pricePaise` is integer minor units (CLAUDE.md §3.6) —
// never a float. Coupons/pricing *flows* are P2; only the existing
// `pricePaise`/`emi` fields are editable here (docs/plans/phase-1.md scope
// note).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const ProgramDomainSchema = z.string().min(1).max(80);

export const ProgramLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export type ProgramLevel = z.infer<typeof ProgramLevelSchema>;

export const ProgramModeSchema = z.enum(["live", "recorded", "hybrid"]);
export type ProgramMode = z.infer<typeof ProgramModeSchema>;

export const ProgramStatusSchema = z.enum(["draft", "published", "archived"]);
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;

export const LessonTypeSchema = z.enum(["video", "reading", "assignment", "quiz"]);
export type LessonType = z.infer<typeof LessonTypeSchema>;

/**
 * Marketing badge background colour, `#RRGGBB`. Shorthand (`#f00`), alpha, and named
 * colours are rejected so every consumer can assume one parseable format and the column
 * stays VARCHAR(7).
 *
 * Only the background is stored — badge text colour is derived from this at render time
 * (`readableTextOn` in @repo/ui), so a freely-picked colour cannot yield an unreadable chip.
 */
export const ProgramBadgeColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex colour like #DC2626");

/** EMI plan option attached to a program (`programs.emi` json column). */
export const EmiPlanSchema = z.object({
  months: z.number().int().min(1).max(60),
  amountPaise: z.number().int().min(0).describe("Per-installment amount, integer paise."),
});
export type EmiPlan = z.infer<typeof EmiPlanSchema>;

/** SEO metadata surfaced to `web` (`programs.seo` json column). */
export const ProgramSeoSchema = z.object({
  metaTitle: z.string().max(70).optional(),
  metaDescription: z.string().max(160).optional(),
  ogImageUrl: z.string().url().optional(),
});
export type ProgramSeo = z.infer<typeof ProgramSeoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Program requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/courses */
export const CreateProgramRequestSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug"),
    title: z.string().min(1).max(200),
    domain: ProgramDomainSchema,
    level: ProgramLevelSchema,
    mode: ProgramModeSchema,
    durationWeeks: z.number().int().min(1).max(104),
    pricePaise: z.number().int().min(0),
    /**
     * Struck-through "was" price, display only (see the Prisma column comment). Must be
     * STRICTLY GREATER than `pricePaise` — a compare-at at or below the real price would
     * render as `₹6,999 ₹6,999` or, worse, advertise a saving that doesn't exist. The
     * cross-field check lives in the superRefine on the create/update inputs below,
     * because it needs both values.
     */
    compareAtPricePaise: z
      .number()
      .int()
      .min(0)
      .nullish()
      .describe("Struck-through 'was' price in paise. Null/omitted = show a single price."),
    emi: z.array(EmiPlanSchema).max(12).default([]),
    summary: z.string().max(4000).optional(),
    seo: ProgramSeoSchema.optional(),
    status: ProgramStatusSchema.default("draft"),
    // ── Marketing fields surfaced on the public website (P5 columns) ──
    cardSummary: z
      .string()
      .max(200)
      .optional()
      .describe("Short marketing hook shown on /programs list cards and featured blocks."),
    outcomes: z
      .array(z.string().min(1).max(300))
      .max(20)
      .optional()
      .describe("Learning outcomes shown on the public detail page (one string per bullet)."),
    ogImageKey: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        "S3/R2 object key from POST /crm/courses/image-upload-url. The API mints a public CDN " +
          "URL from it — the raw key is never returned. Used as the course card + OG image.",
      ),
    brochureKey: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        "S3/R2 object key from POST /crm/courses/brochure-upload-url (PDF). The API mints a " +
          "public asset URL from it — the raw key is never returned. Surfaced as the " +
          "'Download brochure' button on the public course page.",
      ),
    scholarshipAvailable: z
      .boolean()
      .default(false)
      .describe("When true the website shows a 'Scholarship available' badge on the course."),
    // ── Marketing badge ──
    // Three fields, not one: colour is the chip background, label the text, enabled the
    // visibility. The "enabled needs both a colour and a label" invariant is enforced in
    // CoursesService, NOT here — a PATCH may send any subset, so the check needs the
    // stored row to resolve the merged state (same reason `compareAtPricePaise` is
    // validated there rather than in a superRefine).
    badgeColor: ProgramBadgeColorSchema.nullish().describe(
      "Badge background as #RRGGBB. Text colour is derived from it at render time.",
    ),
    badgeLabel: z
      .string()
      .min(1)
      .max(24)
      .nullish()
      .describe("Badge text, e.g. 'Hot' or 'Limited seats'."),
    badgeEnabled: z
      .boolean()
      .default(false)
      .describe("When true the badge renders on the public course card. Requires a colour and a label."),
    enrollmentEnabled: z
      .boolean()
      .default(true)
      .describe(
        "When true the website shows the 'Enroll Now' CTA and self-serve checkout is open. " +
          "When false only 'Book Free Slot' is offered and the API rejects new orders for " +
          "this program. Defaults true so an existing sellable program stays sellable.",
      ),
  })
  .strict();
export type CreateProgramRequest = z.infer<typeof CreateProgramRequestSchema>;

/** PATCH /api/v1/crm/courses/:id — `status` transitions go through the publish/unpublish actions, not this. */
export const UpdateProgramRequestSchema = CreateProgramRequestSchema.omit({ status: true })
  .partial()
  .extend({
    ogImageKey: z
      .string()
      .min(1)
      .max(1024)
      .nullable()
      .optional()
      .describe("Set to a new key to replace the image, or null to clear it."),
    brochureKey: z
      .string()
      .min(1)
      .max(1024)
      .nullable()
      .optional()
      .describe("Set to a new key to replace the brochure, or null to remove it."),
  })
  .strict();
export type UpdateProgramRequest = z.infer<typeof UpdateProgramRequestSchema>;

/**
 * POST /api/v1/crm/courses/image-upload-url — mint a short-lived signed PUT URL for a
 * course card/OG image (staff-scoped; permission `courses.edit`). The client PUTs the
 * image directly to the returned URL, then sends the returned `storageKey` back as
 * `ogImageKey` on create/update. Response is the shared `SignedUploadResponse`.
 * Mirrors MentorPhotoUploadUrlRequestSchema.
 */
export const ProgramImageUploadUrlRequestSchema = z
  .object({
    contentType: z
      .enum(["image/jpeg", "image/png", "image/webp"])
      .describe("Course images are images only — the signed URL enforces this content-type."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(5_242_880).describe("Max 5 MB per course image."),
  })
  .strict();
export type ProgramImageUploadUrlRequest = z.infer<typeof ProgramImageUploadUrlRequestSchema>;

/**
 * POST /api/v1/crm/courses/brochure-upload-url — mint a short-lived signed PUT URL for the
 * downloadable course brochure (staff-scoped; permission `courses.edit`). Same two-step
 * ingest as the course image: PUT the file to the returned URL, then send `storageKey` back
 * as `brochureKey` on create/update.
 *
 * PDF ONLY, deliberately: this object is linked straight from a public marketing page, so
 * the content-type the signed URL pins is also what a visitor's browser will be handed.
 * Allowing arbitrary types here would turn the course page into an open file host.
 */
export const ProgramBrochureUploadUrlRequestSchema = z
  .object({
    contentType: z
      .literal("application/pdf")
      .describe("Brochures are PDFs only — the signed URL enforces this content-type."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(20_971_520).describe("Max 20 MB per brochure."),
  })
  .strict();
export type ProgramBrochureUploadUrlRequest = z.infer<typeof ProgramBrochureUploadUrlRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Lesson resources (PDFs, slides, datasets, cheat-sheets) — staff authoring
//
// SHAPE: a lesson has MANY resources (1:N), unlike video which is 1:1
// (`videos.lesson_id` is UNIQUE). Uploading a second video REPLACES the first;
// uploading a second PDF ADDS to the list.
//
// FLOW (mirrors the video/course-image ingest exactly):
//   1. POST .../resources/upload-url → short-TTL signed PUT + opaque storageKey
//   2. browser PUTs the file DIRECTLY to storage (never proxied through the API)
//   3. POST .../resources { storageKey, … } → creates the row
// The raw `storageKey` is server-internal: it is accepted on create (the client
// only ever knows the key the server just minted for it) but is NEVER returned in
// any read DTO. Students receive short-lived signed download URLs instead.
// ─────────────────────────────────────────────────────────────────────────

export const LessonResourceTypeSchema = z.enum(["pdf", "slide", "dataset", "cheatsheet", "link", "other"]);
export type LessonResourceType = z.infer<typeof LessonResourceTypeSchema>;

/** Content types accepted for a lesson attachment. Enforced by the signed URL. */
export const LessonResourceContentTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "text/csv",
  "image/png",
  "image/jpeg",
]);

/** POST /api/v1/crm/lessons/:lessonId/resources/upload-url */
export const LessonResourceUploadUrlRequestSchema = z
  .object({
    contentType: LessonResourceContentTypeSchema,
    fileName: z.string().min(1).max(255),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(100 * 1024 * 1024)
      .describe("Max 100 MB per lesson resource."),
  })
  .strict();
export type LessonResourceUploadUrlRequest = z.infer<typeof LessonResourceUploadUrlRequestSchema>;

/** POST /api/v1/crm/lessons/:lessonId/resources — register the uploaded object. */
export const CreateLessonResourceRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    type: LessonResourceTypeSchema,
    storageKey: z
      .string()
      .min(1)
      .max(1024)
      .describe("The opaque key returned by the upload-url endpoint. Server-internal — never echoed back in reads."),
    sizeBytes: z.number().int().min(0).nullable().optional(),
  })
  .strict();
export type CreateLessonResourceRequest = z.infer<typeof CreateLessonResourceRequestSchema>;

/** Staff-facing resource row. Deliberately excludes `storageKey`. */
export const LessonResourceSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  title: z.string(),
  type: LessonResourceTypeSchema,
  sizeBytes: z.number().int().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type LessonResource = z.infer<typeof LessonResourceSchema>;

/** GET /api/v1/crm/courses */
export const ListProgramsQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Matches title or slug."),
    domain: ProgramDomainSchema.optional(),
    level: ProgramLevelSchema.optional(),
    status: ProgramStatusSchema.optional(),
    includeDeleted: z.coerce.boolean().default(false),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListProgramsQuery = z.infer<typeof ListProgramsQuerySchema>;

/** POST /api/v1/crm/courses/:id/publish and .../unpublish — both empty-body actions. */
export const PublishProgramRequestSchema = z.object({}).strict();
export type PublishProgramRequest = z.infer<typeof PublishProgramRequestSchema>;

/**
 * PATCH /api/v1/crm/courses/:id/visibility — flip the marketing `isPublic` flag.
 * SEPARATE from publish/unpublish (which are the `status` lifecycle): the public
 * website lists a program only when status='published' AND isPublic=true, so this
 * toggle is what actually makes a published program appear on the marketing site
 * and the book-a-slot dropdown.
 */
export const SetProgramVisibilityRequestSchema = z.object({ isPublic: z.boolean() }).strict();
export type SetProgramVisibilityRequest = z.infer<typeof SetProgramVisibilityRequestSchema>;

/**
 * POST /api/v1/crm/courses/reorder
 *
 * Full ordered list of the tenant's program ids — the server re-derives `order` from
 * array position, exactly like `ReorderModulesRequestSchema`. Because it is a full-list
 * replace (not a pairwise swap), callers must send EVERY program id, not just the page
 * currently on screen, or the omitted programs collapse to the front of the sequence.
 */
export const ReorderProgramsRequestSchema = z
  .object({
    programIds: z.array(UuidSchema).min(1),
  })
  .strict();
export type ReorderProgramsRequest = z.infer<typeof ReorderProgramsRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Module requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/courses/:programId/modules */
export const CreateModuleRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    order: z.number().int().min(0),
  })
  .strict();
export type CreateModuleRequest = z.infer<typeof CreateModuleRequestSchema>;

/** PATCH /api/v1/crm/courses/:programId/modules/:moduleId */
export const UpdateModuleRequestSchema = CreateModuleRequestSchema.partial().strict();
export type UpdateModuleRequest = z.infer<typeof UpdateModuleRequestSchema>;

/**
 * POST /api/v1/crm/courses/:programId/modules/reorder
 * Full ordered list of module ids for the program — server re-derives
 * `order` from array position (simplest, avoids partial-reorder race bugs).
 */
export const ReorderModulesRequestSchema = z
  .object({
    moduleIds: z.array(UuidSchema).min(1),
  })
  .strict();
export type ReorderModulesRequest = z.infer<typeof ReorderModulesRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Lesson requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/courses/:programId/modules/:moduleId/lessons */
export const CreateLessonRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    type: LessonTypeSchema,
    order: z.number().int().min(0),
    content: z.string().max(20000).optional().describe("Rich content/body; video attach is a P3 video-library concern, not P1."),
    isPreview: z.boolean().default(false),
  })
  .strict();
export type CreateLessonRequest = z.infer<typeof CreateLessonRequestSchema>;

/** PATCH /api/v1/crm/courses/:programId/modules/:moduleId/lessons/:lessonId */
export const UpdateLessonRequestSchema = CreateLessonRequestSchema.partial().strict();
export type UpdateLessonRequest = z.infer<typeof UpdateLessonRequestSchema>;

/**
 * POST /api/v1/crm/courses/:programId/modules/:moduleId/lessons/reorder
 * Same full-list-reorder semantics as ReorderModulesRequestSchema, scoped to one module.
 */
export const ReorderLessonsRequestSchema = z
  .object({
    lessonIds: z.array(UuidSchema).min(1),
  })
  .strict();
export type ReorderLessonsRequest = z.infer<typeof ReorderLessonsRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const ProgramSummarySchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  title: z.string(),
  domain: z.string(),
  level: ProgramLevelSchema,
  mode: ProgramModeSchema,
  durationWeeks: z.number().int(),
  pricePaise: z.number().int(),
  compareAtPricePaise: z.number().int().nullable(),
  status: ProgramStatusSchema,
  isPublic: z.boolean().describe("Marketing visibility flag. Program appears on the public site only when status='published' AND isPublic=true."),
  order: z.number().int().describe("Staff-curated display order (ascending). Set only via POST /crm/courses/reorder."),
  badgeColor: z.string().nullable(),
  badgeLabel: z.string().nullable(),
  badgeEnabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type ProgramSummary = z.infer<typeof ProgramSummarySchema>;

export const ProgramDetailSchema = ProgramSummarySchema.extend({
  emi: z.array(EmiPlanSchema),
  summary: z.string().nullable(),
  seo: ProgramSeoSchema.nullable(),
  cardSummary: z.string().nullable(),
  outcomes: z.array(z.string()).nullable(),
  /** Public CDN URL minted from og_image_key; null if no image. NEVER the raw key. */
  ogImageUrl: z.string().url().nullable(),
  /** Public CDN URL minted from brochure_key; null if no brochure. NEVER the raw key. */
  brochureUrl: z.string().url().nullable(),
  scholarshipAvailable: z.boolean(),
  enrollmentEnabled: z.boolean(),
  deletedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type ProgramDetail = z.infer<typeof ProgramDetailSchema>;

export const LessonNodeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: LessonTypeSchema,
  order: z.number().int(),
  isPreview: z.boolean(),
});
export type LessonNode = z.infer<typeof LessonNodeSchema>;

export const ModuleNodeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  order: z.number().int(),
  lessons: z.array(LessonNodeSchema),
});
export type ModuleNode = z.infer<typeof ModuleNodeSchema>;

/**
 * GET /api/v1/crm/courses/:id/curriculum — the full program→modules→lessons
 * tree for the curriculum builder. Content body is intentionally omitted
 * from the tree nodes (fetched per-lesson on demand) to keep this payload
 * small for drag/drop reordering UIs.
 */
export const CurriculumTreeSchema = z.object({
  programId: UuidSchema,
  modules: z.array(ModuleNodeSchema),
});
export type CurriculumTree = z.infer<typeof CurriculumTreeSchema>;
