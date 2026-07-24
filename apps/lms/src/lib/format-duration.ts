// Duration formatting helpers for lesson/video durations.
// Pure presentation utilities — no business logic (CLAUDE.md §3).

/**
 * Format seconds as a "m:ss" clock string (e.g. 378 → "6:18").
 * Hours roll into minutes ("78:05") — lesson videos are rarely >1 h and the
 * compact form matches the curriculum sidebar design.
 */
export function formatClock(durationS: number): string {
  const total = Math.max(0, Math.floor(durationS));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
