// apps/api/src/modules/assignments/deadline-reminders.scheduler.ts
//
// Phase-9 Completion T31 / R3 — wires the previously-orphaned
// `NotificationsService.notifyDeadline()` to a real event site: an hourly cron scan of
// upcoming assignment due dates.
//
// ─── DESIGN: time-bucket dedup (no persisted "reminder sent" flag) ────────────────────
//
// There is no schema support in this task wave for a per-(assignment, student)
// "reminder already sent" flag (this task may only touch `prisma/` for the search-index
// migration — see the sibling `search.repository.ts` header). Instead of adding one,
// this scheduler relies on a NARROW time bucket: on every tick it only considers
// assignments whose `due_at` falls within
//   [now + DEADLINE_REMINDER_LEAD_HOURS·1h, now + DEADLINE_REMINDER_LEAD_HOURS·1h + tickIntervalMs)
// i.e. a ~1-hour-wide window centered ~24h before the deadline (both values configurable
// via env — see config/env.ts). Because the scan interval (default: 1h) equals the
// bucket width, a given assignment's `due_at` passes through the bucket on AT MOST ONE
// tick — the reminder fires ~once per assignment, without needing a persisted flag. This
// is a documented, deliberate trade-off (KNOWN LIMITATION: a scheduler restart that
// causes a tick to be skipped/doubled at the bucket boundary could rarely cause a missed
// or duplicate reminder — acceptable for a non-critical nudge, not a correctness-critical
// financial/legal notice).
//
// TEST-SAFETY: registration gated behind `isSchedulerEnabled()` exactly like every other
// P7+ cron job (report-schedule dispatch, EMI dunning) — never fires during unit tests.

import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { validateEnv } from "../../config/env";
import { isSchedulerEnabled } from "../../config/scheduler";
import { AssignmentsRepository } from "./assignments.repository";
import { NotificationsService } from "../notifications/notifications.service";

const INTERVAL_NAME = "deadline-reminders-scan";
/** Bounded batch size per tick — a defensive ceiling, not an expected steady-state volume. */
const ASSIGNMENT_BATCH_LIMIT = 200;
/** Per-assignment recipient cap — mirrors the R2 `findQueuedRecipients` cap precedent. */
const RECIPIENT_BATCH_LIMIT = 500;

@Injectable()
export class DeadlineRemindersScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DeadlineRemindersScheduler.name);

  constructor(
    private readonly repo: AssignmentsRepository,
    private readonly notifSvc: NotificationsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log(
        "[DeadlineRemindersScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test), scan interval NOT registered.",
      );
      return;
    }

    const intervalMs = env.DEADLINE_REMINDER_INTERVAL_MS;
    const timer = setInterval(() => {
      void this.scanAndNotify();
    }, intervalMs);
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[DeadlineRemindersScheduler] registered, scanning every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Public (not private) so tests / a manual "run now" trigger can invoke a full tick directly. */
  async scanAndNotify(): Promise<void> {
    const env = validateEnv();
    const leadMs = env.DEADLINE_REMINDER_LEAD_HOURS * 60 * 60 * 1000;
    const bucketWidthMs = env.DEADLINE_REMINDER_INTERVAL_MS;
    const now = Date.now();
    const windowStart = new Date(now + leadMs);
    const windowEnd = new Date(now + leadMs + bucketWidthMs);

    let dueSoon: Awaited<ReturnType<AssignmentsRepository["findAssignmentsDueInWindow"]>>;
    try {
      dueSoon = await this.repo.findAssignmentsDueInWindow(windowStart, windowEnd, ASSIGNMENT_BATCH_LIMIT);
    } catch (err) {
      this.logger.error(`[DeadlineRemindersScheduler] failed to scan due-soon assignments: ${String(err)}`);
      return;
    }

    for (const assignment of dueSoon) {
      try {
        await this.notifyAssignment(assignment);
      } catch (err) {
        this.logger.error(
          `[DeadlineRemindersScheduler] unexpected error processing assignment=${assignment.id}: ${String(err)}`,
        );
      }
    }
  }

  private async notifyAssignment(assignment: {
    id: string;
    tenantId: string;
    title: string;
    dueAt: Date;
    programId: string;
  }): Promise<void> {
    const recipients = await this.repo.findEnrolledStudentsWithoutSubmission(
      assignment.tenantId,
      assignment.programId,
      assignment.id,
    );
    const bounded = recipients.slice(0, RECIPIENT_BATCH_LIMIT);

    for (const recipient of bounded) {
      try {
        await this.notifSvc.notifyDeadline(
          recipient.userId,
          assignment.tenantId,
          {
            refType: "assignment",
            refId: assignment.id,
            title: assignment.title,
            dueAt: assignment.dueAt.toISOString(),
          },
          { toEmail: recipient.email, toPhone: recipient.phone ?? undefined },
        );
      } catch (err) {
        this.logger.warn(
          `[DeadlineRemindersScheduler] notifyDeadline failed for assignment=${assignment.id} ` +
            `studentId=${recipient.studentId} (non-fatal, continuing batch): ${String(err)}`,
        );
      }
    }
  }
}
