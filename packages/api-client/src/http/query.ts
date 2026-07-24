// Tiny query-string builder shared by every CRM list method. Skips
// undefined/null values; coerces booleans/numbers to strings. Kept here
// (not per-resource) so every list query serializes identically
// (CLAUDE.md §3.2 — one canonical implementation, no per-resource drift).

export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
