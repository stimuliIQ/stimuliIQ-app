// apps/api/src/modules/live-classes/reminders/bullmq-live-class-reminder.adapter.ts
//
// BullMQ-backed LiveClassReminderPort adapter (docs/plans/phase-9-completion.md T18 / R1 /
// T20). Bound in place of SyncLiveClassReminderAdapter when QUEUE_DRIVER=bullmq (see
// live-classes.module.ts factory) — the SAME producer/worker split as
// BullMqNotificationDispatchAdapter: this file only ENQUEUES a delayed job; the actual
// NotificationsService.notify() call happens in the worker (apps/api/src/worker.ts).
//
// SCHEDULING: BullMQ's native `delay` job option (milliseconds from now) is the real
// "fire in the future" mechanism the sync seam cannot provide — see
// live-class-reminder.port.ts file header.
//
// IDEMPOTENCY: `jobId: live-class-reminder:{liveClassId}:{userId}:{offsetMinutes}` — BullMQ
// treats re-adding a job with an id already present (waiting/delayed) as a no-op, so
// re-scheduling after a PATCH that does NOT change `startsAt` is safe. `cancelReminders`
// removes the delayed job by the same deterministic id before the service re-schedules with
// a new delay (see live-classes.service.ts).

import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../../queues/job-options";
import type { LiveClassReminderPort, ScheduleReminderInput } from "./live-class-reminder.port";

export interface LiveClassReminderJob {
  liveClassId: string;
  userId: string;
  tenantId: string;
  title: string;
  startsAt: string;
  toEmail?: string;
  toPhone?: string;
}

function jobId(liveClassId: string, userId: string, offsetMinutes: number): string {
  return `live-class-reminder:${liveClassId}:${userId}:${offsetMinutes}`;
}

@Injectable()
export class BullMqLiveClassReminderAdapter implements LiveClassReminderPort {
  private readonly logger = new Logger(BullMqLiveClassReminderAdapter.name);
  private readonly queue: Queue<LiveClassReminderJob>;

  constructor() {
    this.queue = new Queue<LiveClassReminderJob>(QUEUE_NAMES.LIVE_CLASS_REMINDER, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async scheduleReminders(input: ScheduleReminderInput): Promise<void> {
    const remindAtMs = input.startsAt.getTime() - input.offsetMinutes * 60_000;
    const delay = Math.max(0, remindAtMs - Date.now());

    await Promise.all(
      input.recipients.map((recipient) =>
        this.queue.add(
          "reminder",
          {
            liveClassId: input.liveClassId,
            userId: recipient.userId,
            tenantId: recipient.tenantId,
            title: input.title,
            startsAt: input.startsAt.toISOString(),
            toEmail: recipient.toEmail,
            toPhone: recipient.toPhone,
          },
          {
            ...FIRE_AND_FORGET_JOB_OPTIONS,
            delay,
            jobId: jobId(input.liveClassId, recipient.userId, input.offsetMinutes),
          },
        ),
      ),
    );

    this.logger.debug(
      `[BullMqLiveClassReminder] scheduled ${input.recipients.length} reminder(s) for liveClassId=${input.liveClassId} ` +
        `delayMs=${delay}`,
    );
  }

  async cancelReminders(liveClassId: string, recipientUserIds: string[], offsetMinutes: number): Promise<void> {
    await Promise.all(
      recipientUserIds.map(async (userId) => {
        const job = await this.queue.getJob(jobId(liveClassId, userId, offsetMinutes));
        if (job) {
          await job.remove().catch(() => {
            // Job may have already moved to active/completed — safe to ignore.
          });
        }
      }),
    );
  }
}
