// apps/api/src/modules/commerce/bullmq-webhook-processor.adapter.ts
//
// BullMQ-backed WebhookProcessorPort adapter (docs/plans/phase-9-completion.md T18 / R1).
// Bound in place of SyncWebhookProcessorAdapter when QUEUE_DRIVER=bullmq (commerce.module.ts).
//
// PRODUCER SIDE (this file, called from WebhookController AFTER HMAC verification):
// enqueues the verified Razorpay webhook payload and returns immediately — the
// controller can ack the webhook fast (Razorpay retries on timeout, so a fast 200 is
// important). The actual DB mutation (capture + enroll + invoice-gen-enqueue) happens
// in the worker (apps/api/src/worker.ts, WebhookProcessor), which resolves the SAME
// SyncWebhookProcessorAdapter singleton from the Nest application context.
//
// IDEMPOTENCY: no `jobId` dedup here — correctness comes from the DB-level idempotency
// checks INSIDE SyncWebhookProcessorAdapter.process() (provider_payment_id unique,
// refund status checks, etc.), which the worker still enforces. A duplicate Razorpay
// retry simply produces two harmless jobs that both resolve to the same no-op state.

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../queues/queue-connection";
import { QUEUE_NAMES } from "../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../queues/job-options";
import type { WebhookProcessorPort, WebhookEventPayload } from "./invoice-gen.seam";

@Injectable()
export class BullMqWebhookProcessorAdapter implements WebhookProcessorPort {
  private readonly logger = new Logger(BullMqWebhookProcessorAdapter.name);
  private readonly queue: Queue<WebhookEventPayload>;

  constructor() {
    this.queue = new Queue<WebhookEventPayload>(QUEUE_NAMES.WEBHOOK_PROCESSOR, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async process(payload: WebhookEventPayload): Promise<void> {
    await this.queue.add(payload.event ?? "unknown", payload, FIRE_AND_FORGET_JOB_OPTIONS);
    this.logger.debug(`[BullMqWebhookProcessor] enqueued event="${payload.event ?? "unknown"}"`);
  }
}
