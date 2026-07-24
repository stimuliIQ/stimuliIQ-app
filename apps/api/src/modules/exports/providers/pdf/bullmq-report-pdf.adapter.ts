// apps/api/src/modules/exports/providers/pdf/bullmq-report-pdf.adapter.ts
//
// BullMQ-backed ReportPdfPort adapter (docs/plans/phase-9-completion.md T18 / R1).
// Bound in place of SyncReportPdfAdapter when QUEUE_DRIVER=bullmq (report-pdf.module.ts).
//
// Same RPC-style queue pattern as BullMqCertificatePdfAdapter (see that file's header
// for the full rationale) — render() enqueues the job and awaits the worker's result
// via `job.waitUntilFinished(queueEvents)`, moving the @react-pdf/renderer CPU work off
// this process into apps/api/src/worker.ts's ReportGenProcessor.

import { Injectable, Logger } from "@nestjs/common";
import { Queue, QueueEvents } from "bullmq";
import { getBullMqConnectionOptions } from "../../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../../queues/queue-names";
import { RPC_JOB_OPTIONS, RPC_JOB_TIMEOUT_MS } from "../../../../queues/job-options";
import type { ReportPdfPort, ReportPdfInput, ReportPdfResult } from "./report-pdf-port.interface";

interface ReportGenJobResult {
  bytesBase64: string;
  contentType: "application/pdf";
}

@Injectable()
export class BullMqReportPdfAdapter implements ReportPdfPort {
  private readonly logger = new Logger(BullMqReportPdfAdapter.name);
  private readonly queue: Queue<ReportPdfInput, ReportGenJobResult>;
  private readonly queueEvents: QueueEvents;

  constructor() {
    const connection = getBullMqConnectionOptions();
    this.queue = new Queue<ReportPdfInput, ReportGenJobResult>(QUEUE_NAMES.REPORT_GEN, { connection });
    this.queueEvents = new QueueEvents(QUEUE_NAMES.REPORT_GEN, { connection });
  }

  async render(input: ReportPdfInput): Promise<ReportPdfResult> {
    // SECURITY (port contract): never log row cell values — see report-pdf-port.interface.ts.
    this.logger.debug(`[BullMqReportPdf] enqueue render title="${input.title}"`);

    const job = await this.queue.add("render", input, RPC_JOB_OPTIONS);
    const result = await job.waitUntilFinished(this.queueEvents, RPC_JOB_TIMEOUT_MS);

    return {
      bytes: Buffer.from(result.bytesBase64, "base64"),
      contentType: result.contentType,
    };
  }
}
