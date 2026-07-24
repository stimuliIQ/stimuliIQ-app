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
