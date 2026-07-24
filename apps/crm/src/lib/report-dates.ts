// Date-range default/formatting helpers shared by every Analytics dashboard
// (docs/plans/phase-7.md Wave 3 #14). Report query DTOs use `IsoDateSchema`
// (`YYYY-MM-DD`, tenant-timezone date-only) — these helpers stay in that same
// shape so components can wire a native <input type="date"> directly to the
// query without any parsing/business logic living in the component itself
// (CLAUDE.md §3).
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive [from, to] covering the last `days` days, ending today (tenant-local "today"). */
export function defaultDateRange(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** `from > to` guard mirroring the server's 422 `INVALID_DATE_RANGE` rule (AC-4) — used to
 * disable/short-circuit a query client-side instead of firing a request we know will 422. */
export function isValidDateRange(from: string, to: string): boolean {
  if (!from || !to) return false;
  return from <= to;
}

/** Human-readable "data as of" timestamp for the freshness indicator. */
export function formatAsOf(asOf: string): string {
  const parsed = new Date(asOf);
  if (Number.isNaN(parsed.getTime())) return asOf;
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
