// apps/api/src/modules/batches/batch-auto-close.scheduler.spec.ts
//
// Unit tests for BatchAutoCloseScheduler, the sweep that closes batches once their end
// date has passed. Mirrors mv-refresh.scheduler.spec.ts's harness.
//
// Coverage:
//   - test-safety: onModuleInit() registers no interval when the scheduler is disabled.
//   - a qualifying batch is closed, stamped and audited with the status it came FROM.
//   - a batch a human completed between the sweep's read and write is NOT audited
//     (compare-and-set), so the sweep never fabricates a transition that did not happen.
//   - one failing batch does not abandon the rest of the sweep.
//   - a repository failure never throws out of the tick.

import type { SchedulerRegistry } from "@nestjs/schedule";
import { BatchAutoCloseScheduler } from "./batch-auto-close.scheduler";
import type { BatchesRepository } from "./batches.repository";
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

type RepoMock = jest.Mocked<
  Pick<BatchesRepository, "findExpiredOpenBatches" | "markExpiredComplete" | "recordAutoCloseAudit">
>;

const EXPIRED_BATCH = { id: "batch-1", tenantId: "tenant-1", name: "Neuro Batch AUG", status: "active" as const };

describe("BatchAutoCloseScheduler", () => {
  let repo: RepoMock;
  let registry: ReturnType<typeof makeSchedulerRegistry>;
  let scheduler: BatchAutoCloseScheduler;

  beforeEach(() => {
    repo = {
      findExpiredOpenBatches: jest.fn().mockResolvedValue([]),
      markExpiredComplete: jest.fn().mockResolvedValue(true),
      recordAutoCloseAudit: jest.fn().mockResolvedValue(undefined),
    } as unknown as RepoMock;
    registry = makeSchedulerRegistry();
    scheduler = new BatchAutoCloseScheduler(
      repo as unknown as BatchesRepository,
      registry as unknown as SchedulerRegistry,
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  describe("onModuleInit(), test-safety gate", () => {
    it("registers NO interval when SCHEDULER_ENABLED=false", () => {
      __resetEnvCacheForTests();
      setMinimalEnv();
      process.env.SCHEDULER_ENABLED = "false";
      __resetEnvCacheForTests();

      scheduler.onModuleInit();

      expect(registry.addInterval).not.toHaveBeenCalled();
      // Nor the boot-time sweep, a disabled scheduler must touch nothing at all.
      expect(repo.findExpiredOpenBatches).not.toHaveBeenCalled();
    });
  });

  describe("closeExpiredOnce()", () => {
    it("does nothing when no batch has expired", async () => {
      await expect(scheduler.closeExpiredOnce()).resolves.toBe(0);
      expect(repo.markExpiredComplete).not.toHaveBeenCalled();
      expect(repo.recordAutoCloseAudit).not.toHaveBeenCalled();
    });

    it("closes an expired batch and audits the status it came FROM", async () => {
      repo.findExpiredOpenBatches.mockResolvedValue([EXPIRED_BATCH]);

      await expect(scheduler.closeExpiredOnce()).resolves.toBe(1);

      expect(repo.markExpiredComplete).toHaveBeenCalledWith("batch-1", expect.any(Date));
      expect(repo.recordAutoCloseAudit).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        batchId: "batch-1",
        previousStatus: "active",
      });
    });

    it("closes a still-PLANNED batch too, an unstarted batch whose end date passed is not enrollable either", async () => {
      repo.findExpiredOpenBatches.mockResolvedValue([{ ...EXPIRED_BATCH, status: "planned" }]);

      await expect(scheduler.closeExpiredOnce()).resolves.toBe(1);
      expect(repo.recordAutoCloseAudit).toHaveBeenCalledWith(expect.objectContaining({ previousStatus: "planned" }));
    });

    it("writes NO audit row when a human completed the batch first (compare-and-set lost)", async () => {
      repo.findExpiredOpenBatches.mockResolvedValue([EXPIRED_BATCH]);
      repo.markExpiredComplete.mockResolvedValue(false); // 0 rows matched.

      await expect(scheduler.closeExpiredOnce()).resolves.toBe(0);
      // The transition did not happen, so recording one would be a lie in the audit trail.
      expect(repo.recordAutoCloseAudit).not.toHaveBeenCalled();
    });

    it("keeps going when ONE batch fails, a single bad row must not strand the rest", async () => {
      repo.findExpiredOpenBatches.mockResolvedValue([
        { ...EXPIRED_BATCH, id: "batch-1" },
        { ...EXPIRED_BATCH, id: "batch-2" },
        { ...EXPIRED_BATCH, id: "batch-3" },
      ]);
      repo.markExpiredComplete.mockImplementation(async (id: string) => {
        if (id === "batch-2") throw new Error("deadlock");
        return true;
      });

      await expect(scheduler.closeExpiredOnce()).resolves.toBe(2);
      expect(repo.markExpiredComplete).toHaveBeenCalledTimes(3);
    });

    it("never throws when the lookup itself fails, the next tick retries", async () => {
      repo.findExpiredOpenBatches.mockRejectedValue(new Error("db unreachable"));
      await expect(scheduler.closeExpiredOnce()).resolves.toBe(0);
    });
  });
});
