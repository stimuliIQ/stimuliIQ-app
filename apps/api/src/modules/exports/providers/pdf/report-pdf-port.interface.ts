// apps/api/src/modules/exports/providers/pdf/report-pdf-port.interface.ts
//
// ReportPdfPort — the internal seam that isolates the PDF-generation library from the
// exports feature module (docs/plans/phase-7.md task #8, WS-B AC-40), mirroring the
// EXACT pattern established by certificates/providers/pdf/certificate-pdf-port.interface.ts
// (docs/plans/phase-4.md §3). A separate port (rather than reusing CertificatePdfPort
// directly) because the two ports render structurally different documents — a
// certificate has a fixed decorative layout; a report PDF is a generic
// title + metadata + tabular-rows summary reused across all 8 report-backed export
// types (revenue/enrollments/funnel/engagement/campaigns/gamification/
// forum-health). Both ports share the same DI-token/module/adapter-selection shape so
// a future BullMQ migration (ADR-0020 pattern) applies identically to either.
//
// AC-40: "PDF export (where offered) matches the same data-scope rules as CSV — no
// separate, less-guarded code path." This port's `input.rows` is ALWAYS produced by
// the SAME row-builders.ts function that produces the CSV export for that `type` (see
// exports.service.ts) — the port itself has no knowledge of scope/permissions; it only
// renders whatever rows it is given.
//
// SECURITY CONTRACT (mirrors CertificatePdfPort):
//   1. The adapter MUST NOT read process.env or make external HTTP calls.
//   2. The adapter MUST NOT log any cell value (row data may contain PII such as
//      student email/phone for staff-facing exports — logging it would duplicate the
//      PII-in-logs risk audit.extension.ts's redaction guards against).
//   3. The returned `bytes` are raw PDF bytes — the caller (ExportsService) stores
//      them via StorageProvider and returns a signed download URL. Raw bytes never
//      leave the server directly.

export interface ReportPdfInput {
  /** Human-readable report title, e.g. "Revenue Report (2026-06-01 to 2026-06-30)". */
  title: string;

  /** Freshness/generation timestamp shown in the PDF footer (ISO 8601). */
  generatedAt: string;

  /**
   * Optional single-line context note shown under the title (e.g. a staleness
   * warning "Data as of 14:32 (last refresh failed — showing last-known-good)", or
   * a scope note "Branch: Hyderabad Central"). Omit for none.
   */
  subtitle?: string;

  /** Column headers, in display order. */
  headers: string[];

  /**
   * Table rows. Each row's cell count MUST equal `headers.length`. Cells are
   * pre-stringified by the caller (row-builders.ts) — the adapter does not apply
   * any CSV-injection neutralization (a PDF is not a spreadsheet formula sink; the
   * csvSafeCell() choke-point is CSV-specific, see lib/csv.ts file header).
   */
  rows: string[][];
}

export interface ReportPdfResult {
  /** Raw PDF bytes (output of @react-pdf/renderer's renderToBuffer(), or a Noop stub). */
  bytes: Buffer | Uint8Array;
  /** Always "application/pdf". */
  contentType: "application/pdf";
}

/**
 * Internal seam for report-summary PDF rendering (AC-40).
 *
 * Implementations:
 *   SyncReportPdfAdapter  — renders inline with @react-pdf/renderer.
 *   NoopReportPdfAdapter  — returns deterministic stub bytes (tests/CI).
 */
export interface ReportPdfPort {
  render(input: ReportPdfInput): Promise<ReportPdfResult>;
}

/** NestJS DI injection token for the ReportPdfPort. Feature modules inject this token — never the concrete adapter. */
export const REPORT_PDF_PORT = Symbol("REPORT_PDF_PORT");
