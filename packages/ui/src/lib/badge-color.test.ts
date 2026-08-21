/**
 * Badge colour helper tests.
 *
 * The point of `readableTextOn` is that staff pick ONE colour and cannot produce an
 * unreadable chip, so these assert the contrast outcome (WCAG 2.2 AA is a project
 * requirement, CLAUDE.md §3.9) rather than the specific hex it happens to return.
 */
import { describe, expect, it } from "vitest";
import {
  BADGE_COLOR_PRESETS,
  badgeContrastRatio,
  isValidBadgeColor,
  readableTextOn,
} from "./badge-color";

describe("isValidBadgeColor", () => {
  it("accepts a 6-digit hex in either case", () => {
    expect(isValidBadgeColor("#DC2626")).toBe(true);
    expect(isValidBadgeColor("#dc2626")).toBe(true);
  });

  // Every consumer assumes one parseable format and the column is VARCHAR(7).
  it("rejects shorthand, alpha, named colours, and a missing hash", () => {
    expect(isValidBadgeColor("#f00")).toBe(false);
    expect(isValidBadgeColor("#DC2626FF")).toBe(false);
    expect(isValidBadgeColor("red")).toBe(false);
    expect(isValidBadgeColor("DC2626")).toBe(false);
    expect(isValidBadgeColor("")).toBe(false);
  });

  // These would reach the DOM as an inline style if they ever slipped through.
  it("rejects a CSS injection attempt", () => {
    expect(isValidBadgeColor("red; background-image: url(evil)")).toBe(false);
  });
});

describe("readableTextOn", () => {
  it("puts light text on a dark background and dark text on a light one", () => {
    expect(readableTextOn("#000000")).toBe("#FFFFFF");
    expect(readableTextOn("#FFFFFF")).toBe("#111827");
  });

  // The case that motivated deriving the colour instead of letting staff pick it:
  // yellow is bright enough that white text on it fails AA badly.
  it("picks dark text on yellow", () => {
    expect(readableTextOn("#FFFF00")).toBe("#111827");
  });

  // Gamma expansion matters here, a naive (r+g+b)/3 brightness check misjudges
  // saturated mid-tones and would put dark text on this.
  it("picks light text on saturated blue", () => {
    expect(readableTextOn("#2563EB")).toBe("#FFFFFF");
  });

  it("falls back to white for a malformed colour rather than throwing", () => {
    expect(readableTextOn("not-a-colour")).toBe("#FFFFFF");
  });
});

describe("badgeContrastRatio", () => {
  it("reports the theoretical maximum for black on white", () => {
    expect(badgeContrastRatio("#FFFFFF")).toBeCloseTo(21, 0);
    expect(badgeContrastRatio("#000000")).toBeCloseTo(21, 0);
  });

  // Mid-greys are the worst case, neither text colour has much to work with.
  it("reports a low ratio for a mid-grey", () => {
    expect(badgeContrastRatio("#767676")).toBeLessThan(5);
  });
});

// The swatches are what most staff will actually click, so they must not be the
// source of an inaccessible badge.
describe("BADGE_COLOR_PRESETS", () => {
  it("every preset clears AA (4.5:1) against its derived text colour", () => {
    for (const preset of BADGE_COLOR_PRESETS) {
      expect(isValidBadgeColor(preset.color)).toBe(true);
      expect(badgeContrastRatio(preset.color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
