// apps/api/src/modules/analytics/analytics.service.spec.ts
//
// Unit tests for AnalyticsService (docs/plans/phase-7.md task #7). Mocks
// AnalyticsRepository/CampaignsService/RedisService and drives scope via the real
// `scopeContextStorage` ALS, matching leads.service.spec.ts's established pattern.
//
// Coverage (per the backend-builder DoD):
//   - Scope filtering: branch (revenue), assigned (enrollment/attendance — IDOR->404),
//     own (funnel).
//   - 422 INVALID_DATE_RANGE guard (service-layer, not the zod pipe).
//   - Redis cache-aside: hit short-circuits the repository; miss populates the cache with
//     a TTL.
//   - Money/paise integrity: revenue totals stay integer paise (never a float).
//   - Empty-series zero-fill (AC-9): enrollment trend buckets are present with value 0.
//   - Per-dashboard reconciliation: computed totals match a direct hand-computation over
//     the same mocked rows (the DB-level reconciliation-to-source-rows check is
//     qa-engineer's integration-test territory; this pins the service's arithmetic).

import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import type { AnalyticsRepository } from "./analytics.repository";
import type { CampaignsService } from "../campaigns/campaigns.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepo(): Mocked<AnalyticsRepository> {
  return {
    getFreshness: jest.fn().mockResolvedValue({ asOf: new Date("2026-07-04T09:00:00.000Z"), stale: false }),
    findFacultyProfileId: jest.fn(),
    findAssignedBatchIds: jest.fn(),
    listCallerBranchIds: jest.fn(),
    listBatchIdsForBranches: jest.fn(),
    resolveUserIdsForBatches: jest.fn(),
    countEnrollments: jest.fn(),
    isProgramInTenant: jest.fn().mockResolvedValue(true),
    listProgramTitles: jest.fn().mockResolvedValue(new Map()),
    listBatchNames: jest.fn().mockResolvedValue(new Map()),
    listLessonsForProgram: jest.fn(),
    listUserContacts: jest.fn().mockResolvedValue(new Map()),
    queryRevenue: jest.fn(),
    queryEnrollmentDaily: jest.fn(),
    queryFunnel: jest.fn(),
    queryAttendanceByBatch: jest.fn(),
    queryEngagementByLesson: jest.fn(),
    queryGamificationByUser: jest.fn(),
    queryForumHealth: jest.fn(),
  } as unknown as Mocked<AnalyticsRepository>;
}

function mockCampaignsService(): Mocked<CampaignsService> {
  return {
    getCampaign: jest.fn(),
    getCampaignMetrics: jest.fn(),
  } as unknown as Mocked<CampaignsService>;
}

function mockRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
    },
    __store: store,
  };
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T, actorId = "actor-1", tenantId = "tenant-1"): T {
  const ctx: ScopeContext = { permissionKey: "reports.x.view", scope, actorId, tenantId };
  return scopeContextStorage.run(ctx, fn);
}

const TENANT_ID = "tenant-1";

describe("AnalyticsService", () => {
  let repo: Mocked<AnalyticsRepository>;
  let campaigns: Mocked<CampaignsService>;
  let redis: ReturnType<typeof mockRedis>;
  let service: AnalyticsService;

  beforeEach(() => {
    repo = mockRepo();
    campaigns = mockCampaignsService();
    redis = mockRedis();
    service = new AnalyticsService(
      repo as unknown as AnalyticsRepository,
      campaigns as unknown as CampaignsService,
      redis as unknown as never,
    );
  });

  // ─── 422 INVALID_DATE_RANGE ─────────────────────────────────────────────────

  describe("date-range validation", () => {
    it("throws 422 INVALID_DATE_RANGE when from > to (revenue)", async () => {
      await expect(
        runWithScope("all", () => service.getRevenue(TENANT_ID, { from: "2026-07-10", to: "2026-07-01" })),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("carries the INVALID_DATE_RANGE code", async () => {
      try {
        await runWithScope("all", () => service.getRevenue(TENANT_ID, { from: "2026-07-10", to: "2026-07-01" }));
        fail("expected to throw");
      } catch (err) {
        expect((err as UnprocessableEntityException).getResponse()).toMatchObject({ code: "INVALID_DATE_RANGE" });
      }
    });

    it("does not query the repository at all when the range is invalid (before any query runs)", async () => {
      await expect(
        runWithScope("all", () => service.getFunnel(TENANT_ID, { from: "2026-07-10", to: "2026-07-01" })),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(repo.queryFunnel).not.toHaveBeenCalled();
    });

    it("accepts from === to (inclusive range)", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      const result = await runWithScope("all", () =>
        service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }),
      );
      expect(result.totalPaise).toBe(0);
    });
  });

  // ─── Revenue: branch scope + paise integrity + zero-data (AC-2, AC-5) ──────

  describe("getRevenue", () => {
    it("branch scope filters to the caller's branch ids", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      repo.queryRevenue.mockResolvedValue([]);

      await runWithScope("branch", () => service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-02" }));

      expect(repo.queryRevenue).toHaveBeenCalledWith(TENANT_ID, "2026-07-01", "2026-07-02", ["branch-a"]);
    });

    it("branch-scoped caller requesting a branchId outside their set -> 404 (IDOR-safe)", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      await expect(
        runWithScope("branch", () =>
          service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-02", branchId: "branch-b" }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("zero payments in range -> 200 with totalPaise=0 and empty breakdown, never an error (AC-5)", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      const result = await runWithScope("all", () =>
        service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-03" }),
      );
      expect(result.totalPaise).toBe(0);
      expect(result.currency).toBe("INR");
      expect(result.byProgram).toEqual([]);
      // AC-9-style: every day in range present as a zero bucket, not omitted.
      expect(result.series).toEqual([
        { periodStart: "2026-07-01", amountPaise: 0 },
        { periodStart: "2026-07-02", amountPaise: 0 },
        { periodStart: "2026-07-03", amountPaise: 0 },
      ]);
    });

    it("totalPaise reconciles to a direct sum of the mocked rows and stays an integer (never a float)", async () => {
      repo.queryRevenue.mockResolvedValue([
        { day: new Date("2026-07-01T00:00:00.000Z"), currency: "INR", programId: "prog-1", totalPaise: 150000n },
        { day: new Date("2026-07-02T00:00:00.000Z"), currency: "INR", programId: "prog-1", totalPaise: 99999n },
      ]);
      repo.listProgramTitles.mockResolvedValue(new Map([["prog-1", "Full-Stack"]]));

      const result = await runWithScope("all", () =>
        service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-02" }),
      );

      const expectedTotal = 150000 + 99999; // direct hand-computation over the same rows
      expect(result.totalPaise).toBe(expectedTotal);
      expect(Number.isInteger(result.totalPaise)).toBe(true);
      expect(result.byProgram).toEqual([{ programId: "prog-1", programTitle: "Full-Stack", amountPaise: expectedTotal }]);
    });

    it("carries freshness (asOf/stale) from the repository", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      repo.getFreshness.mockResolvedValue({ asOf: new Date("2026-07-04T08:30:00.000Z"), stale: true });
      const result = await runWithScope("all", () =>
        service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }),
      );
      expect(result.asOf).toBe("2026-07-04T08:30:00.000Z");
      expect(result.stale).toBe(true);
    });
  });

  // ─── Enrollment trend: assigned scope + zero-bucket (AC-8, AC-9) ───────────

  describe("getEnrollmentTrend", () => {
    it("assigned scope (faculty) resolves to the faculty's assigned batch ids", async () => {
      repo.findFacultyProfileId.mockResolvedValue("faculty-1");
      repo.findAssignedBatchIds.mockResolvedValue(["batch-x"]);
      repo.queryEnrollmentDaily.mockResolvedValue([]);

      await runWithScope("assigned", () =>
        service.getEnrollmentTrend(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }),
      );

      expect(repo.queryEnrollmentDaily).toHaveBeenCalledWith(TENANT_ID, "2026-07-01", "2026-07-01", ["batch-x"], null);
    });

    it("faculty with no profile resolves to zero batches (fail-closed, never all)", async () => {
      repo.findFacultyProfileId.mockResolvedValue(null);
      repo.queryEnrollmentDaily.mockResolvedValue([]);

      await runWithScope("assigned", () =>
        service.getEnrollmentTrend(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }),
      );

      expect(repo.queryEnrollmentDaily).toHaveBeenCalledWith(TENANT_ID, "2026-07-01", "2026-07-01", [], null);
    });

    it("every day in range is a zero-value bucket when there is no data (AC-9)", async () => {
      repo.queryEnrollmentDaily.mockResolvedValue([]);
      const result = await runWithScope("all", () =>
        service.getEnrollmentTrend(TENANT_ID, { from: "2026-07-01", to: "2026-07-03" }),
      );
      expect(result.series).toEqual([
        { periodStart: "2026-07-01", value: 0 },
        { periodStart: "2026-07-02", value: 0 },
        { periodStart: "2026-07-03", value: 0 },
      ]);
      expect(result.total).toBe(0);
    });

    it("total reconciles to the direct sum of the mocked daily rows", async () => {
      repo.queryEnrollmentDaily.mockResolvedValue([
        { day: new Date("2026-07-01T00:00:00.000Z"), count: 3n },
        { day: new Date("2026-07-02T00:00:00.000Z"), count: 5n },
      ]);
      const result = await runWithScope("all", () =>
        service.getEnrollmentTrend(TENANT_ID, { from: "2026-07-01", to: "2026-07-02" }),
      );
      expect(result.total).toBe(8);
    });
  });

  // ─── Funnel: own scope (Counsellor) + conversionRate (AC-11) ───────────────

  describe("getFunnel", () => {
    it("own scope filters by ownerId = actorId, server-resolved (never client-selectable)", async () => {
      repo.queryFunnel.mockResolvedValue([]);
      await runWithScope("own", () => service.getFunnel(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }), "counsellor-9");
      expect(repo.queryFunnel).toHaveBeenCalledWith(TENANT_ID, "2026-07-01", "2026-07-01", "counsellor-9", null);
    });

    it("conversionRate = wonCount/totalLeads, 0 when totalLeads=0 (never NaN)", async () => {
      repo.queryFunnel.mockResolvedValue([]);
      const result = await runWithScope("all", () => service.getFunnel(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }));
      expect(result.conversionRate).toBe(0);
      expect(result.totalLeads).toBe(0);
      // Every LeadStage enum value present, even with zero leads.
      expect(result.stages.map((s) => s.stage)).toEqual(
        expect.arrayContaining(["new", "follow_up", "won", "lost"]),
      );
    });

    it("conversionRate reconciles to won/total over the mocked stage rows", async () => {
      repo.queryFunnel.mockResolvedValue([
        { stage: "won", count: 3n },
        { stage: "lost", count: 5n },
        { stage: "new", count: 2n },
      ]);
      const result = await runWithScope("all", () => service.getFunnel(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }));
      expect(result.totalLeads).toBe(10);
      expect(result.wonCount).toBe(3);
      expect(result.conversionRate).toBeCloseTo(0.3);
    });
  });

  // ─── Attendance: assigned-scope IDOR -> 404 (AC-15) ─────────────────────────

  describe("getAttendance", () => {
    it("faculty requesting an unassigned batchId -> 404 (IDOR-safe, AC-15)", async () => {
      repo.findFacultyProfileId.mockResolvedValue("faculty-1");
      repo.findAssignedBatchIds.mockResolvedValue(["batch-assigned"]);

      await expect(
        runWithScope("assigned", () => service.getAttendance(TENANT_ID, { batchId: "batch-other" })),
      ).rejects.toThrow(NotFoundException);
    });

    it("faculty requesting their own assigned batch succeeds", async () => {
      repo.findFacultyProfileId.mockResolvedValue("faculty-1");
      repo.findAssignedBatchIds.mockResolvedValue(["batch-assigned"]);
      repo.queryAttendanceByBatch.mockResolvedValue([
        { batchId: "batch-assigned", presentCount: 18n, totalCount: 20n },
      ]);

      const result = await runWithScope("assigned", () =>
        service.getAttendance(TENANT_ID, { batchId: "batch-assigned" }),
      );

      expect(result.batchId).toBe("batch-assigned");
      expect(result.presentCount).toBe(18);
      expect(result.totalCount).toBe(20);
      expect(result.attendancePercent).toBeCloseTo(90);
      expect(result.perBatch).toBeNull();
    });

    it("admin (all-scope) omitting batchId gets the all-batch aggregate with a perBatch breakdown (AC-16)", async () => {
      repo.queryAttendanceByBatch.mockResolvedValue([
        { batchId: "batch-1", presentCount: 10n, totalCount: 10n },
        { batchId: "batch-2", presentCount: 0n, totalCount: 10n },
      ]);
      repo.listBatchNames.mockResolvedValue(new Map([["batch-1", "Batch One"], ["batch-2", "Batch Two"]]));

      const result = await runWithScope("all", () => service.getAttendance(TENANT_ID, {}));

      expect(result.batchId).toBeNull();
      expect(result.presentCount).toBe(10);
      expect(result.totalCount).toBe(20);
      expect(result.perBatch).toHaveLength(2);
    });

    it("totalCount=0 -> attendancePercent=0, never NaN", async () => {
      repo.queryAttendanceByBatch.mockResolvedValue([]);
      const result = await runWithScope("all", () => service.getAttendance(TENANT_ID, {}));
      expect(result.attendancePercent).toBe(0);
      expect(Number.isNaN(result.attendancePercent)).toBe(false);
    });
  });

  // ─── Gamification: scope restriction (AC-24/AC-25 staff-facing PII) ────────

  describe("getGamificationParticipation", () => {
    it("branch scope is not a supported dimension for this dashboard -> 404", async () => {
      await expect(
        runWithScope("branch", () => service.getGamificationParticipation(TENANT_ID, {})),
      ).rejects.toThrow(NotFoundException);
    });

    it("assigned scope resolves student user ids for the faculty's assigned batches", async () => {
      repo.findFacultyProfileId.mockResolvedValue("faculty-1");
      repo.findAssignedBatchIds.mockResolvedValue(["batch-1"]);
      repo.resolveUserIdsForBatches.mockResolvedValue(["user-1", "user-2"]);
      repo.queryGamificationByUser.mockResolvedValue([]);

      await runWithScope("assigned", () => service.getGamificationParticipation(TENANT_ID, {}));

      expect(repo.resolveUserIdsForBatches).toHaveBeenCalledWith(TENANT_ID, ["batch-1"]);
      expect(repo.queryGamificationByUser).toHaveBeenCalledWith(TENANT_ID, ["user-1", "user-2"]);
    });

    it("perStudent carries real name/email (staff-facing — deliberately NOT PII-minimal, AC-24)", async () => {
      repo.queryGamificationByUser.mockResolvedValue([
        { userId: "user-1", totalXp: 90n, earningEvents: 3n, badgeCount: 1n },
      ]);
      repo.listUserContacts.mockResolvedValue(new Map([["user-1", { name: "Ananya Rao", email: "ananya@example.com" }]]));

      const result = await runWithScope("all", () => service.getGamificationParticipation(TENANT_ID, {}));

      expect(result.perStudent).toEqual([
        { studentId: "user-1", studentName: "Ananya Rao", studentEmail: "ananya@example.com", totalXp: 90, badgeCount: 1 },
      ]);
      expect(result.activeEarnersCount).toBe(1);
      expect(result.totalXpDistributed).toBe(90);
      expect(result.badgeAwardCount).toBe(1);
    });
  });

  // ─── Forum health: assigned scope aggregation ───────────────────────────────

  describe("getForumHealth", () => {
    it("replyRate/resolutionRate are 0 when threadCount=0 (never NaN)", async () => {
      repo.queryForumHealth.mockResolvedValue({ threadCount: 0n, resolvedCount: 0n, postCount: 0n });
      const result = await runWithScope("all", () => service.getForumHealth(TENANT_ID, {}));
      expect(result.replyRate).toBe(0);
      expect(result.resolutionRate).toBe(0);
    });

    it("reconciles replyRate/resolutionRate to a direct computation over the mocked aggregate", async () => {
      repo.queryForumHealth.mockResolvedValue({ threadCount: 4n, resolvedCount: 2n, postCount: 12n });
      const result = await runWithScope("all", () => service.getForumHealth(TENANT_ID, {}));
      expect(result.replyRate).toBeCloseTo(3); // 12/4
      expect(result.resolutionRate).toBeCloseTo(0.5); // 2/4
    });
  });

  // ─── Campaign performance: delegates to CampaignsService (AC-20 no-drift, AC-22) ───

  describe("getCampaignPerformance", () => {
    it("delegates to CampaignsService.getCampaign/getCampaignMetrics (zero-drift by construction)", async () => {
      campaigns.getCampaign.mockResolvedValue({ id: "camp-1", name: "Enrollment Reminder" });
      campaigns.getCampaignMetrics.mockResolvedValue({
        total: 10, queued: 0, sent: 8, delivered: 7, read: 5, failed: 2, suppressed: 1,
      });

      const result = await runWithScope("all", () => service.getCampaignPerformance(TENANT_ID, { campaignId: "camp-1" }));

      expect(result.campaignId).toBe("camp-1");
      expect(result.campaignName).toBe("Enrollment Reminder");
      expect(result.metrics).toEqual({ total: 10, queued: 0, sent: 8, delivered: 7, read: 5, failed: 2, suppressed: 1 });
      expect(result.stale).toBe(false);
    });

    it("cross-tenant/unknown campaignId -> 404 (propagated from CampaignsService, not a 403)", async () => {
      campaigns.getCampaign.mockRejectedValue(new NotFoundException({ code: "campaigns.not_found" }));
      await expect(
        runWithScope("all", () => service.getCampaignPerformance(TENANT_ID, { campaignId: "unknown" })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Redis cache-aside ───────────────────────────────────────────────────────

  describe("cache-aside", () => {
    it("cache miss computes via the repository and populates the cache with a TTL", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      await runWithScope("all", () => service.getRevenue(TENANT_ID, { from: "2026-07-01", to: "2026-07-01" }));

      expect(repo.queryRevenue).toHaveBeenCalledTimes(1);
      expect(redis.client.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 60);
    });

    it("cache hit short-circuits the repository entirely (tenant+scope+params keyed)", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      const query = { from: "2026-07-01", to: "2026-07-01" };

      await runWithScope("all", () => service.getRevenue(TENANT_ID, query));
      await runWithScope("all", () => service.getRevenue(TENANT_ID, query));

      expect(repo.queryRevenue).toHaveBeenCalledTimes(1); // second call served from cache
    });

    it("different tenants/scopes/actors never share a cache entry", async () => {
      repo.queryRevenue.mockResolvedValue([]);
      const query = { from: "2026-07-01", to: "2026-07-01" };

      await runWithScope("all", () => service.getRevenue("tenant-A", query), "actor-A", "tenant-A");
      await runWithScope("all", () => service.getRevenue("tenant-B", query), "actor-B", "tenant-B");

      expect(repo.queryRevenue).toHaveBeenCalledTimes(2); // no cross-tenant cache reuse
    });
  });

  // ─── Engagement: H-1 cross-tenant program IDOR guard ───────────────────────
  describe("getEngagement — H-1 program tenant-scoping", () => {
    const engagementQuery = { from: "2026-07-01", to: "2026-07-02", programId: "prog-other-tenant" };

    it("a programId not in the caller's tenant → 404, before any curriculum read", async () => {
      repo.isProgramInTenant.mockResolvedValue(false);

      await expect(
        runWithScope("all", () => service.getEngagement(TENANT_ID, engagementQuery)),
      ).rejects.toMatchObject({ response: { code: "reports.not_found" } });

      // The ownership check runs BEFORE listing lessons — no curriculum structure is read.
      expect(repo.isProgramInTenant).toHaveBeenCalledWith(TENANT_ID, "prog-other-tenant");
      expect(repo.listLessonsForProgram).not.toHaveBeenCalled();
    });

    it("an in-tenant programId proceeds and passes tenantId into the lesson query", async () => {
      repo.isProgramInTenant.mockResolvedValue(true);
      repo.listLessonsForProgram.mockResolvedValue([]);
      repo.queryEngagementByLesson.mockResolvedValue([]);
      repo.countEnrollments.mockResolvedValue(0);

      await runWithScope("all", () => service.getEngagement(TENANT_ID, engagementQuery));

      expect(repo.listLessonsForProgram).toHaveBeenCalledWith(TENANT_ID, "prog-other-tenant");
    });
  });
});
