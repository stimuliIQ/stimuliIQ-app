// apps/api/src/modules/commerce/bullmq-invoice-gen.adapter.ts
//
// BullMQ-backed InvoiceGenPort adapter (docs/plans/phase-9-completion.md T18 / R1).
// Bound in place of SyncInvoiceGenAdapter when QUEUE_DRIVER=bullmq (commerce.module.ts).
//
// PRODUCER SIDE (this file): enqueues an InvoiceGenPayload and returns immediately —
// the actual invoice-issuance DB write (and, once T27 lands, PDF render + storage
// upload) happens in the worker (apps/api/src/worker.ts, InvoiceGenProcessor), which
// resolves the SAME SyncInvoiceGenAdapter singleton from the Nest application context.
//
// IDEMPOTENCY: `jobId: payload.invoiceId` — same invoice never double-processed.

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../queues/queue-connection";
import { QUEUE_NAMES } from "../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../queues/job-options";
import type { InvoiceGenPort, InvoiceGenPayload } from "./invoice-gen.seam";

@Injectable()
export class BullMqInvoiceGenAdapter implements InvoiceGenPort {
  private readonly logger = new Logger(BullMqInvoiceGenAdapter.name);
  private readonly queue: Queue<InvoiceGenPayload>;

  constructor() {
    this.queue = new Queue<InvoiceGenPayload>(QUEUE_NAMES.INVOICE_GEN, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async enqueue(payload: InvoiceGenPayload): Promise<void> {
    await this.queue.add("generate", payload, {
      ...FIRE_AND_FORGET_JOB_OPTIONS,
      jobId: payload.invoiceId,
    });
    this.logger.debug(`[BullMqInvoiceGen] enqueued invoiceId="${payload.invoiceId}"`);
  }
}
