// Validates the Phase-10 page-builder seed fixtures (prisma/fixtures/builder-pages/*.json
//, the block arrays reproducing the 6 migrated `web` pages' pre-migration content,
// docs/specs/phase-10-page-builder.md) parse against the SAME closed block-registry union
// (`PageBuilderBlockSchema`) that `apps/api`'s builder save/version endpoints and
// `prisma/seed.ts`'s upsert both validate against. A fixture that fails here would fail
// identically at seed time or at a future CRM save, this is the fast, offline signal for
// that, run from the schema's own source of truth (@repo/types) rather than requiring a
// live DB.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PageBuilderBlockSchema } from "./page-builder-blocks.schemas.js";
import { z } from "zod";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// packages/types/src/content -> repo root -> prisma/fixtures/builder-pages
const FIXTURES_DIR = join(HERE, "..", "..", "..", "..", "prisma", "fixtures", "builder-pages");

const EXPECTED_SLUGS = ["home", "about", "scholarship", "for-colleges", "gallery", "careers"];

function readFixture(fileName: string): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, fileName), "utf-8");
  return JSON.parse(raw);
}

describe("Phase-10 page-builder seed fixtures", () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

  it("has exactly the 6 audited-page fixtures (docs/specs/phase-10-page-builder.md)", () => {
    const slugs = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(slugs).toEqual([...EXPECTED_SLUGS].sort());
  });

  it.each(EXPECTED_SLUGS)("%s.json is a non-empty array of valid PageBuilderBlocks", (slug) => {
    const data = readFixture(`${slug}.json`);
    const result = z.array(PageBuilderBlockSchema).safeParse(data);
    if (!result.success) {
      throw new Error(`${slug}.json failed PageBuilderBlockSchema validation:\n${JSON.stringify(result.error.format(), null, 2)}`);
    }
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("every fixture's live_collection_ref blocks use only the documented collections", () => {
    for (const slug of EXPECTED_SLUGS) {
      const data = readFixture(`${slug}.json`) as Array<{ type: string; data: { collection?: string } }>;
      const refs = data.filter((b) => b.type === "live_collection_ref");
      for (const ref of refs) {
        expect(["testimonials", "partners", "programs", "mentors"]).toContain(ref.data.collection);
      }
    }
  });
});
