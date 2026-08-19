// Phase-10 page-builder block registry — the closed, strict-union counterpart to the
// generic `{type, data}` `ContentBlockSchema` envelope (content/pages.schemas.ts).
//
// Authoritative spec: docs/specs/phase-10-page-builder.md "Block registry" section.
// This is THE shared source of truth: the CRM builder editor forms, the API body
// validation (on save/preview/revert), and the `web` block-registry renderer all import
// straight from here — never a re-derived/duplicated field list per consumer
// (CLAUDE.md §3.2).
//
// Wire-format compatibility: every block is still stored/transmitted as the same
// `{ type: string, data: Record<string, unknown> }` shape `ContentBlock` already uses —
// this file does not change that envelope, it tightens `data`'s validation into a CLOSED
// per-`type` shape via `z.discriminatedUnion("type", ...)`. `ContentPage.isBuilderManaged`
// decides which validation applies server-side: `false` -> `ContentBlockSchema[]` (generic,
// unchanged, backward compatible with every pre-Phase-10 ContentPage row); `true` ->
// `PageBuilderBlockSchema[]` (this file). An unrecognized `type` FAILS LOUDLY here (zod's
// discriminated union throws `invalid_union_discriminator` for any `type` not in the
// closed set below) — this is deliberate: builder saves must reject unknown block types,
// only the PUBLIC renderer is asked to soft-skip an unknown type post-hoc (Edge case #9,
// for a page reverted to a version predating a since-removed block type; that soft-skip is
// a `web`/`frontend-builder` rendering concern, not a validation-layer concern here).
//
// `live_collection_ref` (block #10) is the one block type with a SERVER-SIDE-RESOLVED
// variant: `ResolvedPageBuilderBlockSchema` swaps its `data` for
// `ResolvedLiveCollectionRefBlockDataSchema`, which carries the live-fetched, already
// published-filtered `resolvedItems` alongside the original selection criteria. CRM
// authoring/version endpoints use the plain (unresolved) union; the PUBLIC page-read
// endpoint and the CRM preview endpoint use the resolved union (see content/pages.schemas.ts
// `PublicContentPageSchema` / `PreviewBuilderPageBlocksResponseSchema`).

import { z } from "zod";
import { PublicJobOpeningSchema } from "./job-openings.schemas.js";
import { UuidSchema, ObjectKeySchema, HrefSchema } from "../common/primitives.js";
import { PublicTestimonialSchema } from "./testimonials.schemas.js";
import { PublicPartnerSchema } from "./partners.schemas.js";
import { PublicProgramSummarySchema } from "../public/programs.schemas.js";
import { PublicMentorCardSchema } from "../public/mentors.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Shared field-level primitives (spec "Shared conventions")
// ─────────────────────────────────────────────────────────────────────────

/**
 * Closed icon-key enum (spec "Shared conventions" seed set). No block ever accepts raw
 * SVG/HTML for an icon — deliberate XSS-surface control (spec "Out of scope": no generic
 * rich-text block). `design-system` owns extending this enum; adding a key is additive
 * (new literal), never a breaking rename, so existing block data never invalidates.
 */
export const IconKeySchema = z.enum([
  "mentor",
  "pricing",
  "trophy",
  "star",
  "graduation-cap",
  "stack",
  "map-pin",
  "lms",
  "project",
  "certificate",
  "placement",
  "check",
  "user",
  "video",
  "pin",
]);
export type IconKey = z.infer<typeof IconKeySchema>;

/** `{ label, href, style }` — reused by `hero.ctas`, `cta_band.buttons`. */
export const CtaSchema = z
  .object({
    label: z.string().min(1).max(40),
    href: HrefSchema,
    style: z.enum(["primary", "secondary"]),
  })
  .strict();
export type Cta = z.infer<typeof CtaSchema>;

/**
 * `title`/`heading`-with-eyebrow sub-shape, reused by `stat_group`, `feature_grid`,
 * `numbered_steps`. Carries the optional `*Highlight` substring-of-title sibling (spec
 * "Shared conventions" — the renderer wraps this literal substring in the brand accent
 * span). Bounds (title 120 / subtitle 200) mirror the equivalent bound already used for
 * `hero.headline`/`.subheadline`-style fields elsewhere in this registry.
 */
export const HeadingWithEyebrowSchema = z
  .object({
    eyebrow: z.string().max(80).optional(),
    title: z.string().min(1).max(120),
    titleHighlight: z.string().min(1).optional(),
    subtitle: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.titleHighlight && !val.title.includes(val.titleHighlight)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["titleHighlight"], message: "titleHighlight must be a substring of title" });
    }
  });
export type HeadingWithEyebrow = z.infer<typeof HeadingWithEyebrowSchema>;

/** `{title, titleHighlight?, subtitle?}` (no eyebrow) — `faq.heading`, `live_collection_ref.heading`. */
export const HeadingSimpleSchema = z
  .object({
    title: z.string().min(1).max(120),
    titleHighlight: z.string().min(1).optional(),
    subtitle: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.titleHighlight && !val.title.includes(val.titleHighlight)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["titleHighlight"], message: "titleHighlight must be a substring of title" });
    }
  });
export type HeadingSimple = z.infer<typeof HeadingSimpleSchema>;

/** `{title, subtitle?}` — `media_gallery.heading`, `job_openings.heading`. */
export const HeadingMinimalSchema = z
  .object({
    title: z.string().min(1).max(120),
    subtitle: z.string().max(200).optional(),
  })
  .strict();
export type HeadingMinimal = z.infer<typeof HeadingMinimalSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 1. `hero`
// ─────────────────────────────────────────────────────────────────────────

export const HeroVariantSchema = z.enum(["centered", "centered-with-flanking-photos", "split-with-cards"]);
export type HeroVariant = z.infer<typeof HeroVariantSchema>;

export const HeroTrustBadgeSchema = z
  .object({
    ratingStars: z.number().int().min(1).max(5),
    caption: z.string().min(1).max(100),
  })
  .strict();

export const HeroFlankingPhotoSchema = z
  .object({
    imageKey: ObjectKeySchema,
    statValue: z.string().min(1).max(20),
    statLabel: z.string().min(1).max(40),
    statIconKey: IconKeySchema,
  })
  .strict();

export const HeroInfoCardSchema = z
  .object({
    bodyText: z.string().min(1).max(400),
    emphasis: z.boolean().default(false),
  })
  .strict();

const HeroBlockDataBaseSchema = z
  .object({
    variant: HeroVariantSchema.default("centered"),
    eyebrow: z.string().max(80).optional(),
    headline: z.string().min(1).max(160),
    headlineHighlight: z.string().min(1).optional(),
    subheadline: z.string().max(400).optional(),
    backgroundImageKey: ObjectKeySchema.optional(),
    trustBadge: HeroTrustBadgeSchema.optional(),
    /** Only rendered when `variant=centered-with-flanking-photos`. */
    flankingPhotos: z.array(HeroFlankingPhotoSchema).max(2).default([]),
    /** Only rendered when `variant=split-with-cards`. */
    watermarkText: z.string().max(40).optional(),
    /** Required when `variant=split-with-cards` (enforced below). */
    centerImageKey: ObjectKeySchema.optional(),
    /** Only rendered when `variant=split-with-cards`. */
    infoCards: z.array(HeroInfoCardSchema).max(2).default([]),
    ctas: z.array(CtaSchema).max(2).default([]),
  })
  .strict();

export const HeroBlockDataSchema = HeroBlockDataBaseSchema.superRefine((val, ctx) => {
  if (val.headlineHighlight && !val.headline.includes(val.headlineHighlight)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["headlineHighlight"], message: "headlineHighlight must be a substring of headline" });
  }
  if (val.variant === "split-with-cards" && !val.centerImageKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["centerImageKey"], message: "centerImageKey is required when variant is split-with-cards" });
  }
});
export type HeroBlockData = z.infer<typeof HeroBlockDataSchema>;

export const HeroBlockSchema = z.object({ type: z.literal("hero"), data: HeroBlockDataSchema }).strict();
export type HeroBlock = z.infer<typeof HeroBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 2. `content_split`
// ─────────────────────────────────────────────────────────────────────────

const ContentSplitBlockDataBaseSchema = z
  .object({
    eyebrow: z.string().max(80).optional(),
    heading: z.string().min(1).max(120),
    headingHighlight: z.string().min(1).optional(),
    body: z.array(z.string().min(1).max(600)).min(1).max(6),
    mediaImageKey: ObjectKeySchema,
    /**
     * Text alternative for `mediaImageKey`. Optional because the block's media is
     * DECORATIVE by default (the adjacent heading + body already carry the meaning, so the
     * renderer emits `alt="" aria-hidden`). Set it when the image is NOT decorative —
     * notably an image-of-text poster, where WCAG 2.2 SC 1.1.1 requires the words baked
     * into the artwork to be available as text.
     */
    mediaAlt: z.string().max(1000).optional(),
    mediaPosition: z.enum(["left", "right"]).default("right"),
    badge: z
      .object({
        iconKey: IconKeySchema,
        title: z.string().min(1).max(40),
        subtitle: z.string().min(1).max(60),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ContentSplitBlockDataSchema = ContentSplitBlockDataBaseSchema.superRefine((val, ctx) => {
  if (val.headingHighlight && !val.heading.includes(val.headingHighlight)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["headingHighlight"], message: "headingHighlight must be a substring of heading" });
  }
});
export type ContentSplitBlockData = z.infer<typeof ContentSplitBlockDataSchema>;

export const ContentSplitBlockSchema = z.object({ type: z.literal("content_split"), data: ContentSplitBlockDataSchema }).strict();
export type ContentSplitBlock = z.infer<typeof ContentSplitBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 3. `stat_group`
// ─────────────────────────────────────────────────────────────────────────

export const StatGroupVariantSchema = z.enum(["bento", "band", "bars"]);
export type StatGroupVariant = z.infer<typeof StatGroupVariantSchema>;

/**
 * `value` is a STRING, not a number (spec #3) — audited data includes non-numeric
 * formats ("Up to ₹1 Crore", "90%+", "15,000+"); `description`/`iconKey` render only in
 * the `bento` variant, but are accepted (and ignored) in the others for form simplicity.
 */
export const StatItemSchema = z
  .object({
    label: z.string().min(1).max(60),
    value: z.string().min(1).max(24),
    description: z.string().max(160).optional(),
    iconKey: IconKeySchema.optional(),
  })
  .strict();

const StatGroupBlockDataBaseSchema = z
  .object({
    variant: StatGroupVariantSchema,
    /** Omitted on inline bands (About stats, Scholarship overlap band). */
    heading: HeadingWithEyebrowSchema.optional(),
    /** Base bound is the loosest across variants; tightened per-variant below. */
    items: z.array(StatItemSchema).min(2).max(8),
  })
  .strict();

export const StatGroupBlockDataSchema = StatGroupBlockDataBaseSchema.superRefine((val, ctx) => {
  const count = val.items.length;
  if (val.variant === "bento" && count !== 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "exactly 3 items are required when variant is bento" });
  }
  if (val.variant === "band" && (count < 2 || count > 6)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "2-6 items are required when variant is band" });
  }
  if (val.variant === "bars" && (count < 2 || count > 8)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "2-8 items are required when variant is bars" });
  }
});
export type StatGroupBlockData = z.infer<typeof StatGroupBlockDataSchema>;

export const StatGroupBlockSchema = z.object({ type: z.literal("stat_group"), data: StatGroupBlockDataSchema }).strict();
export type StatGroupBlock = z.infer<typeof StatGroupBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 4. `feature_grid`
// ─────────────────────────────────────────────────────────────────────────

export const FeatureGridVariantSchema = z.enum(["cards", "split-media", "strip"]);
export type FeatureGridVariant = z.infer<typeof FeatureGridVariantSchema>;

/** Rendering default is variant-dependent (2/split-media, 3/cards, 4/strip) — applied by
 *  the renderer/CRM form when `columns` is absent; not baked into this schema's `.default()`
 *  since zod defaults can't be conditional on a sibling field. */
export const FeatureGridColumnsSchema = z.enum(["2", "3", "4"]);

export const FeatureGridItemSchema = z
  .object({
    iconKey: IconKeySchema.optional(),
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(220),
  })
  .strict();

const FeatureGridBlockDataBaseSchema = z
  .object({
    variant: FeatureGridVariantSchema,
    heading: HeadingWithEyebrowSchema.optional(),
    columns: FeatureGridColumnsSchema.optional(),
    /** Required when `variant=split-media` (enforced below). */
    centerImageKey: ObjectKeySchema.optional(),
    items: z.array(FeatureGridItemSchema).min(1).max(12),
  })
  .strict();

export const FeatureGridBlockDataSchema = FeatureGridBlockDataBaseSchema.superRefine((val, ctx) => {
  if (val.variant === "split-media") {
    if (!val.centerImageKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["centerImageKey"], message: "centerImageKey is required when variant is split-media" });
    }
    if (val.items.length !== 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "exactly 4 items are required when variant is split-media" });
    }
  }
});
export type FeatureGridBlockData = z.infer<typeof FeatureGridBlockDataSchema>;

export const FeatureGridBlockSchema = z.object({ type: z.literal("feature_grid"), data: FeatureGridBlockDataSchema }).strict();
export type FeatureGridBlock = z.infer<typeof FeatureGridBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 5. `numbered_steps`
// ─────────────────────────────────────────────────────────────────────────

export const NumberedStepsVariantSchema = z.enum(["arrows", "timeline", "compact"]);
export type NumberedStepsVariant = z.infer<typeof NumberedStepsVariantSchema>;

export const NumberedStepItemSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(260),
  })
  .strict();

export const NumberedStepsBlockDataSchema = z
  .object({
    heading: HeadingWithEyebrowSchema.optional(),
    variant: NumberedStepsVariantSchema,
    items: z.array(NumberedStepItemSchema).min(2).max(8),
  })
  .strict();
export type NumberedStepsBlockData = z.infer<typeof NumberedStepsBlockDataSchema>;

export const NumberedStepsBlockSchema = z.object({ type: z.literal("numbered_steps"), data: NumberedStepsBlockDataSchema }).strict();
export type NumberedStepsBlock = z.infer<typeof NumberedStepsBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 6. `faq`
// ─────────────────────────────────────────────────────────────────────────

/** Plain text — matches today's FAQ_ITEMS (no HTML), per spec #6. */
export const FaqItemSchema = z
  .object({
    question: z.string().min(1).max(200),
    answer: z.string().min(1).max(1000),
  })
  .strict();

export const FaqBlockDataSchema = z
  .object({
    heading: HeadingSimpleSchema.optional(),
    items: z.array(FaqItemSchema).min(1).max(20),
    viewAllHref: HrefSchema.optional(),
  })
  .strict();
export type FaqBlockData = z.infer<typeof FaqBlockDataSchema>;

export const FaqBlockSchema = z.object({ type: z.literal("faq"), data: FaqBlockDataSchema }).strict();
export type FaqBlock = z.infer<typeof FaqBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 7. `cta_band`
// ─────────────────────────────────────────────────────────────────────────

/** Named distinctly from `growth/lead-forms.schemas.ts`'s `LeadFormFieldSchema` (a
 *  different, richer concept — full lead-form field configs) to avoid a barrel collision. */
export const CtaBandLeadFormFieldSchema = z.enum(["name", "phone", "email"]);
export type CtaBandLeadFormField = z.infer<typeof CtaBandLeadFormFieldSchema>;

export const CtaBandLeadFormSchema = z
  .object({
    source: z.string().min(1).max(80),
    heading: z.string().min(1).max(100),
    subheading: z.string().min(1).max(200),
    fields: z.array(CtaBandLeadFormFieldSchema).min(1),
    submitLabel: z.string().min(1).max(40),
  })
  .strict();

const CtaBandBlockDataBaseSchema = z
  .object({
    heading: z.string().min(1).max(160),
    headingHighlight: z.string().min(1).optional(),
    subheading: z.string().max(300).optional(),
    background: z.enum(["brand", "surface", "default"]).default("default"),
    buttons: z.array(CtaSchema).max(3).default([]),
    leadForm: CtaBandLeadFormSchema.optional(),
  })
  .strict();

export const CtaBandBlockDataSchema = CtaBandBlockDataBaseSchema.superRefine((val, ctx) => {
  if (val.headingHighlight && !val.heading.includes(val.headingHighlight)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["headingHighlight"], message: "headingHighlight must be a substring of heading" });
  }
});
export type CtaBandBlockData = z.infer<typeof CtaBandBlockDataSchema>;

export const CtaBandBlockSchema = z.object({ type: z.literal("cta_band"), data: CtaBandBlockDataSchema }).strict();
export type CtaBandBlock = z.infer<typeof CtaBandBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 8. `media_gallery`
// ─────────────────────────────────────────────────────────────────────────

export const MediaGalleryItemSchema = z
  .object({
    imageKey: ObjectKeySchema,
    /** Required, non-empty — a11y (CLAUDE.md §3.9). */
    alt: z.string().min(1).max(200),
    caption: z.string().max(160).optional(),
  })
  .strict();

export const MediaGalleryBlockDataSchema = z
  .object({
    heading: HeadingMinimalSchema.optional(),
    columns: z.enum(["2", "3"]).default("3"),
    items: z.array(MediaGalleryItemSchema).min(1).max(60),
  })
  .strict();
export type MediaGalleryBlockData = z.infer<typeof MediaGalleryBlockDataSchema>;

export const MediaGalleryBlockSchema = z.object({ type: z.literal("media_gallery"), data: MediaGalleryBlockDataSchema }).strict();
export type MediaGalleryBlock = z.infer<typeof MediaGalleryBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 9. `job_openings`
// ─────────────────────────────────────────────────────────────────────────

/**
 * LEGACY. Roles used to be typed straight into this block, one `items` entry per opening.
 * They are now CRM-managed rows (`model JobOpening`, CRM ▸ Careers ▸ Openings) resolved
 * live at read time — see ADR-0066 and `ResolvedJobOpeningsBlockDataSchema` below.
 *
 * The shape is retained ONLY so pages and `ContentPageVersion` snapshots stored before that
 * change still parse: the block union is `.strict()`, and a stored body carrying `items`
 * would otherwise fail its safe-parse and take the whole Open Roles section off the careers
 * page (Edge case #9). Nothing reads it. No editor writes it — the CRM builder form for this
 * block offers no item fields at all, so this is not a "save does nothing" trap: there is no
 * control that appears to fill it.
 */
export const JobOpeningItemSchema = z
  .object({
    title: z.string().min(1).max(100),
    employmentType: z.string().min(1).max(30),
    location: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
  })
  .strict();

export const JobOpeningsBlockDataSchema = z
  .object({
    heading: HeadingMinimalSchema.optional(),
    /** @deprecated Legacy tolerance only — see JobOpeningItemSchema. Never rendered. */
    items: z.array(JobOpeningItemSchema).max(30).optional(),
    emptyStateMessage: z.string().min(1).max(200).default("No open roles right now"),
  })
  .strict();
export type JobOpeningsBlockData = z.infer<typeof JobOpeningsBlockDataSchema>;

export const JobOpeningsBlockSchema = z.object({ type: z.literal("job_openings"), data: JobOpeningsBlockDataSchema }).strict();
export type JobOpeningsBlock = z.infer<typeof JobOpeningsBlockSchema>;

/**
 * The RESOLVED form — what the public read path and the CRM preview path return. The
 * heading and empty-state copy stay editorial (page-builder fields); the roles themselves
 * come from the live `job_openings` table, filtered to genuinely-live rows, exactly the way
 * `live_collection_ref` resolves partners and mentors. Never stored.
 *
 * This block is a SECOND reference block, deliberately kept separate from
 * `live_collection_ref` rather than folded in as a fifth collection: that block's four
 * collections are all interchangeable showcase grids sharing one `layout`/`selection`
 * shape, whereas open roles have their own card, their own apply affordance and no layout
 * choice to make.
 */
export const ResolvedJobOpeningsBlockDataSchema = JobOpeningsBlockDataSchema.extend({
  resolvedItems: z.array(PublicJobOpeningSchema),
});
export type ResolvedJobOpeningsBlockData = z.infer<typeof ResolvedJobOpeningsBlockDataSchema>;

export const ResolvedJobOpeningsBlockSchema = z
  .object({ type: z.literal("job_openings"), data: ResolvedJobOpeningsBlockDataSchema })
  .strict();
export type ResolvedJobOpeningsBlock = z.infer<typeof ResolvedJobOpeningsBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 10. `live_collection_ref` — the reference block
// ─────────────────────────────────────────────────────────────────────────
//
// NEVER copies data into the page. `selection` is authoring-time criteria only; resolution
// (fetching the live rows, honoring each source's own `status='published'` filter) happens
// server-side, at render time, on the PUBLIC read path and the CRM preview path — never on
// save. The plain (unresolved) schemas below are what CRM save/version endpoints validate
// and store; the `Resolved*` schemas further down are what the public/preview READ paths
// return (never stored).

export const LiveCollectionLayoutSchema = z.enum(["grid-3", "grid-4", "logo-wall"]);
export type LiveCollectionLayout = z.infer<typeof LiveCollectionLayoutSchema>;

// NOTE (Phase-11 locked templates, api-designer P1): the four per-collection
// `Selection*`/`*DataSchema` consts below are exported (were previously un-exported,
// module-private) so `content/page-templates.schemas.ts` can pin each `live_collection_ref`
// TEMPLATE SECTION to its own specific collection (e.g. the home page's "Partner Colleges"
// section only ever validates `collection: "partners"` data, never lets staff repoint it at
// "mentors"/"programs"/"testimonials"). Purely additive — no shape change, no behavior
// change to the existing discriminated-union validation below.
export const LiveCollectionSelectionTestimonialsSchema = z
  .object({
    mode: z.enum(["manual", "filter"]).default("filter"),
    /** Required (min 1) when `mode=manual` — enforced below. */
    ids: z.array(UuidSchema).max(12).optional(),
    programId: UuidSchema.optional(),
    minRating: z.number().int().min(0).max(50).optional(),
    limit: z.number().int().min(1).max(12).default(3),
    sort: z.enum(["order", "newest"]).default("order"),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.mode === "manual" && (!val.ids || val.ids.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ids"], message: "ids (min 1) is required when mode is manual" });
    }
  });

export const LiveCollectionSelectionPartnersSchema = z
  .object({
    category: z.string().min(1).max(80).optional(),
    // max 60, raised from 24: the partner-college list is a full institutional roster
    // (27 rows today and growing), not a curated teaser like programs or mentors, and
    // /for-colleges is expected to show all of it. The cap exists to stop a runaway
    // resolver query, not to curate — 60 keeps that guardrail with room to grow.
    limit: z.number().int().min(1).max(60).default(12),
    sort: z.enum(["order", "newest"]).default("order"),
  })
  .strict();

export const LiveCollectionSelectionProgramsSchema = z
  .object({
    categorySlug: z.string().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(12).default(8),
    sort: z.enum(["popularity", "newest"]).default("popularity"),
  })
  .strict();

export const LiveCollectionSelectionMentorsSchema = z
  .object({
    limit: z.number().int().min(1).max(8).default(8),
  })
  .strict();

export const LiveCollectionRefTestimonialsDataSchema = z
  .object({
    collection: z.literal("testimonials"),
    heading: HeadingSimpleSchema.optional(),
    viewAllHref: HrefSchema.optional(),
    layout: LiveCollectionLayoutSchema,
    selection: LiveCollectionSelectionTestimonialsSchema,
  })
  .strict();

export const LiveCollectionRefPartnersDataSchema = z
  .object({
    collection: z.literal("partners"),
    heading: HeadingSimpleSchema.optional(),
    viewAllHref: HrefSchema.optional(),
    layout: LiveCollectionLayoutSchema,
    selection: LiveCollectionSelectionPartnersSchema,
  })
  .strict();

export const LiveCollectionRefProgramsDataSchema = z
  .object({
    collection: z.literal("programs"),
    heading: HeadingSimpleSchema.optional(),
    viewAllHref: HrefSchema.optional(),
    layout: LiveCollectionLayoutSchema,
    selection: LiveCollectionSelectionProgramsSchema,
  })
  .strict();

export const LiveCollectionRefMentorsDataSchema = z
  .object({
    collection: z.literal("mentors"),
    heading: HeadingSimpleSchema.optional(),
    viewAllHref: HrefSchema.optional(),
    layout: LiveCollectionLayoutSchema,
    selection: LiveCollectionSelectionMentorsSchema,
  })
  .strict();

export const LiveCollectionRefBlockDataSchema = z.discriminatedUnion("collection", [
  LiveCollectionRefTestimonialsDataSchema,
  LiveCollectionRefPartnersDataSchema,
  LiveCollectionRefProgramsDataSchema,
  LiveCollectionRefMentorsDataSchema,
]);
export type LiveCollectionRefBlockData = z.infer<typeof LiveCollectionRefBlockDataSchema>;

export const LiveCollectionRefBlockSchema = z
  .object({ type: z.literal("live_collection_ref"), data: LiveCollectionRefBlockDataSchema })
  .strict();
export type LiveCollectionRefBlock = z.infer<typeof LiveCollectionRefBlockSchema>;

// ── Resolved variant (public/preview READ paths only — never stored) ──────────────────

/** Reused as-is: `GET /public/testimonials`'s own DTO is already the safe public projection. */
export const ResolvedTestimonialItemSchema = PublicTestimonialSchema;
export type ResolvedTestimonialItem = z.infer<typeof ResolvedTestimonialItemSchema>;

/**
 * Extends `PublicPartnerSchema` with `focus`/`established`/`city` (additive Partner-model
 * fields added this phase specifically to back this block — Edge case #11). Kept as a
 * distinct schema (not a change to `PublicPartnerSchema`/`GET /public/partners`) since that
 * endpoint's contract is out of this phase's requested scope; `backend-builder`/
 * `frontend-builder` may later decide to fold these fields into the general public-partners
 * projection too, but that is not this endpoint's contract to force.
 */
export const ResolvedPartnerItemSchema = PublicPartnerSchema.extend({
  focus: z.string().nullable(),
  established: z.number().int().nullable(),
  city: z.string().nullable(),
});
export type ResolvedPartnerItem = z.infer<typeof ResolvedPartnerItemSchema>;

/** Reused as-is: same source `ExploreCourses` already calls (`GET /public/programs`). */
export const ResolvedProgramItemSchema = PublicProgramSummarySchema;
export type ResolvedProgramItem = z.infer<typeof ResolvedProgramItemSchema>;

/** Reused as-is: same source `MentorsTeaser` already calls (`GET /public/mentors`). */
export const ResolvedMentorItemSchema = PublicMentorCardSchema;
export type ResolvedMentorItem = z.infer<typeof ResolvedMentorItemSchema>;

const ResolvedLiveCollectionRefTestimonialsDataSchema = LiveCollectionRefTestimonialsDataSchema.extend({
  resolvedItems: z.array(ResolvedTestimonialItemSchema),
});
const ResolvedLiveCollectionRefPartnersDataSchema = LiveCollectionRefPartnersDataSchema.extend({
  resolvedItems: z.array(ResolvedPartnerItemSchema),
});
const ResolvedLiveCollectionRefProgramsDataSchema = LiveCollectionRefProgramsDataSchema.extend({
  resolvedItems: z.array(ResolvedProgramItemSchema),
});
const ResolvedLiveCollectionRefMentorsDataSchema = LiveCollectionRefMentorsDataSchema.extend({
  resolvedItems: z.array(ResolvedMentorItemSchema),
});

/**
 * `resolvedItems` reflects Edge cases #2/#3: a missing/unpublished referenced record is
 * silently dropped (never a broken card); if resolution drops to 0 items the RENDERER
 * (not this schema) hides the whole block including its heading — an empty
 * `resolvedItems` array is still valid here, the "hide when empty" rule is a `web`
 * rendering concern, not a validation-layer concern.
 */
export const ResolvedLiveCollectionRefBlockDataSchema = z.discriminatedUnion("collection", [
  ResolvedLiveCollectionRefTestimonialsDataSchema,
  ResolvedLiveCollectionRefPartnersDataSchema,
  ResolvedLiveCollectionRefProgramsDataSchema,
  ResolvedLiveCollectionRefMentorsDataSchema,
]);
export type ResolvedLiveCollectionRefBlockData = z.infer<typeof ResolvedLiveCollectionRefBlockDataSchema>;

export const ResolvedLiveCollectionRefBlockSchema = z
  .object({ type: z.literal("live_collection_ref"), data: ResolvedLiveCollectionRefBlockDataSchema })
  .strict();
export type ResolvedLiveCollectionRefBlock = z.infer<typeof ResolvedLiveCollectionRefBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// 11. `brain_showcase`
// ─────────────────────────────────────────────────────────────────────────

/** No fields — zero-config positional placeholder (spec #11). Still addable/removable/
 *  reorderable like any block; its rendered content never changes. */
export const BrainShowcaseBlockDataSchema = z.object({}).strict();
export type BrainShowcaseBlockData = z.infer<typeof BrainShowcaseBlockDataSchema>;

export const BrainShowcaseBlockSchema = z.object({ type: z.literal("brain_showcase"), data: BrainShowcaseBlockDataSchema }).strict();
export type BrainShowcaseBlock = z.infer<typeof BrainShowcaseBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────
// The registry — discriminated union over all 11 block types
// ─────────────────────────────────────────────────────────────────────────

export const PageBuilderBlockTypeSchema = z.enum([
  "hero",
  "content_split",
  "stat_group",
  "feature_grid",
  "numbered_steps",
  "faq",
  "cta_band",
  "media_gallery",
  "job_openings",
  "live_collection_ref",
  "brain_showcase",
]);
export type PageBuilderBlockType = z.infer<typeof PageBuilderBlockTypeSchema>;

/**
 * The strict block union (unresolved) — validates a `ContentPage.body` array whenever
 * `isBuilderManaged=true`. Any `type` outside the 11 literals above throws a zod
 * `invalid_union_discriminator` error (fails loudly, per requirement).
 */
export const PageBuilderBlockSchema = z.discriminatedUnion("type", [
  HeroBlockSchema,
  ContentSplitBlockSchema,
  StatGroupBlockSchema,
  FeatureGridBlockSchema,
  NumberedStepsBlockSchema,
  FaqBlockSchema,
  CtaBandBlockSchema,
  MediaGalleryBlockSchema,
  JobOpeningsBlockSchema,
  LiveCollectionRefBlockSchema,
  BrainShowcaseBlockSchema,
]);
export type PageBuilderBlock = z.infer<typeof PageBuilderBlockSchema>;

/**
 * The resolved block union — identical to `PageBuilderBlockSchema` except block #10
 * (`live_collection_ref`) carries server-resolved `resolvedItems`. Used ONLY on read paths
 * that perform resolution: `GET /public/pages/:slug` and `POST /crm/content-pages/:id/preview`.
 */
export const ResolvedPageBuilderBlockSchema = z.discriminatedUnion("type", [
  HeroBlockSchema,
  ContentSplitBlockSchema,
  StatGroupBlockSchema,
  FeatureGridBlockSchema,
  NumberedStepsBlockSchema,
  FaqBlockSchema,
  CtaBandBlockSchema,
  MediaGalleryBlockSchema,
  ResolvedJobOpeningsBlockSchema,
  ResolvedLiveCollectionRefBlockSchema,
  BrainShowcaseBlockSchema,
]);
export type ResolvedPageBuilderBlock = z.infer<typeof ResolvedPageBuilderBlockSchema>;
