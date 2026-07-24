// Merges a builder page's stored `body` (wire shape `{type,data}[]`) into its LOCKED
// template's fixed section slots (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4). Pure, framework-free (CLAUDE.md §3: no business logic
// in components) — mirrors the position-based matching `page-templates.schemas.ts`'s own
// `validatePageBodyAgainstTemplate` uses (see that file's header comment for why position,
// not a stored key, is the matching strategy: the wire shape carries no per-section
// identifier).
//
// A stored entry is used AS-IS when it sits at the position its template section expects,
// has the section's exact `blockType`, AND its `data` satisfies that section's own
// `dataSchema`. Anything else (missing slot, wrong type, or data that no longer validates —
// e.g. a page saved before this section existed) falls back to `defaultBodyForSlug(slug)`'s
// placeholder data for that same slot — a schema-valid starting point the author can then
// fill in, never a blank/crashing form. The template editor (`page-builder-editor.tsx`)
// always assembles its save payload in the template's fixed order from its own per-section
// forms, so this merge only matters for the INITIAL load.
import { defaultBodyForSlug, getTemplateForSlug, type CoreTemplateSlug, type PageTemplateSectionDescriptor } from "@repo/types";

export interface TemplateSectionSlot {
  section: PageTemplateSectionDescriptor;
  data: unknown;
}

export function buildTemplateSections(slug: CoreTemplateSlug, storedBody: unknown): TemplateSectionSlot[] {
  const template = getTemplateForSlug(slug);
  if (!template) return [];
  const fallback = defaultBodyForSlug(slug);
  const body = Array.isArray(storedBody) ? storedBody : [];

  return template.map((section, index) => {
    const item = body[index] as { type?: unknown; data?: unknown } | undefined;
    if (item && item.type === section.blockType) {
      const parsed = section.dataSchema.safeParse(item.data);
      if (parsed.success) return { section, data: parsed.data };
    }
    return { section, data: fallback[index]?.data };
  });
}
