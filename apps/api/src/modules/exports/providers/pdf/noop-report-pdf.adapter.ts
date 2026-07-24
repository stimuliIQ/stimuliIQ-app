// apps/api/src/modules/exports/providers/pdf/noop-report-pdf.adapter.ts
//
// Test/CI double for ReportPdfPort — mirrors certificates/providers/pdf/noop-certificate-pdf.adapter.ts.
// Returns a deterministic, minimal, valid-enough byte sequence — never used in production.

import { Injectable } from "@nestjs/common";
import type { ReportPdfPort, ReportPdfInput, ReportPdfResult } from "./report-pdf-port.interface";

const STUB_PDF_HEADER = Buffer.from("%PDF-1.4\n% stub report pdf (NoopReportPdfAdapter)\n");

@Injectable()
export class NoopReportPdfAdapter implements ReportPdfPort {
  async render(input: ReportPdfInput): Promise<ReportPdfResult> {
    // Deterministic stub: header count is embedded so tests can assert row-count wiring
    // without a real renderer. Never logs cell values (rows may carry PII).
    const stub = Buffer.concat([
      STUB_PDF_HEADER,
      Buffer.from(`title-length:${input.title.length};rows:${input.rows.length};headers:${input.headers.length}\n%%EOF`),
    ]);
    return { bytes: stub, contentType: "application/pdf" };
  }
}
