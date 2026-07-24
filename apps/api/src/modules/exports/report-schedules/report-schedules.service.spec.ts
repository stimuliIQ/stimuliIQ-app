// apps/api/src/modules/exports/report-schedules/report-schedules.service.spec.ts
//
// Unit tests for ReportSchedulesService (docs/plans/phase-7.md Wave 2 task #11). Mocks
// ReportSchedulesRepository and drives scope via the real `scopeContextStorage` ALS
// (matches exports.service.spec.ts's established pattern).
//
// Coverage (per the backend-builder DoD):
//   - Create requires the domain-specific view permission (mirrors AC-34's pattern) —
//     403 and repo.create never called when missing.
//   - nextRunAt is computed one cadence AFTER creation, never immediately due.
//   - List/get/update/delete: "all"-scope sees every schedule; every other scope is
//     restricted to schedules the caller created (IDOR -> 404 for someone else's row).
//   - Updating the frequency re-bases nextRunAt from lastRunAt (or createdAt).

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ReportSchedulesService } from "./report-schedules.service";
import type { ReportSchedulesRepository, ReportScheduleRow } from "./report-schedules.repository";
import { scopeContextStorage, type ScopeContext } from "../../auth/lib/scope-context";
import type { RequestUser } from "../../auth/lib/request-user";
import type { CreateReportScheduleDto, UpdateReportScheduleDto } from "@repo/types";

const TENANT_ID = "tenant-1";

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T, actorId = "user-1"): T {
  const ctx: ScopeContext = { permissionKey: "reports.schedule", scope, actorId, tenantId: TENANT_ID };
  return scopeContextStorage.run(ctx, fn);
}

function makeUser(permissions: Array<{ key: string; scope: string }>, id = "user-1"): RequestUser {
  return {
    id,
    tenantId: TENANT_ID,
    roles: ["test"],
    permissions: permissions as RequestUser["permissions"],
    mustChangePassword: false,
  };
}

function baseRow(overrides: Partial<ReportScheduleRow> = {}): ReportScheduleRow {
  return {
    id: "sched-1",
    tenantId: TENANT_ID,
    createdById: "user-1",
    createdByName: "Test User",
    type: "revenue",
    format: "csv",
    params: { from: "2026-06-01", to: "2026-06-30" },
    frequency: "weekly",
    recipientEmail: null,
    active: true,
    nextRunAt: new Date("2026-07-11T09:00:00.000Z"),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date("2026-07-04T09:00:00.000Z"),
    ...overrides,
  } as ReportScheduleRow;
}

describe("ReportSchedulesService", () => {
  let repo: jest.Mocked<
    Pick<ReportSchedulesRepository, "create" | "findById" | "list" | "update" | "softDelete">
  >;
  let service: ReportSchedulesService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(baseRow()),
      findById: jest.fn().mockResolvedValue(baseRow()),
      list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      update: jest.fn().mockResolvedValue(baseRow()),
      softDelete: jest.fn().mockResolvedValue(undefined),
    } as never;

    service = new ReportSchedulesService(repo as unknown as ReportSchedulesRepository);
  });

  // ─── create() — permission gating ───────────────────────────────────────────

  describe("create()", () => {
    it("403s and NEVER creates a row when the caller lacks the matching view permission", async () => {
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]); // no reports.revenue.view
      const dto: CreateReportScheduleDto = {
        type: "revenue",
        format: "csv",
        frequency: "weekly",
        params: { from: "2026-06-01", to: "2026-06-30" },
      };

      await runWithScope("all", async () => {
        await expect(service.create(TENANT_ID, user, dto)).rejects.toThrow(ForbiddenException);
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("computes nextRunAt one cadence AFTER creation (never immediately due)", async () => {
      const user = makeUser([
        { key: "reports.schedule", scope: "all" },
        { key: "reports.revenue.view", scope: "all" },
      ]);
      const dto: CreateReportScheduleDto = {
        type: "revenue",
        format: "csv",
        frequency: "daily",
        params: { from: "2026-06-01", to: "2026-06-30" },
      };

      const fixedNow = new Date("2026-07-04T09:00:00.000Z");
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        await runWithScope("all", () => service.create(TENANT_ID, user, dto));
      } finally {
        jest.useRealTimers();
      }

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ nextRunAt: new Date("2026-07-05T09:00:00.000Z") }),
      );
    });
  });

  // ─── list()/getById() — ownership scope split ───────────────────────────────

  describe("scope isolation", () => {
    it("'all' scope passes no createdById filter (sees every schedule)", async () => {
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]);
      await runWithScope("all", () =>
        service.list(TENANT_ID, user, { page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ createdById: undefined }));
    });

    it("'own' scope restricts to the caller's own created schedules", async () => {
      const user = makeUser([{ key: "reports.schedule", scope: "own" }]);
      await runWithScope("own", () =>
        service.list(TENANT_ID, user, { page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ createdById: "user-1" }));
    });

    it("getById 404s (IDOR-safe) for a non-'all'-scope caller reading someone else's schedule", async () => {
      repo.findById.mockResolvedValue(baseRow({ createdById: "someone-else" }));
      const user = makeUser([{ key: "reports.schedule", scope: "own" }]);

      await runWithScope("own", async () => {
        await expect(service.getById(TENANT_ID, user, "sched-1")).rejects.toThrow(NotFoundException);
      });
    });

    it("getById succeeds for an 'all'-scope caller reading anyone's schedule", async () => {
      repo.findById.mockResolvedValue(baseRow({ createdById: "someone-else" }));
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]);

      const result = await runWithScope("all", () => service.getById(TENANT_ID, user, "sched-1"));
      expect(result.id).toBe("sched-1");
    });
  });

  // ─── update() — frequency change re-bases nextRunAt ─────────────────────────

  describe("update()", () => {
    it("re-bases nextRunAt from lastRunAt when the frequency changes", async () => {
      repo.findById.mockResolvedValue(
        baseRow({ frequency: "weekly", lastRunAt: new Date("2026-07-01T09:00:00.000Z") }),
      );
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]);
      const dto: UpdateReportScheduleDto = { frequency: "daily" };

      await runWithScope("all", () => service.update(TENANT_ID, user, "sched-1", dto));

      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        "sched-1",
        expect.objectContaining({ frequency: "daily", nextRunAt: new Date("2026-07-02T09:00:00.000Z") }),
      );
    });

    it("leaves nextRunAt untouched when the frequency is unchanged", async () => {
      repo.findById.mockResolvedValue(baseRow({ frequency: "weekly" }));
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]);
      const dto: UpdateReportScheduleDto = { active: false };

      await runWithScope("all", () => service.update(TENANT_ID, user, "sched-1", dto));

      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        "sched-1",
        expect.objectContaining({ nextRunAt: undefined, active: false }),
      );
    });

    it("404s (IDOR-safe) when a non-'all'-scope caller updates someone else's schedule", async () => {
      repo.findById.mockResolvedValue(baseRow({ createdById: "someone-else" }));
      const user = makeUser([{ key: "reports.schedule", scope: "own" }]);

      await runWithScope("own", async () => {
        await expect(service.update(TENANT_ID, user, "sched-1", {})).rejects.toThrow(NotFoundException);
      });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove() ────────────────────────────────────────────────────────────────

  describe("remove()", () => {
    it("soft-deletes and returns the row with active=false", async () => {
      const user = makeUser([{ key: "reports.schedule", scope: "all" }]);
      const result = await runWithScope("all", () => service.remove(TENANT_ID, user, "sched-1"));

      expect(repo.softDelete).toHaveBeenCalledWith("sched-1");
      expect(result.active).toBe(false);
    });

    it("404s (IDOR-safe) when a non-'all'-scope caller deletes someone else's schedule", async () => {
      repo.findById.mockResolvedValue(baseRow({ createdById: "someone-else" }));
      const user = makeUser([{ key: "reports.schedule", scope: "own" }]);

      await runWithScope("own", async () => {
        await expect(service.remove(TENANT_ID, user, "sched-1")).rejects.toThrow(NotFoundException);
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
