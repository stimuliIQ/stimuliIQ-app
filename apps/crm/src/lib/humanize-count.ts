// Plain-language item-count summaries for repeatable list fields, per docs/specs/
// phase-10-ui-polish-ux-audit.md C2 jargon table: "Links (7/12, min 1)" ->
// "Links — 7 of 12 (keep at least 1)".
export function humanizeItemCount(noun: string, count: number, max: number, min = 0): string {
  const minSuffix = min > 0 ? ` (keep at least ${min})` : "";
  return `${noun} — ${count} of ${max}${minSuffix}`;
}
