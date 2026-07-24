// apps/api/src/modules/lms/bullmq-video-webhook-processor.adapter.ts
//
// BullMQ-backed VideoWebhookProcessorPort adapter (docs/plans/phase-9-completion.md
// T18 / R1). Bound in place of SyncVideoWebhookProcessorAdapter when
// QUEUE_DRIVER=bullmq (lms.module.ts).
//
// PRODUCER SIDE (this file, called from VideoWebhookController AFTER HMAC
// verification): enqueues the normalised TranscodeEvent and returns immediately. The
// actual `videos.status` DB update happens in the worker (apps/api/src/worker.ts,
// VideoWebhookProcessor), which resolves the SAME SyncVideoWebhookProcessorAdapter
// singleton from the Nest application context.
//
// IDEMPOTENCY: `jobId: transcode-<providerAssetId>-<status>` — mirrors the migration
// note already documented in lms-video-webhook.seam.ts.

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../queues/queue-connection";
import { QUEUE_NAMES } from "../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../queues/job-options";
import type { VideoWebhookProcessorPort } from "./lms-video-webhook.seam";
import type { TranscodeEvent } from "./providers/video/video-provider.interface";

@Injectable()
export class BullMqVideoWebhookProcessorAdapter implements VideoWebhookProcessorPort {
  private readonly logger = new Logger(BullMqVideoWebhookProcessorAdapter.name);
  private readonly queue: Queue<TranscodeEvent>;

  constructor() {
    this.queue = new Queue<TranscodeEvent>(QUEUE_NAMES.VIDEO_WEBHOOK, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async process(event: TranscodeEvent): Promise<void> {
    const jobId = `transcode-${event.providerAssetId}-${event.status}`;
    await this.queue.add("transcode-status", event, { ...FIRE_AND_FORGET_JOB_OPTIONS, jobId });
    this.logger.debug(`[BullMqVideoWebhook] enqueued ${jobId}`);
  }
}
