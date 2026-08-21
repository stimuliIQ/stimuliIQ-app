// apps/api/src/config/scheduler.spec.ts
//
// Unit tests for `isSchedulerEnabled()`, the single gate every Phase-7 Wave-2 cron
// consumer (AnalyticsMvRefreshScheduler, ReportScheduleDispatchScheduler) checks before
// registering a real interval. CRITICAL test-safety property: a bare `jest` run
// (NODE_ENV=test, SCHEDULER_ENABLED unset) must resolve to `false`.

import { isSchedulerEnabled } from "./scheduler";
import type { Env } from "./env";

function makeEnv(overrides: Partial<Env>): Env {
  return { NODE_ENV: "development", SCHEDULER_ENABLED: undefined, ...overrides } as Env;
}

describe("isSchedulerEnabled()", () => {
  it("is false when NODE_ENV=test and SCHEDULER_ENABLED is unset (CRITICAL test-safety default)", () => {
    expect(isSchedulerEnabled(makeEnv({ NODE_ENV: "test" }))).toBe(false);
  });

  it("is true when NODE_ENV=development and SCHEDULER_ENABLED is unset", () => {
    expect(isSchedulerEnabled(makeEnv({ NODE_ENV: "development" }))).toBe(true);
  });

  it("is true when NODE_ENV=production and SCHEDULER_ENABLED is unset", () => {
    expect(isSchedulerEnabled(makeEnv({ NODE_ENV: "production" }))).toBe(true);
  });

  it("an explicit SCHEDULER_ENABLED=false wins even outside test", () => {
    expect(isSchedulerEnabled(makeEnv({ NODE_ENV: "production", SCHEDULER_ENABLED: false }))).toBe(false);
  });

  it("an explicit SCHEDULER_ENABLED=true wins even when NODE_ENV=test", () => {
    expect(isSchedulerEnabled(makeEnv({ NODE_ENV: "test", SCHEDULER_ENABLED: true }))).toBe(true);
  });
});
