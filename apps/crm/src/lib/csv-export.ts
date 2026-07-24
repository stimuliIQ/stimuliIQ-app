// Client-side CSV builder + download trigger — used by the composed reports
// (cohort/branch-comparison/faculty-performance/refund, Phase 9 Completion T40)
// that have NO backend export-job endpoint (`client.crm.exports.*` only covers
// the 8 canonical WS-A report types + 4 entity lists — see
// apps/crm/src/lib/export-types.ts). Those 4 new composed reports are built by
// this task by CLIENT-SIDE composing multiple existing endpoints (see
// hooks/use-extended-reports.ts file header) — there is no server-side render
// job to poll for them, so "export" here means "download the rows already on
// screen as CSV", not a queued PDF. Flagged as a follow-up: promote these to
// real `ExportEntityType` variants once a backend owner is available.
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildCsv<T>(
  rows: readonly T[],
  columns: Array<{ key: keyof T; header: string }>,
): string {
  const headerLine = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(","));
  return [headerLine, ...lines].join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
