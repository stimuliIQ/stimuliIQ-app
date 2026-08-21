// apps/api/src/modules/analytics/mv-refresh.scheduler.ts
//
// Scheduled MV refresh (docs/plans/phase-7.md Wave 2 task #11, docs/specs/phase-7-
// analytics-hardening.md LOCK-D1/LOCK-D2). Periodically calls
// `AnalyticsRepository.refreshMaterializedViews()` (-> `CALL refresh_analytics_views()`)
// so `AnalyticsService.getFreshness()`'s `asOf`/`stale` fields reflect a REAL, recently-run
// refresh instead of only the one-time `WITH DATA` population from the read-model
// migration. Cadence + enable-gate are both configurable via env
// (`ANALYTICS_MV_REFRESH_INTERVAL_MS`, `SCHEDULER_ENABLED` — see config/scheduler.ts).
//
// TEST-SAFETY (CRITICAL, per the task brief): registration is gated behind
// `isSchedulerEnabled()` in `onModuleInit()` — a bare `jest` run (NODE_ENV=test) NEVER
// registers a real interval, so unit tests never trigger a real DB call or leave a timer
// running past the test process's lifetime.
//
// FAILURE ISOLATION: `refreshOnce()` never throws out of the interval callback — a failed
// refresh is logged (duration + error) and the app keeps running; the NEXT tick simply
// tries again. `refresh_analytics_views()` itself already isolates each MV's failure from
// the others (see the procedure's own per-MV exception blocks), so this is a second,
// outer layer of failure isolation (the whole `CALL` failing, e.g. a transient DB
// connectivity blip, must not crash the process or stop future ticks).

import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { validateEnv } from "../../config/env";
import { isSchedulerEnabled } from "../../config/scheduler";
import { AnalyticsRepository } from "./analytics.repository";

const INTERVAL_NAME = "analytics-mv-refresh";

@Injectable()
export class AnalyticsMvRefreshScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsMvRefreshScheduler.name);

  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log(
        "[AnalyticsMvRefreshScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test), " +
          "MV-refresh interval NOT registered.",
      );
      return;
    }

    const intervalMs = env.ANALYTICS_MV_REFRESH_INTERVAL_MS;
    const timer = setInterval(() => {
      void this.refreshOnce();
    }, intervalMs);
    // Node timers must not keep the process alive on their own during a graceful shutdown
    // (mirrors the standard Nest interval-registration idiom).
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[AnalyticsMvRefreshScheduler] registered, refreshing every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * Runs one refresh cycle. Public (not private) so it can be invoked directly by tests
   * and by any future manual "force refresh now" admin action, without needing to fake a
   * timer tick.
   */
  async refreshOnce(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.repo.refreshMaterializedViews();
      const durationMs = Date.now() - startedAt;
      this.logger.log(`[AnalyticsMvRefreshScheduler] refresh_analytics_views() completed in ${durationMs}ms.`);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      // Never let a failed refresh crash the app (per the task brief) — log and move on;
      // `analytics_mv_refresh_log.last_error` (written by the procedure itself, per-MV)
      // remains the durable failure record; this log line additionally captures the
      // "the whole CALL statement failed" case (e.g. DB unreachable) that the procedure's
      // own internal exception handling cannot record for itself.
      this.logger.error(
        `[AnalyticsMvRefreshScheduler] refresh_analytics_views() FAILED after ${durationMs}ms: ${String(err)}`,
      );
    }
  }
}
