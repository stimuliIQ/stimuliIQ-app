// apps/api/src/modules/batches/batch-auto-close.scheduler.ts
//
// Closes batches whose end date has passed: status `planned`/`active` -> `completed`,
// with `completed_at` stamped. Follows AnalyticsMvRefreshScheduler's structure exactly
// (interval registered in onModuleInit behind isSchedulerEnabled(), removed on shutdown,
// never throws out of the tick).
//
// WHY A SWEEP AND NOT A DERIVED STATUS
// "Is this batch over?" could be computed on read from `end_date`. It is a stored
// transition instead because `status` is a real, human-editable column that staff also
// set by hand, other modules filter and report on, and BatchCompletionService writes to.
// Computing it in one place and storing it in another would give two answers to the same
// question. The pickers additionally check the date directly (see
// ListBatchesQuerySchema.enrollable), so an expired batch is never offered for enrolment
// even in the window before the next sweep runs.
//
// SAFETY
//   - Only touches batches that are still open AND past their end date; a batch with no
//     end date is open-ended and never swept.
//   - Compare-and-set per batch, so a concurrent human completion is never clobbered.
//   - Purely a status/timestamp write. No enrollment, progress, grading or certificate
//     row is touched — matching BatchCompletionService.markComplete()'s AC-42 contract.
//     Auto-closing a batch does NOT complete its students.
//   - Test-safe: NODE_ENV=test never registers an interval (config/scheduler.ts).

import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { validateEnv } from "../../config/env";
import { isSchedulerEnabled } from "../../config/scheduler";
import { BatchesRepository } from "./batches.repository";

const INTERVAL_NAME = "batch-auto-close";

/**
 * Hourly. The trigger is a DATE crossing, so the worst-case lag is an hour of a batch
 * still reading `active` after midnight UTC — harmless, because the enrolment pickers
 * already exclude it by date. More frequent polling would buy nothing.
 */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class BatchAutoCloseScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BatchAutoCloseScheduler.name);

  constructor(
    private readonly repository: BatchesRepository,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log(
        "[BatchAutoCloseScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test), auto-close interval NOT registered.",
      );
      return;
    }

    const timer = setInterval(() => {
      void this.closeExpiredOnce();
    }, DEFAULT_INTERVAL_MS);
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[BatchAutoCloseScheduler] registered, sweeping every ${DEFAULT_INTERVAL_MS}ms.`);

    // Sweep once at boot too: without this, a process that restarts more often than the
    // interval would never complete a full cycle, and batches that expired while it was
    // down would wait a further hour.
    void this.closeExpiredOnce();
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * Runs one sweep. Public so tests and any future "close expired now" admin action can
   * invoke it without faking a timer tick (same rationale as
   * AnalyticsMvRefreshScheduler.refreshOnce).
   *
   * Returns the number of batches actually closed.
   */
  async closeExpiredOnce(): Promise<number> {
    try {
      const expired = await this.repository.findExpiredOpenBatches();
      if (expired.length === 0) return 0;

      const completedAt = new Date();
      let closed = 0;
      for (const batch of expired) {
        // Per-batch rather than one updateMany: each close needs its own audit row
        // carrying the status it came FROM, and a single failure must not roll back or
        // abandon the rest of the sweep.
        try {
          const didClose = await this.repository.markExpiredComplete(batch.id, completedAt);
          if (!didClose) continue; // Completed by a human between read and write.
          await this.repository.recordAutoCloseAudit({
            tenantId: batch.tenantId,
            batchId: batch.id,
            previousStatus: batch.status,
          });
          closed += 1;
        } catch (err) {
          this.logger.error(`[BatchAutoCloseScheduler] failed to close batch ${batch.id}: ${String(err)}`);
        }
      }

      if (closed > 0) {
        this.logger.log(`[BatchAutoCloseScheduler] closed ${closed} batch(es) past their end date.`);
      }
      return closed;
    } catch (err) {
      // Never let a failed sweep crash the app — the next tick tries again.
      this.logger.error(`[BatchAutoCloseScheduler] sweep FAILED: ${String(err)}`);
      return 0;
    }
  }
}
