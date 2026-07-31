/**
 * Display formatting utilities for the web app.
 *
 * All money formatting comes from the API's display strings — NO money math in the client.
 * These helpers only format non-monetary display values (ratings, durations, counts).
 *
 * Money rule (CLAUDE.md §3.6 + docs/specs/phase-5-website.md §AC-21):
 *   "money is integer minor units (paise), never floats."
 *   Server returns paise; the API sends back display strings for rendering.
 *   PricePaise → display conversion is done SERVER-SIDE only. The one exception is
 *   the `formatPaise` helper below which is ONLY used for display formatting of
 *   already-validated server-returned paise values — never used for order math.
 */

/**
 * Format paise as an INR display string for UI rendering only.
 * Example: 1299900 → "₹12,999"
 *
 * NOTE: This is DISPLAY-ONLY. Never use this for price math or order creation.
 * Order amounts are always server-derived. (AC-21)
 */
export function formatPaiseDisplay(paise: number): string {
  const rupees = Math.floor(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * Format the struck-through "was" price, or `undefined` when there shouldn't be one.
 *
 * Returns undefined unless `compareAtPaise` is STRICTLY above `pricePaise`, so a null,
 * equal, or inverted value renders as a single price rather than as `₹6,999 ₹6,999` or a
 * saving that runs backwards. The API applies the same rule before it serialises
 * (`public-catalog.service.ts`) and the CRM rejects it at write time — this is the last
 * of the three, and the one that protects a page rendered from cached or hand-built data.
 *
 * DISPLAY-ONLY, like `formatPaiseDisplay`: the charged amount is always server-derived
 * from `pricePaise`.
 */
export function formatCompareAtDisplay(
  compareAtPaise: number | null | undefined,
  pricePaise: number,
): string | undefined {
  if (compareAtPaise == null || compareAtPaise <= pricePaise) return undefined;
  return formatPaiseDisplay(compareAtPaise);
}

/**
 * The saving between the "was" price and the real one, as a whole-number percentage
 * (e.g. ₹14,999 → ₹6,999 gives "53% OFF"). Returns undefined in exactly the cases
 * `formatCompareAtDisplay` does, so the badge can never appear beside a single price.
 *
 * ROUNDED DOWN, not to nearest. A discount percentage is a public claim about money, and
 * rounding to nearest would let 52.6% advertise as "53% OFF" — a saving slightly larger
 * than the one actually given. Flooring can only ever understate it. This is the same
 * posture as the compare-at rule above: never render a price claim the numbers don't
 * support. (53.3% here floors to 53, so the realistic case is unaffected either way.)
 *
 * Percentages of 0 are dropped: a compare-at less than 1% above the price is a rounding
 * artefact or a data-entry slip, and "0% OFF" reads as broken rather than as a discount.
 *
 * DISPLAY-ONLY. Nothing here feeds order math — the charged amount is server-derived.
 */
export function formatDiscountPercent(
  compareAtPaise: number | null | undefined,
  pricePaise: number,
): string | undefined {
  if (compareAtPaise == null || compareAtPaise <= pricePaise) return undefined;
  const percent = Math.floor(((compareAtPaise - pricePaise) / compareAtPaise) * 100);
  if (percent <= 0) return undefined;
  return `${percent}% OFF`;
}

/**
 * Format a rating value from the ×10 integer scale to a display string.
 * API returns ratingAvg as integer 0–50 representing 0.0–5.0.
 * Example: 47 → "4.7"
 */
export function formatRating(ratingAvgTimes10: number): string {
  return (ratingAvgTimes10 / 10).toFixed(1);
}

/**
 * Format a duration in weeks to a display string.
 * Example: 12 → "12 weeks"
 */
export function formatDuration(weeks: number | null | undefined): string | undefined {
  if (weeks == null) return undefined;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/**
 * Capitalise the first letter of a mode string.
 * Example: "live" → "Live", "hybrid" → "Hybrid"
 */
export function formatMode(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/**
 * Humanize a CRM domain slug for display.
 * Example: "web-development" → "Web Development"
 */
export function humanizeDomain(domain: string): string {
  return domain
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
