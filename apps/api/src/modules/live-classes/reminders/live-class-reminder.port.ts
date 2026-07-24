// apps/api/src/modules/live-classes/reminders/live-class-reminder.port.ts
//
// LiveClassReminderPort — schedules a "class starting soon" notification for every
// enrolled/assigned recipient of a live class (docs/plans/phase-9-completion.md T20 / T18
// / R1: "reminders enqueued via BullMQ; QUEUE_DRIVER gate already exists; default sync").
//
// Same ADR-0020 producer/port seam as every other Phase-9 queue integration in this
// codebase (VideoWebhookProcessorPort, NotificationDispatchPort, InvoiceGenPort):
//   - LIVE_CLASS_REMINDER_PORT is the DI interface (symbol token).
//   - SyncLiveClassReminderAdapter is the QUEUE_DRIVER=sync (default) implementation.
//   - BullMqLiveClassReminderAdapter is the QUEUE_DRIVER=bullmq implementation, enqueuing a
//     DELAYED job per (liveClassId, recipientUserId) pair that fires at `remindAt`.
//
// WHY SYNC CANNOT "SCHEDULE" A FUTURE REMINDER:
//   A live class is typically scheduled hours/days ahead of `startsAt`; the reminder must
//   fire at (startsAt - offset), not at schedule-time. A synchronous, single-request seam
//   has no mechanism to delay work into the future — it can only act NOW. This mirrors the
//   documented "quiet-hours deferral" limitation in
//   notifications/notifications.service.ts (`notify()`'s quiet-hours branch: "In sync-seam:
//   deferred sends are SKIPPED (not scheduled)"). SyncLiveClassReminderAdapter therefore
//   logs a loud warning and does NOT send a reminder — this is an accepted, documented gap
//   under QUEUE_DRIVER=sync (the default), closed only when QUEUE_DRIVER=bullmq is set
//   (BullMQ's native `delay` job option provides the real scheduling mechanism).
//
// IDEMPOTENCY: `jobId` is `live-class-reminder:{liveClassId}:{userId}:{offsetMinutes}` —
// re-scheduling (e.g. after a PATCH that changes `startsAt`) with the same id is a BullMQ
// no-op if the job is still waiting/delayed; the LiveClass service always re-schedules
// (removing any stale delayed job first) whenever `startsAt` changes — see
// `live-classes.service.ts` `scheduleReminders()`.

import { Injectable, Logger } from "@nestjs/common";

export interface LiveClassReminderRecipient {
  userId: string;
  tenantId: string;
  toEmail?: string;
  toPhone?: string;
}

export interface ScheduleReminderInput {
  liveClassId: string;
  title: string;
  startsAt: Date;
  /** Minutes before `startsAt` the reminder should fire. */
  offsetMinutes: number;
  recipients: LiveClassReminderRecipient[];
}

export interface LiveClassReminderPort {
  /**
   * Schedules (or re-schedules) a reminder for every recipient. MUST be idempotent per
   * (liveClassId, userId, offsetMinutes) — calling this twice for the same live class must
   * not double-send.
   */
  scheduleReminders(input: ScheduleReminderInput): Promise<void>;

  /** Cancels any pending reminder for a live class (called on cancel/soft-delete). */
  cancelReminders(liveClassId: string, recipientUserIds: string[], offsetMinutes: number): Promise<void>;
}

export const LIVE_CLASS_REMINDER_PORT = Symbol("LIVE_CLASS_REMINDER_PORT");

/** Default reminder lead time — 30 minutes before the session starts. */
export const DEFAULT_REMINDER_OFFSET_MINUTES = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Sync adapter (QUEUE_DRIVER=sync, the default) — see file header for why this is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SyncLiveClassReminderAdapter implements LiveClassReminderPort {
  private readonly logger = new Logger(SyncLiveClassReminderAdapter.name);

  async scheduleReminders(input: ScheduleReminderInput): Promise<void> {
    this.logger.warn(
      `[LiveClassReminder] QUEUE_DRIVER=sync cannot delay work into the future — reminder for ` +
        `liveClassId=${input.liveClassId} (${input.recipients.length} recipients, offset=${input.offsetMinutes}min) ` +
        "was NOT scheduled. Set QUEUE_DRIVER=bullmq for real reminder delivery.",
    );
  }

  async cancelReminders(): Promise<void> {
    // No-op — nothing was ever scheduled under the sync seam.
  }
}
