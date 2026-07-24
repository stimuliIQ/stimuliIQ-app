// apps/api/src/modules/notifications/dispatch/bullmq-campaign-send.adapter.ts
//
// BullMQ-backed CampaignSendPort adapter (docs/plans/phase-9-completion.md T18 / R1).
// Bound in place of SyncCampaignSendAdapter when QUEUE_DRIVER=bullmq.
//
// PRODUCER SIDE (this file): enqueues a RecipientSendJob and returns immediately;
// `sent: false, queued: true` signals "accepted for async processing". The worker
// (apps/api/src/worker.ts, CampaignSendProcessor) resolves the SAME
// SyncCampaignSendAdapter singleton from the Nest application context and delegates
// to it — zero duplicated provider-call logic.
//
// IDEMPOTENCY: `jobId: job.dedupeKey` (`campaign-recipient:<id>`) — mirrors the
// campaign_recipients.status check the CampaignService performs before calling send().
//
// THROTTLE: no-op here too (BullMQ Worker-level rate limiting, if needed, is a
// `limiter` option on the Worker constructor in worker.ts, not a per-call hook).

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../../queues/job-options";
import type { CampaignSendPort, RecipientSendJob, RecipientSendResult } from "./campaign-send.port";

@Injectable()
export class BullMqCampaignSendAdapter implements CampaignSendPort {
  private readonly logger = new Logger(BullMqCampaignSendAdapter.name);
  private readonly queue: Queue<RecipientSendJob>;

  constructor() {
    this.queue = new Queue<RecipientSendJob>(QUEUE_NAMES.CAMPAIGN_SEND, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async throttle(_channel: "email" | "whatsapp" | "sms"): Promise<void> {
    // No-op — see file header. Queue-level rate limiting is configured on the Worker.
  }

  async send(job: RecipientSendJob): Promise<RecipientSendResult> {
    await this.queue.add(job.channel, job, {
      ...FIRE_AND_FORGET_JOB_OPTIONS,
      jobId: job.dedupeKey,
    });
    this.logger.debug(
      `[BullMqCampaignSend] enqueued channel="${job.channel}" recipientId="${job.campaignRecipientId}"`,
    );
    return { sent: false, queued: true };
  }
}
