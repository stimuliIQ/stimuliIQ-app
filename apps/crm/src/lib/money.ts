// Money helpers — CLAUDE.md §3.6: "Money is integer minor units (paise),
// never floats." All program pricing/EMI wire values are integer paise
// end-to-end (zod schemas in @repo/types, the API, the DB). The UI is the
// ONLY place that ever converts to a decimal rupee value, purely for display
// and for collecting operator input — every conversion happens at the
// component boundary, immediately before sending/right after receiving.
const PAISE_PER_RUPEE = 100;

/** Integer paise -> rupee string for display, e.g. 150000 -> "1500.00". */
export function paiseToRupeeDisplay(paise: number): string {
  return (paise / PAISE_PER_RUPEE).toFixed(2);
}

/** Integer paise -> rupee number for a controlled numeric form input. */
export function paiseToRupeeInput(paise: number | undefined | null): number | undefined {
  if (paise === undefined || paise === null) return undefined;
  return paise / PAISE_PER_RUPEE;
}

/**
 * Rupee form input (may carry paise due to user typing decimals) -> integer
 * paise for the wire. Rounds to the nearest paisa to avoid float drift.
 */
export function rupeeInputToPaise(rupees: number | string): number {
  const value = typeof rupees === "string" ? Number.parseFloat(rupees) : rupees;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * PAISE_PER_RUPEE);
}

/** Formats integer paise as a localized INR currency string for read-only display. */
export function formatPaiseAsInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / PAISE_PER_RUPEE);
}
