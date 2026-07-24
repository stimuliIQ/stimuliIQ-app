import { describe, expect, it } from "vitest";

import { cleanEmptyStrings } from "./clean-empty-strings";

describe("cleanEmptyStrings", () => {
  it("converts a top-level empty string to undefined", () => {
    expect(cleanEmptyStrings("")).toBeUndefined();
  });

  it("leaves a non-empty string untouched", () => {
    expect(cleanEmptyStrings("hello")).toBe("hello");
  });

  it("leaves non-string, non-NaN primitives untouched", () => {
    expect(cleanEmptyStrings(0)).toBe(0);
    expect(cleanEmptyStrings(false)).toBe(false);
    expect(cleanEmptyStrings(null)).toBeNull();
    expect(cleanEmptyStrings(undefined)).toBeUndefined();
  });

  // QA D1: an untouched optional `type="number"` input (`register(..., {valueAsNumber:
  // true})`) yields `NaN`, not `undefined` — `input.valueAsNumber` is spec'd as `NaN` for an
  // empty number input. Zod's `.optional()`/`.default()` only special-case `undefined`, so
  // an unfilled optional numeric field (e.g. `live_collection_ref.selection.minRating`)
  // permanently failed validation until this normalization existed.
  it("converts a top-level NaN to undefined", () => {
    expect(cleanEmptyStrings(NaN)).toBeUndefined();
  });

  it("does NOT touch a genuine numeric 0 (only NaN, never a real falsy number)", () => {
    expect(cleanEmptyStrings(0)).toBe(0);
    expect(cleanEmptyStrings(-1)).toBe(-1);
    expect(cleanEmptyStrings(3.5)).toBe(3.5);
  });

  it("cleans NaN values inside a plain object (e.g. an untouched minRating field), preserving other numeric keys", () => {
    expect(cleanEmptyStrings({ minRating: NaN, limit: 3 })).toEqual({
      minRating: undefined,
      limit: 3,
    });
  });

  it("cleans NaN elements inside an array WITHOUT changing array length", () => {
    expect(cleanEmptyStrings([1, NaN, 3])).toEqual([1, undefined, 3]);
    expect(cleanEmptyStrings([1, NaN, 3])).toHaveLength(3);
  });

  it("cleans BOTH empty strings and NaN together in one nested payload (e.g. a live_collection_ref selection left partially blank)", () => {
    const input = {
      collection: "testimonials",
      viewAllHref: "",
      selection: { mode: "filter", programId: "", minRating: NaN, limit: 3, sort: "order" },
    };
    expect(cleanEmptyStrings(input)).toEqual({
      collection: "testimonials",
      viewAllHref: undefined,
      selection: { mode: "filter", programId: undefined, minRating: undefined, limit: 3, sort: "order" },
    });
  });

  it("cleans empty-string values inside a plain object, preserving other keys", () => {
    expect(cleanEmptyStrings({ headline: "Hi", eyebrow: "", subheadline: "Sub" })).toEqual({
      headline: "Hi",
      eyebrow: undefined,
      subheadline: "Sub",
    });
  });

  it("cleans empty-string elements inside an array WITHOUT changing array length (never drops items)", () => {
    expect(cleanEmptyStrings(["a", "", "b"])).toEqual(["a", undefined, "b"]);
    expect(cleanEmptyStrings(["a", "", "b"])).toHaveLength(3);
  });

  it("recurses through nested objects/arrays (e.g. a hero block's flankingPhotos)", () => {
    const input = {
      variant: "centered",
      headline: "Launch",
      headlineHighlight: "",
      flankingPhotos: [{ imageKey: "img/1.jpg", statLabel: "", statValue: "90%" }],
      ctas: [{ label: "Apply", href: "/apply", style: "primary" }],
    };
    expect(cleanEmptyStrings(input)).toEqual({
      variant: "centered",
      headline: "Launch",
      headlineHighlight: undefined,
      flankingPhotos: [{ imageKey: "img/1.jpg", statLabel: undefined, statValue: "90%" }],
      ctas: [{ label: "Apply", href: "/apply", style: "primary" }],
    });
  });

  it("does not mutate the input (pure)", () => {
    const input = { a: "" };
    const result = cleanEmptyStrings(input);
    expect(input).toEqual({ a: "" });
    expect(result).toEqual({ a: undefined });
  });
});
