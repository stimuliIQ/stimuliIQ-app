// apps/api/src/modules/exports/providers/pdf/report-pdf.module.ts
//
// Binds REPORT_PDF_PORT -> the adapter selected for the current environment, mirroring
// certificates/providers/pdf/certificate-pdf.module.ts exactly (same NODE_ENV=test
// selection rule, same useFactory rationale — ADR-0023/DEFECT-1: avoids the NestJS DI
// crash from a `useClass` binding on a class with optional constructor params).

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../../../config/env";
import { REPORT_PDF_PORT, type ReportPdfPort } from "./report-pdf-port.interface";
import { NoopReportPdfAdapter } from "./noop-report-pdf.adapter";
import { SyncReportPdfAdapter } from "./sync-report-pdf.adapter";
import { BullMqReportPdfAdapter } from "./bullmq-report-pdf.adapter";

const bootLogger = new Logger("ReportPdfModule");

// QUEUE_DRIVER=bullmq (non-test) binds BullMqReportPdfAdapter (docs/plans/
// phase-9-completion.md T18/R1) — same RPC-style queue pattern as
// CertificatePdfModule; see bullmq-report-pdf.adapter.ts for the rationale.
function createReportPdfAdapter(): ReportPdfPort {
  const env = validateEnv();

  if (env.NODE_ENV === "test") {
    bootLogger.warn("[ReportPdfModule] NODE_ENV=test. Binding NoopReportPdfAdapter (stub bytes, no real PDF).");
    return new NoopReportPdfAdapter();
  }

  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log(
      "[ReportPdfModule] QUEUE_DRIVER=bullmq. Binding BullMqReportPdfAdapter (renders in worker process).",
    );
    return new BullMqReportPdfAdapter();
  }

  bootLogger.log("[ReportPdfModule] binding SyncReportPdfAdapter (@react-pdf/renderer, inline PDF generation).");
  return new SyncReportPdfAdapter();
}

@Module({
  providers: [{ provide: REPORT_PDF_PORT, useFactory: createReportPdfAdapter }],
  exports: [REPORT_PDF_PORT],
})
export class ReportPdfModule {}
