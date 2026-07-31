// Public program catalog DTOs — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// These DTOs define the ONLY fields a public (unauthenticated) visitor may see
// for programs. They are derived from the "Public-Projection Allowlist" in
// docs/specs/phase-5-website.md and are the authoritative source of truth for:
//   - Backend: CoursesService public read path (never SELECT forbidden columns).
//   - Frontend: program listing cards, program detail pages, SEO metadata.
//
// FORBIDDEN fields — enforced by compile-time type assertions at the bottom of
// this file. These must NEVER appear in PublicProgramSummary or PublicProgramDetail:
//   status, isPublic, ogImageKey / brochureKey (raw keys), emi (full JSON), tenantId,
//   deletedAt, updatedAt, createdAt, cost, margin, notes, any lesson content,
//   provider_asset_id (video), storage_key (resources), answer_key (assessments),
//   mentor userId/email/phone/branchId/internal rating, reviewer email/phone/studentId.
//
// Naming convention: matches @repo/types camelCase DTOs; maps to snake_case DB
// columns in Prisma / SQL via the backend projection layer.
//
// Money: price_paise is integer paise; clients display as ₹ (paise / 100).
// Rating: rating_avg is integer 0–50 representing 0.0–5.0 (×10 to avoid floats
//   per CLAUDE.md §3.6). Clients display as (rating_avg / 10).toFixed(1).
//
// og_image_url: CDN URL minted server-side from og_image_key; the raw key is
//   NEVER exposed. This is consistent with VideoProvider / StorageProvider
//   "never raw URLs to clients" (docs/05 §7).
//
// mentor_bios: public bio fields only — name, avatarUrl (CDN-minted, not storage_key),
//   expertise (display list), company, title. No PII, no internal IDs beyond the
//   faculty profile listing id (needed to build mentor anchor links on the detail page).
//
// reviews_summary: first name + college only. No email, phone, student_id, full name.
//
// curriculum_outline: module titles + lesson titles + is_preview flag ONLY.
//   Lesson content, video.provider_asset_id, resources.storage_key are forbidden.
//   The outline is a TREE (modules → lesson stubs); it is intentionally thin.

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Sub-schemas (reused in both Summary and Detail)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Public mentor bio — safe public fields only.
 * NEVER includes: userId, email, phone, branchId, internal rating, or
 * any other staff-profile internal field.
 */
export const PublicMentorBioSchema = z.object({
  /** Faculty profile listing ID — opaque; used for anchor links only. */
  id: UuidSchema,
  name: z.string().min(1).describe("Mentor's display name."),
  /** CDN URL minted server-side (NEVER the raw storage_key or provider_asset_id). */
  avatarUrl: z.string().url().nullable().describe("Public avatar CDN URL. Null if not set."),
  expertise: z.array(z.string()).describe("List of expertise tags shown on the mentor card."),
  company: z.string().nullable().describe("Current or previous company for credibility display."),
  title: z.string().nullable().describe("Job title or role label."),
});
export type PublicMentorBio = z.infer<typeof PublicMentorBioSchema>;

/**
 * One review excerpt in the reviews summary section.
 * NEVER includes: email, phone, student_id, user_id, full last name.
 */
export const PublicReviewExcerptSchema = z.object({
  /** Reviewer first name only — NEVER full name. */
  firstName: z.string().min(1),
  /** College name — safe for public display; no institution ID exposed. */
  college: z.string().nullable(),
  /** Star rating 1–5 (display value, integer). */
  rating: z.number().int().min(1).max(5),
  /** Short excerpt (the review text body). */
  excerpt: z.string().max(500),
});
export type PublicReviewExcerpt = z.infer<typeof PublicReviewExcerptSchema>;

/**
 * Aggregated reviews summary for the program detail page.
 * Returns count + avg + up to N most-helpful excerpts.
 */
export const PublicReviewsSummarySchema = z.object({
  /** Total review count contributing to the aggregate rating. */
  count: z.number().int().min(0),
  /**
   * Average rating 0–50 (×10 scale, no floats per CLAUDE.md §3.6).
   * Example: 47 = 4.7 stars. Display as (avg / 10).toFixed(1).
   */
  avgTimes10: z.number().int().min(0).max(50),
  /** Up to N most-helpful review excerpts. Safe: first name + college only. */
  excerpts: z.array(PublicReviewExcerptSchema),
});
export type PublicReviewsSummary = z.infer<typeof PublicReviewsSummarySchema>;

/**
 * Lesson stub in the curriculum outline.
 * NEVER includes: content field, video.provider_asset_id, resources.storage_key.
 * Only the outline data needed to render the curriculum accordion.
 */
export const PublicLessonStubSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1),
  type: z.enum(["video", "reading", "assignment", "quiz"]).describe("Lesson type for icon display."),
  order: z.number().int().min(0),
  /** Whether this lesson is free to preview without enrollment. */
  isPreview: z.boolean(),
});
export type PublicLessonStub = z.infer<typeof PublicLessonStubSchema>;

/**
 * Module node in the curriculum outline.
 * Carries lesson stubs (title + is_preview only, NO content/video/resources).
 */
export const PublicModuleOutlineSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1),
  order: z.number().int().min(0),
  lessons: z.array(PublicLessonStubSchema),
});
export type PublicModuleOutline = z.infer<typeof PublicModuleOutlineSchema>;

/**
 * GET /public/programs/:slug/lessons/:lessonId/preview-url → data field.
 *
 * ANONYMOUS "watch before you enrol" playback for the marketing site.
 *
 * The server resolves this ONLY when every gate passes: the program is
 * public + published, the lesson is flagged `is_preview` (the CRM "Free preview"
 * toggle), and its video is `ready`. Anything else is a 404 — a paid lesson can
 * never be reached through this endpoint, and non-existence is indistinguishable
 * from not-previewable (no existence disclosure).
 *
 * Same media-security contract as the enrolled student path: a SHORT-TTL signed
 * URL, never a raw storage key or provider asset id, never cacheable.
 */
export const PublicLessonPreviewUrlResponseSchema = z.object({
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  url: z.string().url().describe("Short-TTL signed playback URL. Do NOT cache — re-request on expiry."),
  expiresAt: z.string().describe("ISO-8601 expiry of `url`."),
});
export type PublicLessonPreviewUrlResponse = z.infer<typeof PublicLessonPreviewUrlResponseSchema>;

/**
 * Related program card — used in the "You may also like" section at the bottom
 * of the program detail page. Same forbidden-field rules apply as the list projection.
 */
export const PublicRelatedProgramSchema = z.object({
  id: UuidSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  cardSummary: z.string().nullable(),
  pricePaise: z.number().int().min(0).describe("Program price in integer paise."),
  compareAtPricePaise: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Struck-through 'was' price in paise. Null = single price."),
  /** Resolved badge — null unless configured AND enabled. Same contract as the summary. */
  badgeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  badgeLabel: z.string().nullable(),
});
export type PublicRelatedProgram = z.infer<typeof PublicRelatedProgramSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PublicProgramSummary — program list card DTO
// (P-1: GET /public/programs list items)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Marketing badge background colour (`#RRGGBB`) on public program cards. Deliberately
 * DUPLICATED from `crm/courses.schemas.ts` rather than imported: the public and CRM
 * contracts are separate surfaces with no cross-imports today, and a future change to the
 * CRM's accepted format should not silently reshape the public wire format.
 */
export const PublicProgramBadgeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Program list card DTO — one item in the public catalog listing.
 * ONLY the fields allowed by the "Program list projection" allowlist in
 * docs/specs/phase-5-website.md.
 *
 * FORBIDDEN (asserted at compile-time below): status, isPublic, ogImageKey,
 * emi (full JSON), tenantId, deletedAt, updatedAt, createdAt, cost, margin,
 * notes, any module/lesson/video/resource data, any PII.
 */
export const PublicProgramSummarySchema = z.object({
  id: UuidSchema.describe("Opaque program id. Needed to construct the enroll URL."),
  slug: z.string().min(1).describe("SEO URL key — /programs/:slug."),
  title: z.string().min(1),
  domain: z.string().min(1).describe("Program domain (filter facet)."),
  level: z.string().nullable().describe("Program level (filter facet). Null if not set."),
  mode: z.enum(["live", "recorded", "hybrid"]),
  durationWeeks: z.number().int().positive().nullable(),
  cardSummary: z.string().max(200).nullable().describe("Short marketing hook for list cards."),
  pricePaise: z.number().int().min(0).describe("Program price in integer paise."),
  /**
   * Struck-through "was" price. DISPLAY ONLY — the charged amount is always derived from
   * `pricePaise` server-side, never from this. Null when the program shows a single price.
   * Renderers must additionally require `compareAtPricePaise > pricePaise` before striking,
   * so a bad value degrades to "one price" instead of advertising a saving that isn't real.
   */
  compareAtPricePaise: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Struck-through 'was' price in paise. Null = single price."),
  /**
   * Human-readable EMI display string only, e.g. "₹1,500/month × 6".
   * NEVER the full emi JSON (may contain internal plan identifiers).
   */
  emiDisplay: z.string().nullable().describe("Human-readable EMI string. Null if no EMI option."),
  /**
   * Integer 0–50 representing 0.0–5.0 stars (×10 scale).
   * Null if no ratings yet. Display as (ratingAvg / 10).toFixed(1).
   */
  ratingAvg: z.number().int().min(0).max(50).nullable(),
  ratingCount: z.number().int().min(0).nullable(),
  /**
   * CDN URL minted server-side from programs.og_image_key.
   * NEVER the raw og_image_key (S3/R2 storage path).
   */
  ogImageUrl: z.string().url().nullable().describe("Public CDN URL for the OG/card image."),
  /** Marketing flag — render a "Scholarship available" badge on the card/detail hero. */
  scholarshipAvailable: z.boolean().describe("Show the 'Scholarship available' badge."),
  /**
   * Commerce flag — whether self-serve enrollment is open. False hides every "Enroll Now"
   * CTA and leaves "Book Free Slot" as the only path. Safe to expose publicly (it only
   * describes what the site already shows) and is NOT in `ForbiddenProgramField`; the
   * matching server-side guard lives in `CommerceService.createOrder`.
   */
  enrollmentEnabled: z.boolean().describe("Whether the 'Enroll Now' CTA / checkout is open."),
  /**
   * Marketing badge, already RESOLVED server-side: both fields are null unless staff have
   * a badge configured AND switched on. The `badgeEnabled` toggle itself is deliberately
   * never exposed — the public contract carries the display outcome, not the control, so a
   * configured-but-hidden badge cannot leak through the wire.
   */
  badgeColor: PublicProgramBadgeColorSchema.nullable().describe("Badge background hex, or null when no badge is visible."),
  badgeLabel: z.string().nullable().describe("Badge chip text, or null when no badge is visible."),
});
export type PublicProgramSummary = z.infer<typeof PublicProgramSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// PublicProgramDetail — program detail page DTO
// (P-2: GET /public/programs/:slug)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Program detail DTO — full public projection for the detail/conversion page.
 * Extends the summary with SEO fields, curriculum outline, mentor bios,
 * reviews summary, and outcomes. Does NOT include any forbidden fields.
 *
 * FORBIDDEN (asserted at compile-time below): status, isPublic, ogImageKey,
 * emi (full JSON), tenantId, deletedAt, updatedAt, createdAt, cost, margin,
 * notes, lesson content, video.provider_asset_id, resources.storage_key,
 * assessment_questions.answer_key, mentor userId/email/phone/branchId/rating
 * (internal), reviewer email/phone/student_id/user_id, any commerce data.
 */
export const PublicProgramDetailSchema = PublicProgramSummarySchema.extend({
  /** Per-page <title> override. Safe to expose on the detail page. */
  seoTitle: z.string().nullable(),
  /** Meta description override. Safe to expose on the detail page. */
  seoDescription: z.string().nullable(),
  /** JSON array of learning outcome strings (e.g. ["Build REST APIs"]). */
  outcomes: z.array(z.string()).nullable(),
  /**
   * Curriculum outline: module titles + lesson stubs (title + isPreview only).
   * NEVER includes lesson content, video provider_asset_id, or storage_key.
   */
  curriculumOutline: z.array(PublicModuleOutlineSchema),
  /** Public mentor bios (safe public fields only; no PII or internal IDs). */
  mentorBios: z.array(PublicMentorBioSchema),
  /** Aggregated reviews summary (first name + college only; no PII). */
  reviewsSummary: PublicReviewsSummarySchema,
  /** Related programs for the "You may also like" section. */
  relatedPrograms: z.array(PublicRelatedProgramSchema),
  /**
   * Public asset URL for the downloadable course brochure (PDF), minted server-side from
   * programs.brochure_key. NEVER the raw key. Null when staff haven't uploaded one — the
   * site then omits the "Download brochure" button rather than linking to a missing file.
   *
   * Detail-only (not on the summary): the listing cards don't offer a download, and keeping
   * it off the list projection avoids minting a URL per card for something nobody clicks.
   */
  brochureUrl: z.string().url().nullable().describe("Public URL of the course brochure PDF."),
});
export type PublicProgramDetail = z.infer<typeof PublicProgramDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ListPublicProgramsQuery — filter/sort/paginate the public catalog
// (P-1: GET /public/programs query params)
// ─────────────────────────────────────────────────────────────────────────

/**
 * `order` = the staff-curated sequence set in the CRM (programs.order ascending). It is
 * the DEFAULT because the alternatives are all worse defaults: "popularity" ranks by
 * `ratingCount`, which is null/0 for most of the catalog and therefore degenerates into an
 * unstable database tie-break, and "newest" inverts the order staff actually arranged.
 */
export const PublicProgramSortSchema = z.enum(["order", "popularity", "price_asc", "price_desc", "newest"]);
export type PublicProgramSort = z.infer<typeof PublicProgramSortSchema>;

/**
 * Query parameters for GET /public/programs.
 * Uses cursor pagination (PaginationMetaSchema from common/envelope.ts) as
 * docs/04 §2.14 specifies cursor pagination for public/high-volume lists.
 */
export const ListPublicProgramsQuerySchema = z
  .object({
    domain: z.string().min(1).optional().describe("Filter by program domain."),
    level: z.string().min(1).optional().describe("Filter by program level."),
    durationWeeks: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Filter by exact duration in weeks."),
    mode: z
      .enum(["live", "recorded", "hybrid"])
      .optional()
      .describe("Filter by delivery mode."),
    minPricePaise: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum price in paise (inclusive)."),
    maxPricePaise: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Maximum price in paise (inclusive)."),
    sort: PublicProgramSortSchema.optional().default("order"),
    /** Opaque cursor from the previous page's meta.nextCursor. */
    cursor: z.string().optional().describe("Cursor for the next page (from meta.nextCursor)."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(12)
      .describe("Items per page, max 50."),
  })
  .strict();
export type ListPublicProgramsQuery = z.infer<typeof ListPublicProgramsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time type assertions — projection + no-forbidden-field safety
//
// These assertions PROVE at TypeScript compile time that:
//   (a) PublicProgramSummary and PublicProgramDetail CANNOT carry the
//       forbidden fields listed in the PM spec. If any forbidden field is
//       accidentally added to the schema above, these assertions fail.
//   (b) The type system enforces the projection contract without runtime overhead.
//
// Pattern: `type AssertNotPresent<T, K extends string> = K extends keyof T ? never : true`
// A `never` result from `AssertNotPresent` would make the assignment below fail,
// which is the desired compile-time error.
// ─────────────────────────────────────────────────────────────────────────

/** Union of all forbidden field keys across both public program DTOs. */
type ForbiddenProgramField =
  | "status"
  | "isPublic"
  | "ogImageKey"
  | "brochureKey"
  | "emi"
  | "tenantId"
  | "deletedAt"
  | "updatedAt"
  | "createdAt"
  | "cost"
  | "margin"
  | "notes"
  // The badge VISIBILITY toggle. `badgeColor`/`badgeLabel` are public (they are the
  // rendered outcome), but the control that decides whether staff are showing a badge is
  // internal — listing it here makes "the public DTO carries the outcome, never the
  // switch" a compile-time guarantee rather than a convention the mapper must remember.
  | "badgeEnabled";

/** Asserts that T does NOT have any key in ForbiddenKeys. Fails to compile if it does. */
type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED" : "ok",
] extends ["ok"]
  ? true
  : never;

// These must evaluate to `true`. A `never` result = compile error = security bug caught.
type _AssertSummaryProjection = AssertNoForbiddenFields<
  PublicProgramSummary,
  ForbiddenProgramField
>;
type _AssertDetailProjection = AssertNoForbiddenFields<
  PublicProgramDetail,
  ForbiddenProgramField
>;
type _AssertMentorBioProjection = AssertNoForbiddenFields<
  PublicMentorBio,
  "userId" | "email" | "phone" | "branchId"
>;
type _AssertReviewProjection = AssertNoForbiddenFields<
  PublicReviewExcerpt,
  "email" | "phone" | "studentId" | "userId"
>;
type _AssertLessonStubProjection = AssertNoForbiddenFields<
  PublicLessonStub,
  "content" | "providerAssetId" | "storageKey"
>;

// Force TypeScript to evaluate the assertions (they are referenced, not just declared).
const _assertSummary: _AssertSummaryProjection = true;
const _assertDetail: _AssertDetailProjection = true;
const _assertMentor: _AssertMentorBioProjection = true;
const _assertReview: _AssertReviewProjection = true;
const _assertLesson: _AssertLessonStubProjection = true;

// Prevent "declared but never used" lint errors by exporting the assertion markers.
export type {
  _AssertSummaryProjection,
  _AssertDetailProjection,
  _AssertMentorBioProjection,
  _AssertReviewProjection,
  _AssertLessonStubProjection,
};
// The `_assert*` consts above are `_`-prefixed, so the unused-vars rule exempts them;
// their typed `= true` assignment is what forces TypeScript to evaluate the projection
// assertions at compile time (a `never` result → compile error). No runtime `void` needed.
