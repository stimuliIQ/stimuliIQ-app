// Unit tests for the locked-template merge logic (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4), pure, framework-free, per CLAUDE.md §3.10 ("new
// feature without tests = not done").
import { describe, expect, it } from "vitest";

import { buildTemplateSections } from "./page-template-sections";

describe("buildTemplateSections", () => {
  it("preserves stored data for a section that matches position + type + its own schema", () => {
    const slots = buildTemplateSections("gallery", [
      { type: "hero", data: { headline: "Welcome to the gallery" } },
      { type: "media_gallery", data: { items: [{ imageKey: "gallery/1.jpg", alt: "Campus" }] } },
    ]);
    expect(slots).toHaveLength(2);
    expect(slots[0]?.section.key).toBe("hero");
    expect(slots[0]?.data).toMatchObject({ headline: "Welcome to the gallery" });
    expect(slots[1]?.section.key).toBe("gallery_grid");
    expect(slots[1]?.data).toMatchObject({ items: [{ imageKey: "gallery/1.jpg", alt: "Campus" }] });
  });

  it("falls back to placeholder data when the stored type at that position doesn't match the template", () => {
    const slots = buildTemplateSections("gallery", [
      { type: "media_gallery", data: { items: [{ imageKey: "x.jpg", alt: "x" }] } }, // wrong type at index 0 (template expects hero)
      { type: "media_gallery", data: { items: [{ imageKey: "gallery/1.jpg", alt: "Campus" }] } },
    ]);
    // index 0 falls back (hero section, wrong stored type), never crashes, never keeps the mismatched data.
    expect(slots[0]?.section.key).toBe("hero");
    expect(slots[0]?.data).not.toMatchObject({ items: expect.anything() });
  });

  it("falls back to placeholder data when the stored data fails the section's own schema", () => {
    const slots = buildTemplateSections("gallery", [
      { type: "hero", data: { headline: "" } }, // fails HeroBlockDataSchema (headline min length 1)
      { type: "media_gallery", data: { items: [] } },
    ]);
    expect(slots[0]?.data).not.toMatchObject({ headline: "" });
  });

  it("falls back to placeholder data for every section when the stored body is shorter than the template", () => {
    const slots = buildTemplateSections("gallery", []);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.data !== undefined)).toBe(true);
  });

  it("falls back to placeholder data when the stored body isn't an array at all", () => {
    const slots = buildTemplateSections("gallery", null);
    expect(slots).toHaveLength(2);
  });

  it("ignores extra stored entries beyond the template's own section count", () => {
    const slots = buildTemplateSections("gallery", [
      { type: "hero", data: { headline: "Welcome" } },
      { type: "media_gallery", data: { items: [{ imageKey: "a.jpg", alt: "a" }] } },
      { type: "faq", data: { items: [{ question: "Q?", answer: "A" }] } }, // extra, careers/gallery templates have only 2 sections
    ]);
    expect(slots).toHaveLength(2);
  });
});
