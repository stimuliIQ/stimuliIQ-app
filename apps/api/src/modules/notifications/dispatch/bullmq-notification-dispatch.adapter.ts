// apps/api/src/modules/notifications/dispatch/bullmq-notification-dispatch.adapter.ts
//
// BullMQ-backed NotificationDispatchPort adapter (docs/plans/phase-9-completion.md
// T18 / R1). Bound in place of SyncNotificationDispatchAdapter when QUEUE_DRIVER=bullmq
// (see notifications/notifications.module.ts / dispatch.module.ts factory).
//
// PRODUCER SIDE (this file): enqueues a ChannelSendJob and returns immediately —
// `dispatched: true` here means "accepted for async processing", NOT "delivered".
// The actual MailProvider/SmsProvider/WhatsAppProvider call happens in the worker
// (apps/api/src/worker.ts, NotificationDispatchProcessor), which resolves the SAME
// SyncNotificationDispatchAdapter singleton from the Nest application context and
// delegates to it — zero duplicated provider-call logic between sync and async paths.
//
// IDEMPOTENCY: `jobId: job.dedupeKey` — BullMQ treats adding a job with an id that is
// already present (waiting/active/delayed) as a no-op returning the existing job,
// which is the queue-level mirror of SyncNotificationDispatchAdapter's in-request
// `seenKeys` Set.
//
// RETRY/DLQ: FIRE_AND_FORGET_JOB_OPTIONS — 5 attempts, exponential backoff, failed
// jobs retained (pseudo-DLQ) for inspection/manual retry.

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../../queues/job-options";
import type { NotificationDispatchPort, ChannelSendJob, ChannelSendResult } from "./notification-dispatch.port";

@Injectable()
export class BullMqNotificationDispatchAdapter implements NotificationDispatchPort {
  private readonly logger = new Logger(BullMqNotificationDispatchAdapter.name);
  private readonly queue: Queue<ChannelSendJob>;

  constructor() {
    this.queue = new Queue<ChannelSendJob>(QUEUE_NAMES.NOTIFICATION_DISPATCH, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async dispatch(job: ChannelSendJob): Promise<ChannelSendResult> {
    await this.queue.add(job.channel, job, {
      ...FIRE_AND_FORGET_JOB_OPTIONS,
      jobId: job.dedupeKey,
    });
    this.logger.debug(`[BullMqDispatch] enqueued channel="${job.channel}" key="${job.dedupeKey}"`);
    // Accepted for async processing — NOT a delivery confirmation. Callers that need
    // a delivery guarantee should not depend on this boolean under QUEUE_DRIVER=bullmq.
    return { dispatched: true, skipped: false };
  }
}
