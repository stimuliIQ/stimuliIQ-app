// Phase-11 locked page templates — api-designer P1 contracts
// (docs/plans/phase-11-locked-templates.md). Supersedes the free block-picker UX from
// Phase-10 (docs/specs/phase-10-page-builder.md) for the 6 core marketing pages: every
// core page is now a FIXED, ORDERED set of sections. Staff edit field VALUES only — they
// can never add/remove/reorder a section or change its type. This is an authoring-layer
// lock only: storage (`ContentPage.body` JSON), the web block-registry renderer,
// versioning/undo, server-side preview, and live-collection resolution are all UNCHANGED
// (docs/plans/phase-11-locked-templates.md "Reuse the P10 engine internally"). The wire
// shape of a page's `body` stays the exact same `{ type, data }[]` array
// (`page-builder-blocks.schemas.ts`'s `PageBuilderBlockSchema`/`ContentBlockSchema`) — this
// file adds a SECOND, ADDITIONAL layer of validation on top of that per-block shape
// validation: "is this array the RIGHT sections, in the RIGHT order, for this page".
//
// IMPORTANT LIMITATION (documented, not a bug): the stored wire shape carries no
// per-section `key` — only `{type, data}`. `validatePageBodyAgainstTemplate` below can
// therefore only detect a reorder when it changes the `type` found at a given array index
// (which is true for every section list below EXCEPT the few pages that pin the same
// `blockType` at more than one position — e.g. scholarship's three `stat_group` sections,
// about's two `feature_grid`/`cta_band` sections). A same-type swap between two of a
// page's own pinned slots is indistinguishable from independently editing both slots' data
// and is NOT flagged as an error. This is an accepted trade-off of keeping the wire shape
// unchanged (per the plan's explicit "storage ... unchanged" decision) rather than adding a
// `key` to every stored block, which would be a breaking storage-format change out of this
// task's additive scope.
//
// This file is the SINGLE source of truth for "what does page X look like" — the CRM
// template-form editor (frontend-builder, P4), the API save/preview guard
// (backend-builder, P3), and the seed migration (db-architect, P2) all import from here,
// never re-derive their own section list.

import { z } from "zod";
import {
  PageBuilderBlockTypeSchema,
  type PageBuilderBlockType,
  PageBuilderBlockSchema,
  type PageBuilderBlock,
  HeroBlockDataSchema,
  ContentSplitBlockDataSchema,
  StatGroupBlockDataSchema,
  FeatureGridBlockDataSchema,
  NumberedStepsBlockDataSchema,
  FaqBlockDataSchema,
  CtaBandBlockDataSchema,
  MediaGalleryBlockDataSchema,
  JobOpeningsBlockDataSchema,
  BrainShowcaseBlockDataSchema,
  LiveCollectionRefTestimonialsDataSchema,
  LiveCollectionRefPartnersDataSchema,
  LiveCollectionRefProgramsDataSchema,
  LiveCollectionRefMentorsDataSchema,
} from "./page-builder-blocks.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Core slugs
// ─────────────────────────────────────────────────────────────────────────

/**
 * The 6 pages migrated to locked templates (identical set to Phase-10's
 * `BUILDER_PAGES`/`EXPECTED_SLUGS`, prisma/seed.ts + page-builder-fixtures.test.ts). No
 * other slug gets a template in this phase — `/pages/[slug]` ad-hoc pages are addressed by
 * P5 of the plan (out of this task's scope; NOT removed here).
 */
export const CoreTemplateSlugSchema = z.enum(["home", "about", "scholarship", "for-colleges", "gallery", "careers"]);
export type CoreTemplateSlug = z.infer<typeof CoreTemplateSlugSchema>;

const CORE_TEMPLATE_SLUGS = CoreTemplateSlugSchema.options;

export function isCoreTemplateSlug(slug: string): slug is CoreTemplateSlug {
  return (CORE_TEMPLATE_SLUGS as readonly string[]).includes(slug);
}

// ─────────────────────────────────────────────────────────────────────────
// Section descriptor + template shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * One pinned, non-removable, non-reorderable section within a locked page template.
 * `dataSchema` is always a schema reused VERBATIM from `page-builder-blocks.schemas.ts` —
 * never a re-derived/duplicated field list (CLAUDE.md §3.2). For `blockType:
 * "live_collection_ref"` sections, `dataSchema` is the SPECIFIC per-collection variant
 * (never the generic 4-way union) — a locked-template `live_collection_ref` section is
 * pinned to exactly one collection (e.g. the homepage's "Partner Colleges" section can
 * never be repointed at "mentors"), so `liveCollection` also carries that fixed
 * discriminator for consumers that need it without introspecting the zod schema (e.g. a
 * CRM form deciding which "browse and pick" UI to render).
 */
export interface PageTemplateSectionDescriptor<TData = unknown> {
  /** Stable, unique-within-page identifier. NOT sent over the wire (see file header
   *  limitation note) — used by the CRM form/API guard to address a section by position. */
  key: string;
  blockType: PageBuilderBlockType;
  /** Staff-facing section name (CRM template-form editor). */
  label: string;
  /** Reused verbatim from page-builder-blocks.schemas.ts. */
  dataSchema: z.ZodType<TData>;
  /** Only set when `blockType === "live_collection_ref"` — the fixed collection this
   *  section's data is locked to. */
  liveCollection?: "testimonials" | "partners" | "programs" | "mentors";
}

/**
 * An ordered, fixed list of sections for one core marketing page slug. Named
 * `PageTemplateSchema` (rather than `PageTemplate`) to match this task's contract naming
 * convention — it is a TS type, not a zod runtime schema, because its `dataSchema` members
 * are themselves zod schema INSTANCES (a "schema of schemas" isn't a meaningful zod
 * construct here; `PageTemplateSectionMetaSchema` below is the zod-parseable projection of
 * a section, minus its embedded schema).
 */
export type PageTemplateSchema = readonly PageTemplateSectionDescriptor[];

/** Zod-parseable metadata projection of a section (everything except the embedded
 *  `dataSchema` instance) — useful for an API endpoint that wants to hand the CRM the
 *  template's shape (keys/labels/order) without serializing zod schema objects. */
export const PageTemplateSectionMetaSchema = z
  .object({
    key: z.string().min(1),
    blockType: PageBuilderBlockTypeSchema,
    label: z.string().min(1),
    liveCollection: z.enum(["testimonials", "partners", "programs", "mentors"]).optional(),
  })
  .strict();
export type PageTemplateSectionMeta = z.infer<typeof PageTemplateSectionMetaSchema>;

export function toSectionMeta(section: PageTemplateSectionDescriptor): PageTemplateSectionMeta {
  return { key: section.key, blockType: section.blockType, label: section.label, liveCollection: section.liveCollection };
}

// ─────────────────────────────────────────────────────────────────────────
// The registry — one fixed section list per core slug
// ─────────────────────────────────────────────────────────────────────────
//
// Section lists are derived from the ACTUAL rendered order of each page's resilience
// fallback (apps/web/src/components/page-builder/fallbacks/*-fallback.tsx) and today's
// migrated fixture (prisma/fixtures/builder-pages/*.json), with three deliberate
// additions the Phase-11 plan calls for explicitly ("home must include colleges
// (partners), courses (programs), mentors as pinned sections; for-colleges likewise
// where relevant") — these 3 sections are NEW slots not present in today's fixture JSON;
// db-architect's P2 seed migration must backfill them (defaultBodyForSlug below can seed
// a valid placeholder if no better content is available):
//   - home:         `courses_live` (programs)   — today: hardcoded `ExploreCourses` splice
//   - home:         `mentors_live` (mentors)     — today: hardcoded `MentorsTeaser` splice
//   - for-colleges: `colleges_live` (partners)   — did not exist in any form before

export const PAGE_TEMPLATES: Record<CoreTemplateSlug, PageTemplateSchema> = {
  home: [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "brain_showcase", blockType: "brain_showcase", label: "Brain Showcase", dataSchema: BrainShowcaseBlockDataSchema },
    { key: "stats", blockType: "stat_group", label: "Stats", dataSchema: StatGroupBlockDataSchema },
    {
      key: "courses_live",
      blockType: "live_collection_ref",
      label: "Explore Courses",
      liveCollection: "programs",
      dataSchema: LiveCollectionRefProgramsDataSchema,
    },
    { key: "why_us", blockType: "feature_grid", label: "Why Choose Us", dataSchema: FeatureGridBlockDataSchema },
    { key: "how_it_works", blockType: "numbered_steps", label: "How It Works", dataSchema: NumberedStepsBlockDataSchema },
    {
      key: "mentors_live",
      blockType: "live_collection_ref",
      label: "Mentors",
      liveCollection: "mentors",
      dataSchema: LiveCollectionRefMentorsDataSchema,
    },
    {
      key: "testimonials_live",
      blockType: "live_collection_ref",
      label: "Student Testimonials",
      liveCollection: "testimonials",
      dataSchema: LiveCollectionRefTestimonialsDataSchema,
    },
    {
      key: "colleges_live",
      blockType: "live_collection_ref",
      label: "Partner Colleges",
      liveCollection: "partners",
      dataSchema: LiveCollectionRefPartnersDataSchema,
    },
    { key: "faq", blockType: "faq", label: "Frequently Asked Questions", dataSchema: FaqBlockDataSchema },
    { key: "cta_band", blockType: "cta_band", label: "Call To Action", dataSchema: CtaBandBlockDataSchema },
  ],

  about: [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "why_we_exist", blockType: "content_split", label: "Why We Exist", dataSchema: ContentSplitBlockDataSchema },
    { key: "stats", blockType: "stat_group", label: "Stats", dataSchema: StatGroupBlockDataSchema },
    { key: "how_system_works", blockType: "numbered_steps", label: "How The System Works", dataSchema: NumberedStepsBlockDataSchema },
    { key: "platform_pillars", blockType: "feature_grid", label: "What's Inside The Platform", dataSchema: FeatureGridBlockDataSchema },
    { key: "verify_certificate_cta", blockType: "cta_band", label: "Verify A Certificate CTA", dataSchema: CtaBandBlockDataSchema },
    {
      key: "student_stories_live",
      blockType: "live_collection_ref",
      label: "Student Stories",
      liveCollection: "testimonials",
      dataSchema: LiveCollectionRefTestimonialsDataSchema,
    },
    { key: "commitments", blockType: "feature_grid", label: "Our Commitments", dataSchema: FeatureGridBlockDataSchema },
    { key: "start_journey_cta", blockType: "cta_band", label: "Start Your Journey CTA", dataSchema: CtaBandBlockDataSchema },
  ],

  scholarship: [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "hero_stats_band", blockType: "stat_group", label: "Hero Stats Band", dataSchema: StatGroupBlockDataSchema },
    { key: "benefits", blockType: "feature_grid", label: "Scholarship Benefits", dataSchema: FeatureGridBlockDataSchema },
    { key: "apply_cta", blockType: "cta_band", label: "Application Form CTA", dataSchema: CtaBandBlockDataSchema },
    { key: "impact_stats", blockType: "stat_group", label: "Scholarship Impact Stats", dataSchema: StatGroupBlockDataSchema },
    { key: "fund_distribution", blockType: "stat_group", label: "Fund Distribution By Track", dataSchema: StatGroupBlockDataSchema },
    { key: "process_steps", blockType: "numbered_steps", label: "Application Process", dataSchema: NumberedStepsBlockDataSchema },
  ],

  "for-colleges": [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "offerings", blockType: "feature_grid", label: "Partnership Offerings", dataSchema: FeatureGridBlockDataSchema },
    {
      key: "colleges_live",
      blockType: "live_collection_ref",
      label: "Partner Colleges Showcase",
      liveCollection: "partners",
      dataSchema: LiveCollectionRefPartnersDataSchema,
    },
    { key: "partner_cta", blockType: "cta_band", label: "Partner With Us CTA", dataSchema: CtaBandBlockDataSchema },
  ],

  gallery: [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "gallery_grid", blockType: "media_gallery", label: "Gallery Grid", dataSchema: MediaGalleryBlockDataSchema },
  ],

  careers: [
    { key: "hero", blockType: "hero", label: "Hero", dataSchema: HeroBlockDataSchema },
    { key: "open_roles", blockType: "job_openings", label: "Open Roles", dataSchema: JobOpeningsBlockDataSchema },
  ],
};

/** Returns the fixed section list for a core slug, or `undefined` for any other slug
 *  (e.g. an ad-hoc `/pages/[slug]` page — out of scope for this phase, see file header). */
export function getTemplateForSlug(slug: string): PageTemplateSchema | undefined {
  return isCoreTemplateSlug(slug) ? PAGE_TEMPLATES[slug] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation — the server-side lock enforcement backend-builder's save guard calls
// ─────────────────────────────────────────────────────────────────────────

export interface TemplateValidationError {
  code: "unknown_slug" | "not_array" | "missing_section" | "extra_section" | "wrong_block_type" | "invalid_section_data";
  /** Index in the submitted `body` array this error concerns (omitted for `unknown_slug`/`not_array`). */
  index?: number;
  /** The template section key this error concerns (omitted for `unknown_slug`/`not_array`/`extra_section`,
   *  since an extra section by definition has no corresponding template key). */
  key?: string;
  message: string;
  /** Present only for `invalid_section_data` — the underlying zod issues for that section's `data`. */
  issues?: z.ZodIssue[];
}

export type TemplateValidationResult =
  | { success: true; data: PageBuilderBlock[] }
  | { success: false; errors: TemplateValidationError[] };

/**
 * Validates a `ContentPage.body` array against slug's locked template: every section
 * must be present, in order, of the right `blockType`, with `data` satisfying that
 * section's own schema. Never partially applies — callers (backend-builder's save/preview
 * endpoints) reject the WHOLE request on any error, matching the existing
 * `PageBuilderBlockSchema` all-or-nothing save semantics (docs/specs/phase-10-page-builder.md
 * AC 12). See file header for the documented same-blockType-swap detection limitation.
 */
export function validatePageBodyAgainstTemplate(slug: string, body: unknown): TemplateValidationResult {
  const template = getTemplateForSlug(slug);
  if (!template) {
    return { success: false, errors: [{ code: "unknown_slug", message: `"${slug}" is not a locked-template page slug.` }] };
  }
  if (!Array.isArray(body)) {
    return { success: false, errors: [{ code: "not_array", message: "body must be an array of { type, data } sections." }] };
  }

  const errors: TemplateValidationError[] = [];
  const candidate: Array<{ type: PageBuilderBlockType; data: unknown }> = [];
  const maxLen = Math.max(template.length, body.length);

  for (let i = 0; i < maxLen; i += 1) {
    const section = template[i];
    const item = body[i] as { type?: unknown; data?: unknown } | undefined;

    if (!section) {
      errors.push({
        code: "extra_section",
        index: i,
        message: `Section at index ${i} (type "${String(item?.type)}") is not part of the "${slug}" template — sections cannot be added.`,
      });
      continue;
    }

    if (!item || typeof item !== "object") {
      errors.push({
        code: "missing_section",
        index: i,
        key: section.key,
        message: `Section "${section.key}" (${section.blockType}) is missing at index ${i} — every locked template section is required and cannot be removed.`,
      });
      continue;
    }

    if (item.type !== section.blockType) {
      errors.push({
        code: "wrong_block_type",
        index: i,
        key: section.key,
        message: `Section "${section.key}" at index ${i} must be of type "${section.blockType}" (received "${String(item.type)}") — sections cannot be added, removed, or reordered.`,
      });
      continue;
    }

    const parsed = section.dataSchema.safeParse(item.data);
    if (!parsed.success) {
      errors.push({
        code: "invalid_section_data",
        index: i,
        key: section.key,
        message: `Section "${section.key}" (${section.blockType}) has invalid field values.`,
        issues: parsed.error.issues,
      });
      continue;
    }

    candidate.push({ type: section.blockType, data: parsed.data });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Final safety net: re-parse the reconstructed body against the general block-registry
  // union so callers get back a properly-typed `PageBuilderBlock[]` with no unsafe cast.
  // Should always succeed given every per-section check above already passed — a failure
  // here indicates a bug in this file's registry, not a caller error.
  const finalParse = z.array(PageBuilderBlockSchema).safeParse(candidate);
  if (!finalParse.success) {
    return {
      success: false,
      errors: [
        {
          code: "invalid_section_data",
          message: "Internal: the reconstructed body failed the page-builder block registry — check page-templates.schemas.ts.",
          issues: finalParse.error.issues,
        },
      ],
    };
  }

  return { success: true, data: finalParse.data };
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults — a fresh, empty-but-schema-valid body for a template
// ─────────────────────────────────────────────────────────────────────────

/** A safe, existing placeholder object key (matches the pre-existing "/images/..." exception
 *  ObjectKeySchema carves out for legacy static-asset paths — common/primitives.ts). */
const PLACEHOLDER_IMAGE_KEY = "/images/hero/person.avif";

/**
 * Produces minimal-but-valid `data` for one section, satisfying that section's own
 * `dataSchema` (including its per-variant `min`/`max`/`superRefine` constraints) with
 * generic placeholder copy. Used by `defaultBodyForSlug` — e.g. to backfill a template
 * slot a migration doesn't have real content for yet, or to scaffold a brand-new template
 * page. NOT reachable by staff input; only produces registry-authored placeholder data.
 */
function defaultDataForSection(section: PageTemplateSectionDescriptor): unknown {
  switch (section.blockType) {
    case "hero":
      return { headline: `${section.label} placeholder headline` };
    case "content_split":
      return {
        heading: section.label,
        body: ["Add this section's copy here."],
        mediaImageKey: PLACEHOLDER_IMAGE_KEY,
      };
    case "stat_group":
      return {
        variant: "band",
        items: [
          { label: "Metric", value: "0" },
          { label: "Metric", value: "0" },
        ],
      };
    case "feature_grid":
      return {
        variant: "cards",
        items: [{ title: "Feature", description: "Describe this feature." }],
      };
    case "numbered_steps":
      return {
        variant: "arrows",
        items: [
          { title: "Step 1", description: "Describe step 1." },
          { title: "Step 2", description: "Describe step 2." },
        ],
      };
    case "faq":
      return { items: [{ question: "Question?", answer: "Answer." }] };
    case "cta_band":
      return { heading: section.label };
    case "media_gallery":
      return { items: [{ imageKey: PLACEHOLDER_IMAGE_KEY, alt: "Placeholder image" }] };
    case "job_openings":
      return {};
    case "brain_showcase":
      return {};
    case "live_collection_ref":
      return { collection: section.liveCollection, layout: "grid-3", selection: {} };
    default: {
      const _exhaustive: never = section.blockType;
      throw new Error(`defaultDataForSection: unhandled blockType ${String(_exhaustive)}`);
    }
  }
}

/**
 * Produces a fresh, empty-but-valid `body` for `slug`'s locked template — every section
 * present, in order, each with minimal placeholder `data` that already passes
 * `validatePageBodyAgainstTemplate`. Throws if `slug` is not a core template slug (callers
 * should check `isCoreTemplateSlug` first — this is a registry-authored helper, not a
 * request-input validator, so it fails loudly rather than returning a typed error).
 */
export function defaultBodyForSlug(slug: CoreTemplateSlug): PageBuilderBlock[] {
  const template = PAGE_TEMPLATES[slug];
  const body = template.map((section) => ({ type: section.blockType, data: defaultDataForSection(section) }));
  const result = validatePageBodyAgainstTemplate(slug, body);
  if (!result.success) {
    // Indicates a bug in this file's default-data generator, not caller input.
    throw new Error(`defaultBodyForSlug(${slug}): generated defaults failed validation — ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}
