// apps/api/src/config/scheduler.ts
//
// Shared cron-registration gate for every Phase-7 Wave-2 scheduled job (MV refresh +
// report-schedule dispatch — docs/plans/phase-7.md task #11). CRITICAL test-safety rule
// from the task brief: "cron jobs MUST NOT fire during unit tests or block CI."
//
// `isSchedulerEnabled()` is the single source of truth both scheduler services
// (`AnalyticsMvRefreshScheduler`, `ReportScheduleDispatchScheduler`) consult in their
// `onModuleInit()` before calling `SchedulerRegistry.addInterval(...)`. Never bypass this
// — a module that registers its own interval unconditionally would re-introduce the exact
// hazard this file exists to prevent.

import { validateEnv, type Env } from "./env";

/**
 * Resolves whether cron jobs should be registered for this process.
 *
 * Precedence:
 *   1. `SCHEDULER_ENABLED` explicitly set ("true"/"false") — always wins.
 *   2. Otherwise: `false` when `NODE_ENV === "test"` (Jest sets this automatically for
 *      every unit test run — see jest's own bin/jest.js default), `true` otherwise
 *      (development/staging/production).
 *
 * This means: a bare `jest` run (fast unit suite) NEVER registers a real interval, with
 * zero per-spec setup required; a normal `pnpm dev`/deployed process schedules normally.
 */
export function isSchedulerEnabled(env: Env = validateEnv()): boolean {
  if (env.SCHEDULER_ENABLED !== undefined) {
    return env.SCHEDULER_ENABLED;
  }
  return env.NODE_ENV !== "test";
}
