// apps/api/src/modules/exports/lib/csv.ts
//
// THE single shared CSV-writing choke-point for every export in the platform
// (docs/plans/phase-7.md task #8 HEADLINE; docs/specs/phase-7-analytics-hardening.md
// Rule H-1 / LOCK-D4; AC-28/AC-29). "Every export sink (leads, students, payments,
// campaigns, forum, any future export) routes through one formula-cell-neutralization
// helper. No export path hand-rolls its own CSV escaping."
//
// `toCsvCell()` is that helper. EVERY cell in EVERY CSV export in this codebase MUST
// call `toCsvCell()` (directly, or via `writeCsvRow()`/`rowsToCsv()` below, which call
// it internally) before being written to the output buffer. row-builders.ts (the only
// other file in this module that assembles CSV text) never formats a cell itself — it
// only supplies raw values to `rowsToCsv()`. AC-29's static-scan regression test
// (csv.spec.ts) asserts no other file in this module contains a hand-rolled
// `.join(",")`/manual quote-escaping pattern.
//
// ─── FORMULA-INJECTION NEUTRALIZATION (Rule H-1, AC-28) ────────────────────────────
//
// Excel/Google Sheets treat a cell as a formula if its first character is one of
// `=`, `+`, `-`, `@` (or, per OWASP's CSV-injection guidance, a leading tab/CR can
// also trigger formula evaluation in some spreadsheet engines' paste-special paths).
// A malicious lead name like `=cmd|' /C calc'!A0` or a note like `+SUM(1+1)` would
// execute when a staff member opens the exported file. The fix (OWASP-recommended):
// prefix any such cell with a single leading apostrophe (`'`) BEFORE CSV-escaping —
// spreadsheet apps render a leading apostrophe as "treat this as text" and do not
// display the apostrophe itself, so the cell displays its original value harmlessly
// instead of evaluating as a formula.
//
// The rule is "starts with a trigger character" — NOT "looks like a valid formula".
// A cell that is exactly the single character `=` is still neutralized (Part 4 edge
// case table), because the neutralization is a syntactic prefix check, not a formula
// parser.
//
// ─── RFC-4180 QUOTING (applied AFTER neutralization) ───────────────────────────────
//
// A cell is wrapped in double quotes if it contains a comma, a double quote, or a
// line break; any embedded double quote is doubled (RFC-4180 §2 rule 7). Quoting is
// applied after neutralization so a value like `=a,b` becomes `'=a,b` then
// `"'=a,b"` (the leading apostrophe is part of the quoted text, not a CSV structural
// character).

const FORMULA_TRIGGER_CHARS = new Set<string>(["=", "+", "-", "@", "\t", "\r"]);

/**
 * THE formula-injection neutralization choke-point (Rule H-1, AC-28).
 *
 * Any string whose first character is `=`, `+`, `-`, `@`, a tab, or a carriage
 * return is prefixed with a single leading apostrophe. Every other string is
 * returned unchanged. Never throws.
 */
export function csvSafeCell(raw: string): string {
  if (raw.length > 0 && FORMULA_TRIGGER_CHARS.has(raw[0]!)) {
    return `'${raw}`;
  }
  return raw;
}

/** RFC-4180 field quoting — wraps in double quotes + doubles embedded quotes when the
 * value contains a comma, double quote, or line break. Applied AFTER csvSafeCell(). */
function quoteCsvField(value: string): string {
  if (!/["\n\r,]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Stringifies an arbitrary export-row value into its CSV textual representation.
 * `null`/`undefined` -> empty cell. Numbers/booleans -> their literal string form
 * (money fields are ALWAYS pre-converted to integer paise by the caller before
 * reaching here. This function does not do any numeric formatting/rounding, so a
 * paise integer like 123456 is emitted verbatim as "123456", never "1234.56" or a
 * locale-formatted string). Dates -> ISO 8601. Anything else -> JSON (defensive
 * fallback; row-builders.ts should never pass a nested object/array in practice).
 */
function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * THE single choke-point every CSV cell in this codebase must pass through
 * (AC-28/AC-29). Composes: stringify -> csvSafeCell (formula neutralization) ->
 * quoteCsvField (RFC-4180 structural escaping).
 */
export function toCsvCell(value: unknown): string {
  const asString = stringifyCellValue(value);
  const neutralized = csvSafeCell(asString);
  return quoteCsvField(neutralized);
}

/** Renders one CSV row (comma-joined cells, each through `toCsvCell()`). No trailing newline. */
export function writeCsvRow(cells: readonly unknown[]): string {
  return cells.map(toCsvCell).join(",");
}

/**
 * Renders a full CSV document: a header row followed by one row per `rows` entry,
 * CRLF-terminated per RFC-4180 (including a trailing CRLF after the last row). A
 * zero-row export still emits the header row alone (Part 4 edge case: "Export
 * matches zero rows -> a valid, empty CSV/PDF is generated, header row only for
 * CSV, not an error").
 */
export function rowsToCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [writeCsvRow(headers), ...rows.map((row) => writeCsvRow(row))];
  return lines.join("\r\n") + "\r\n";
}

/**
 * Incremental CSV writer for bounded-batch streaming (AC-33): callers page through a
 * scoped repository/service query and append each page's rows via `appendRows()`
 * rather than materializing the full row set as one giant array before ever calling
 * `rowsToCsv()`. `toBuffer()` is called once, after the last page, to produce the
 * final upload payload.
 */
export class IncrementalCsvWriter {
  private readonly chunks: string[] = [];
  private headerWritten = false;

  constructor(private readonly headers: readonly string[]) {}

  /** Appends a bounded batch of rows. Safe to call zero times (still yields the header-only CSV). */
  appendRows(rows: ReadonlyArray<readonly unknown[]>): void {
    if (!this.headerWritten) {
      this.chunks.push(writeCsvRow(this.headers));
      this.headerWritten = true;
    }
    for (const row of rows) {
      this.chunks.push(writeCsvRow(row));
    }
  }

  /** Total data rows appended so far (excludes the header row), used for `export_jobs.row_count`. */
  get rowCount(): number {
    return this.headerWritten ? this.chunks.length - 1 : 0;
  }

  toBuffer(): Buffer {
    if (!this.headerWritten) {
      this.chunks.push(writeCsvRow(this.headers));
      this.headerWritten = true;
    }
    return Buffer.from(this.chunks.join("\r\n") + "\r\n", "utf8");
  }
}
