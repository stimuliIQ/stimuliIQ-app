// apps/api/src/modules/commerce/bullmq-receipt-gen.adapter.ts
//
// BullMQ-backed ReceiptGenPort adapter (T27, docs/plans/phase-9-completion.md). Bound in
// place of SyncReceiptGenAdapter when QUEUE_DRIVER=bullmq (commerce.module.ts). Mirrors
// bullmq-invoice-gen.adapter.ts exactly.
//
// IDEMPOTENCY: `jobId: payload.paymentId` — replaying the same payment never double-processes.

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../queues/queue-connection";
import { QUEUE_NAMES } from "../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../queues/job-options";
import type { ReceiptGenPort, ReceiptGenPayload } from "./receipt-gen.seam";

@Injectable()
export class BullMqReceiptGenAdapter implements ReceiptGenPort {
  private readonly logger = new Logger(BullMqReceiptGenAdapter.name);
  private readonly queue: Queue<ReceiptGenPayload>;

  constructor() {
    this.queue = new Queue<ReceiptGenPayload>(QUEUE_NAMES.RECEIPT_GEN, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async enqueue(payload: ReceiptGenPayload): Promise<void> {
    await this.queue.add("generate", payload, {
      ...FIRE_AND_FORGET_JOB_OPTIONS,
      jobId: payload.paymentId,
    });
    this.logger.debug(`[BullMqReceiptGen] enqueued paymentId=${payload.paymentId}`);
  }
}
