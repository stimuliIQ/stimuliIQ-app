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
