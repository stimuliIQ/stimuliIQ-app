/**
 * Format utilities tests.
 *
 * Verifies:
 *   - formatPaiseDisplay correctly converts paise to ₹ display string
 *   - formatRating converts ×10 integer to display string
 *   - formatDuration handles weeks correctly
 *   - formatMode capitalises correctly
 *
 * Money rule (CLAUDE.md §3.6 / AC-21): formatPaiseDisplay is DISPLAY-ONLY.
 * Tests assert that input paise values map to correct display strings.
 */
import { describe, expect, it } from "vitest";
import {
  formatPaiseDisplay,
  formatDiscountPercent,
  formatRating,
  formatDuration,
  formatMode,
} from "./format";

// ---------------------------------------------------------------------------
// formatPaiseDisplay
// ---------------------------------------------------------------------------

describe("formatPaiseDisplay", () => {
  it("formats zero paise as ₹0", () => {
    expect(formatPaiseDisplay(0)).toBe("₹0");
  });

  it("formats 100 paise as ₹1", () => {
    expect(formatPaiseDisplay(100)).toBe("₹1");
  });

  it("formats 1299900 paise as ₹12,999 (Indian locale)", () => {
    const result = formatPaiseDisplay(1299900);
    expect(result).toBe("₹12,999");
  });

  it("formats 100000 paise as ₹1,000", () => {
    expect(formatPaiseDisplay(100000)).toBe("₹1,000");
  });

  it("uses floor division (no rounding of fractional paise)", () => {
    // 999 paise = ₹9 (floor, not ₹10)
    expect(formatPaiseDisplay(999)).toBe("₹9");
  });
});

// ---------------------------------------------------------------------------
// formatDiscountPercent
// ---------------------------------------------------------------------------

describe("formatDiscountPercent", () => {
  it("computes the saving off the ORIGINAL price, not the discounted one", () => {
    // ₹14,999 → ₹6,999 saves ₹8,000, which is 53.3% of 14,999 (not 114% of 6,999).
    expect(formatDiscountPercent(1499900, 699900)).toBe("53% OFF");
  });

  it("formats a round half-price saving", () => {
    expect(formatDiscountPercent(1000000, 500000)).toBe("50% OFF");
  });

  // Rounds DOWN so the advertised figure can never exceed the saving actually given.
  it("floors rather than rounding to nearest", () => {
    // 52.6% would round UP to 53 — that would overstate the discount.
    expect(formatDiscountPercent(1000000, 474000)).toBe("52% OFF");
  });

  it("returns undefined when there is no compare-at price", () => {
    expect(formatDiscountPercent(null, 699900)).toBeUndefined();
    expect(formatDiscountPercent(undefined, 699900)).toBeUndefined();
  });

  // Mirrors formatCompareAtDisplay: an equal or inverted compare-at is bad data, and
  // must never surface as a discount claim.
  it("returns undefined for an equal or lower compare-at price", () => {
    expect(formatDiscountPercent(699900, 699900)).toBeUndefined();
    expect(formatDiscountPercent(500000, 699900)).toBeUndefined();
  });

  it("returns undefined when the saving floors to 0%", () => {
    // ₹10,000 → ₹9,950 is 0.5% — a rounding artefact, not a discount worth claiming.
    expect(formatDiscountPercent(1000000, 995000)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatRating
// ---------------------------------------------------------------------------

describe("formatRating", () => {
  it("converts 47 (×10 scale) to '4.7'", () => {
    expect(formatRating(47)).toBe("4.7");
  });

  it("converts 50 to '5.0'", () => {
    expect(formatRating(50)).toBe("5.0");
  });

  it("converts 0 to '0.0'", () => {
    expect(formatRating(0)).toBe("0.0");
  });

  it("converts 48 to '4.8'", () => {
    expect(formatRating(48)).toBe("4.8");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats 12 as '12 weeks'", () => {
    expect(formatDuration(12)).toBe("12 weeks");
  });

  it("formats 1 as '1 week' (singular)", () => {
    expect(formatDuration(1)).toBe("1 week");
  });

  it("returns undefined for null", () => {
    expect(formatDuration(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(formatDuration(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatMode
// ---------------------------------------------------------------------------

describe("formatMode", () => {
  it("capitalises 'live' as 'Live'", () => {
    expect(formatMode("live")).toBe("Live");
  });

  it("capitalises 'recorded' as 'Recorded'", () => {
    expect(formatMode("recorded")).toBe("Recorded");
  });

  it("capitalises 'hybrid' as 'Hybrid'", () => {
    expect(formatMode("hybrid")).toBe("Hybrid");
  });
});
