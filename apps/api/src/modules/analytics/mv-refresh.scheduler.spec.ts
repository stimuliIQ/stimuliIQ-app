// apps/api/src/modules/analytics/mv-refresh.scheduler.spec.ts
//
// Unit tests for AnalyticsMvRefreshScheduler (docs/plans/phase-7.md Wave 2 task #11).
//
// Coverage (per the backend-builder DoD):
//   - CRITICAL test-safety: onModuleInit() does NOT register an interval when the
//     scheduler is disabled (SCHEDULER_ENABLED=false), asserted directly rather than
//     relying on NODE_ENV=test, so this spec is explicit about the property it pins.
//   - onModuleInit() DOES register an interval (via SchedulerRegistry.addInterval) when
//     enabled.
//   - refreshOnce() invokes AnalyticsRepository.refreshMaterializedViews() (MV-refresh
//     invocation).
//   - refreshOnce() never throws when the repository call rejects (failure isolation,
//     "never let a failed refresh crash the app").

import type { SchedulerRegistry } from "@nestjs/schedule";
import { AnalyticsMvRefreshScheduler } from "./mv-refresh.scheduler";
import type { AnalyticsRepository } from "./analytics.repository";
import { __resetEnvCacheForTests } from "../../config/env";
import { setMinimalEnv } from "../../common/testing/minimal-env";

const ORIGINAL_ENV = { ...process.env };

function makeSchedulerRegistry(): jest.Mocked<Pick<SchedulerRegistry, "addInterval" | "doesExist" | "deleteInterval">> {
  return {
    addInterval: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false),
    deleteInterval: jest.fn(),
  };
}

describe("AnalyticsMvRefreshScheduler", () => {
  let repo: jest.Mocked<Pick<AnalyticsRepository, "refreshMaterializedViews">>;
  let registry: ReturnType<typeof makeSchedulerRegistry>;

  beforeEach(() => {
    repo = { refreshMaterializedViews: jest.fn().mockResolvedValue(undefined) };
    registry = makeSchedulerRegistry();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  describe("onModuleInit(), CRITICAL test-safety gate", () => {
    it("does NOT register an interval when SCHEDULER_ENABLED=false", () => {
      __resetEnvCacheForTests();
      // qa-engineer Wave 5 (T41 item 1): validateEnv() requires DATABASE_URL/REDIS_URL/
      // JWT key paths/COOKIE_SECRET/CSRF_SECRET with NO schema default, without this,
      // the test only passed if some EARLIER spec in the same Jest worker had already
      // warmed the (now-just-reset) cache via ambient exported env vars. See
      // test/unit-mocks/minimal-env.ts's header for the full rationale.
      setMinimalEnv();
      process.env.SCHEDULER_ENABLED = "false";
      const scheduler = new AnalyticsMvRefreshScheduler(
        repo as unknown as AnalyticsRepository,
        registry as unknown as SchedulerRegistry,
      );

      scheduler.onModuleInit();

      expect(registry.addInterval).not.toHaveBeenCalled();
    });

    it("DOES register an interval when SCHEDULER_ENABLED=true", () => {
      __resetEnvCacheForTests();
      setMinimalEnv();
      process.env.SCHEDULER_ENABLED = "true";
      const scheduler = new AnalyticsMvRefreshScheduler(
        repo as unknown as AnalyticsRepository,
        registry as unknown as SchedulerRegistry,
      );

      scheduler.onModuleInit();

      expect(registry.addInterval).toHaveBeenCalledTimes(1);
      const [name, timer] = registry.addInterval.mock.calls[0]!;
      expect(name).toBe("analytics-mv-refresh");
      clearInterval(timer as NodeJS.Timeout);
    });
  });

  describe("refreshOnce()", () => {
    it("invokes AnalyticsRepository.refreshMaterializedViews()", async () => {
      const scheduler = new AnalyticsMvRefreshScheduler(
        repo as unknown as AnalyticsRepository,
        registry as unknown as SchedulerRegistry,
      );

      await scheduler.refreshOnce();

      expect(repo.refreshMaterializedViews).toHaveBeenCalledTimes(1);
    });

    it("never throws when the repository call rejects (failure isolation)", async () => {
      repo.refreshMaterializedViews.mockRejectedValue(new Error("DB unreachable"));
      const scheduler = new AnalyticsMvRefreshScheduler(
        repo as unknown as AnalyticsRepository,
        registry as unknown as SchedulerRegistry,
      );

      await expect(scheduler.refreshOnce()).resolves.toBeUndefined();
    });
  });
});
