/**
 * metadata helper tests.
 *
 * Verifies:
 *   - Title templating ("Page | Stimuli IQ")
 *   - Default description
 *   - Canonical URL construction
 *   - OG/Twitter metadata
 *   - noIndex flag
 */
import { describe, expect, it } from "vitest";
import { buildMetadata, SITE_NAME } from "./metadata";

describe("buildMetadata", () => {
  it("applies title template 'Page | Stimuli IQ'", () => {
    const meta = buildMetadata({ title: "About Us" });
    expect(meta.title).toBe(`About Us | ${SITE_NAME}`);
  });

  it("does not double-append site name when title already contains it", () => {
    const meta = buildMetadata({ title: "Stimuli IQ — Programs" });
    expect(meta.title).toBe("Stimuli IQ — Programs");
  });

  it("uses the site name as title when no title given", () => {
    const meta = buildMetadata();
    expect(meta.title).toBe(SITE_NAME);
  });

  it("sets description when provided", () => {
    const meta = buildMetadata({ description: "Custom description." });
    expect(meta.description).toBe("Custom description.");
  });

  it("uses default description when none provided", () => {
    const meta = buildMetadata();
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeGreaterThan(20);
  });

  it("constructs canonical URL from canonicalPath", () => {
    const meta = buildMetadata({ canonicalPath: "/programs/python" });
    expect(meta.alternates?.canonical).toContain("/programs/python");
  });

  it("ensures canonical URL starts with the site URL (absolute)", () => {
    const meta = buildMetadata({ canonicalPath: "/about" });
    const canonical = meta.alternates?.canonical as string;
    expect(canonical).toMatch(/^https?:\/\//);
  });

  it("sets og:title matching the resolved title", () => {
    const meta = buildMetadata({ title: "FAQ" });
    const og = meta.openGraph as { title: string };
    expect(og.title).toBe(`FAQ | ${SITE_NAME}`);
  });

  it("sets twitter card to summary_large_image", () => {
    const meta = buildMetadata();
    const twitter = meta.twitter as { card: string };
    expect(twitter.card).toBe("summary_large_image");
  });

  it("sets noIndex robots directive when noIndex=true", () => {
    const meta = buildMetadata({ noIndex: true });
    const robots = meta.robots as { index: boolean; follow: boolean };
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(false);
  });

  it("does not set robots when noIndex is false (default)", () => {
    const meta = buildMetadata({ noIndex: false });
    expect(meta.robots).toBeUndefined();
  });

  it("sets ogType=article when requested", () => {
    const meta = buildMetadata({ ogType: "article" });
    const og = meta.openGraph as { type: string };
    expect(og.type).toBe("article");
  });

  it("includes publishedTime in OG when publishedAt + ogType=article", () => {
    const meta = buildMetadata({
      ogType: "article",
      publishedAt: "2026-01-15",
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.publishedTime).toBe("2026-01-15");
  });
});
