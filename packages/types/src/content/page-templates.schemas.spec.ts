// Unit tests for the Phase-11 locked-template registry (page-templates.schemas.ts,
// docs/plans/phase-11-locked-templates.md). This is the SINGLE source of truth
// `content-pages-builder.service.ts` (backend-builder P3), `page-template-sections.ts` /
// `page-builder-editor.tsx` (frontend-builder P4), and `prisma/seed.ts` (db-architect P2)
// all import from, a bug here breaks every core marketing page's save/edit/seed path at
// once, so it gets its own dedicated unit-test file at the layer it actually lives in
// (a pure, framework-free zod util, CLAUDE.md §4 testing pyramid: "unit: services,
// utils, guards, components").
//
// GAP THIS FILE CLOSES: `page-builder-fixtures.test.ts` (this same directory) validates
// the 6 real seed fixtures (prisma/fixtures/builder-pages/*.json) against the GENERIC
// `PageBuilderBlockSchema` union only, it does NOT check that each fixture's section
// list actually matches its OWN locked template's fixed shape/order/type. Without this
// file, a fixture could silently drift (an extra/reordered/wrong-type section) and seed
// successfully (Prisma writes arbitrary JSON with no shape check), only to surface as a
// confusing 422 `content.builder.template_violation` the FIRST time a super_admin tries
// to save an unrelated field on that page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CoreTemplateSlugSchema,
  PAGE_TEMPLATES,
  defaultBodyForSlug,
  getTemplateForSlug,
  isCoreTemplateSlug,
  toSectionMeta,
  validatePageBodyAgainstTemplate,
  type CoreTemplateSlug,
} from "./page-templates.schemas.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// packages/types/src/content -> repo root -> prisma/fixtures/builder-pages
const FIXTURES_DIR = join(HERE, "..", "..", "..", "..", "prisma", "fixtures", "builder-pages");

const CORE_SLUGS = CoreTemplateSlugSchema.options;

function readFixtureBody(slug: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${slug}.json`), "utf-8"));
}

describe("isCoreTemplateSlug() / getTemplateForSlug()", () => {
  it.each(CORE_SLUGS)("%s is a core template slug with a non-empty section list", (slug) => {
    expect(isCoreTemplateSlug(slug)).toBe(true);
    const template = getTemplateForSlug(slug);
    expect(template).toBeDefined();
    expect(template!.length).toBeGreaterThan(0);
  });

  it.each(["pricing", "blog", "verify", "programs", "not-a-real-page"])("%s is NOT a core template slug", (slug) => {
    expect(isCoreTemplateSlug(slug)).toBe(false);
    expect(getTemplateForSlug(slug)).toBeUndefined();
  });

  it("every section's key is unique within its own template (position-based matching relies on this)", () => {
    for (const slug of CORE_SLUGS) {
      const keys = PAGE_TEMPLATES[slug].map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("a live_collection_ref section always carries a fixed liveCollection discriminator", () => {
    for (const slug of CORE_SLUGS) {
      for (const section of PAGE_TEMPLATES[slug]) {
        if (section.blockType === "live_collection_ref") {
          expect(section.liveCollection).toBeDefined();
        }
      }
    }
  });
});

describe("toSectionMeta()", () => {
  it("projects a section to its wire-safe metadata shape (no embedded zod schema instance)", () => {
    const section = PAGE_TEMPLATES.gallery[0]!;
    const meta = toSectionMeta(section);
    expect(meta).toEqual({ key: "hero", blockType: "hero", label: "Hero", liveCollection: undefined });
    expect(meta).not.toHaveProperty("dataSchema");
  });
});

describe("defaultBodyForSlug()", () => {
  it.each(CORE_SLUGS)("%s produces a full, schema-valid body that itself passes validatePageBodyAgainstTemplate", (slug) => {
    const body = defaultBodyForSlug(slug);
    expect(body.length).toBe(PAGE_TEMPLATES[slug].length);
    const result = validatePageBodyAgainstTemplate(slug, body);
    expect(result.success).toBe(true);
  });
});

describe("validatePageBodyAgainstTemplate()", () => {
  it("rejects an unknown slug with code=unknown_slug", () => {
    const result = validatePageBodyAgainstTemplate("not-a-real-page", []);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]!.code).toBe("unknown_slug");
  });

  it("rejects a non-array body with code=not_array", () => {
    const result = validatePageBodyAgainstTemplate("gallery", { not: "an array" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]!.code).toBe("not_array");
  });

  it.each(CORE_SLUGS)("%s: accepts its own defaultBodyForSlug() output unchanged", (slug) => {
    const body = defaultBodyForSlug(slug);
    const result = validatePageBodyAgainstTemplate(slug, body);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(body);
  });

  it.each(CORE_SLUGS)("%s: rejects a body with its LAST section removed, code=missing_section", (slug) => {
    const body = defaultBodyForSlug(slug);
    const truncated = body.slice(0, -1);
    const result = validatePageBodyAgainstTemplate(slug, truncated);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "missing_section")).toBe(true);
    }
  });

  it.each(CORE_SLUGS)("%s: rejects a body with an extra section appended, code=extra_section", (slug) => {
    const body = defaultBodyForSlug(slug);
    const withExtra = [...body, { type: "brain_showcase" as const, data: {} }];
    const result = validatePageBodyAgainstTemplate(slug, withExtra);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "extra_section")).toBe(true);
    }
  });

  it.each(CORE_SLUGS.filter((slug) => PAGE_TEMPLATES[slug].length >= 2))(
    "%s: rejects the first two sections swapped, code=wrong_block_type (when their types differ)",
    (slug) => {
      const body = defaultBodyForSlug(slug);
      const [first, second] = body;
      // Only a meaningful reorder-detection assertion when the two swapped positions
      // actually have DIFFERENT block types, same-type swaps are the documented,
      // accepted limitation (see this file's header + page-templates.schemas.ts's own
      // file-header "IMPORTANT LIMITATION" note).
      if (first!.type === second!.type) return;
      const swapped = [second, first, ...body.slice(2)];
      const result = validatePageBodyAgainstTemplate(slug, swapped);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.code === "wrong_block_type")).toBe(true);
      }
    },
  );

  it("rejects a section whose data fails its own dataSchema, code=invalid_section_data", () => {
    const body = defaultBodyForSlug("gallery");
    const brokenHero = [{ ...body[0]!, data: {} }, body[1]!]; // hero.headline is required
    const result = validatePageBodyAgainstTemplate("gallery", brokenHero);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "invalid_section_data" && e.key === "hero")).toBe(true);
    }
  });
});

describe("Seed fixtures (prisma/fixtures/builder-pages/*.json) match their OWN locked template exactly", () => {
  // The gap this file closes (see file header): page-builder-fixtures.test.ts only checks
  // the GENERIC block-registry union, never each fixture's own template shape/order/type.
  it.each(CORE_SLUGS as readonly CoreTemplateSlug[])(
    "%s.json passes validatePageBodyAgainstTemplate for its own slug (no add/remove/reorder/wrong-type drift)",
    (slug) => {
      const body = readFixtureBody(slug);
      const result = validatePageBodyAgainstTemplate(slug, body);
      if (!result.success) {
        throw new Error(`${slug}.json no longer matches its locked template:\n${JSON.stringify(result.errors, null, 2)}`);
      }
      expect(result.success).toBe(true);
    },
  );
});
