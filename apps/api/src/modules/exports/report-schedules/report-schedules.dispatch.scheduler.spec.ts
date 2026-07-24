// apps/api/src/modules/exports/report-schedules/report-schedules.dispatch.scheduler.spec.ts
//
// Unit tests for ReportScheduleDispatchScheduler (docs/plans/phase-7.md Wave 2 task #11,
// docs/specs/phase-7-analytics-hardening.md AC-37/38/39).
//
// Coverage (per the backend-builder DoD):
//   - CRITICAL test-safety: onModuleInit() gated exactly like AnalyticsMvRefreshScheduler.
//   - due-schedule selection: dispatchDueSchedules() scans via repo.findDueCandidates and
//     processes every candidate.
//   - idempotent single-fire: claimDueSchedule()=false -> the row is skipped entirely
//     (no permission lookup, no export, no send).
//   - AC-37 HEADLINE: a creator who lost `reports.export` (or the domain view permission)
//     does NOT send — the schedule is deactivated instead, and ExportsService.create/
//     MailProvider.send are NEVER called.
//   - AC-37 scope re-evaluation: the scope context ExportsService.create() observes is
//     built from the creator's CURRENT (freshly-fetched) `reports.export` grant, not a
//     value cached anywhere on the schedule row.
//   - AC-39: a zero-row export still sends, recorded as 'sent_no_data'.
//   - Suppressed recipient: mail.send is never called; recorded as 'skipped_suppressed'.
//   - AC-38: a mail-send failure is recorded ('failed') and logged, never silently dropped.

import type { SchedulerRegistry } from "@nestjs/schedule";
import { ReportScheduleDispatchScheduler } from "./report-schedules.dispatch.scheduler";
import type { ReportSchedulesRepository, ReportScheduleRow } from "./report-schedules.repository";
import type { AuthRepository } from "../../auth/auth.repository";
import type { NotificationsRepository } from "../../notifications/notifications.repository";
import type { MailProvider } from "../../notifications/providers/mail/mail-provider.interface";
import type { ExportsService } from "../exports.service";
import type { ExportJobDto } from "@repo/types";
import { requireScopeContext } from "../../auth/lib/scope-context";
import { __resetEnvCacheForTests } from "../../../config/env";
import { setMinimalEnv } from "../../../common/testing/minimal-env";

const ORIGINAL_ENV = { ...process.env };

function baseSchedule(overrides: Partial<ReportScheduleRow> = {}): ReportScheduleRow {
  return {
    id: "sched-1",
    tenantId: "tenant-1",
    createdById: "creator-1",
    createdByName: "Creator One",
    type: "revenue",
    format: "csv",
    params: { from: "2026-06-01", to: "2026-06-30" },
    frequency: "weekly",
    recipientEmail: null,
    active: true,
    nextRunAt: new Date("2026-07-04T09:00:00.000Z"),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date("2026-06-01T09:00:00.000Z"),
    ...overrides,
  } as ReportScheduleRow;
}

function succeededExportJob(overrides: Partial<ExportJobDto> = {}): ExportJobDto {
  return {
    id: "job-1",
    type: "revenue",
    format: "csv",
    status: "succeeded",
    rowCount: 3,
    downloadUrl: "https://signed.example.com/exports/job-1.csv",
    downloadUrlExpiresAt: "2026-07-04T09:05:00.000Z",
    error: null,
    requestedByName: "Creator One",
    requestedAt: "2026-07-04T09:00:00.000Z",
    completedAt: "2026-07-04T09:00:01.000Z",
    ...overrides,
  };
}

function makeSchedulerRegistry(): jest.Mocked<Pick<SchedulerRegistry, "addInterval" | "doesExist" | "deleteInterval">> {
  return { addInterval: jest.fn(), doesExist: jest.fn().mockReturnValue(false), deleteInterval: jest.fn() };
}

describe("ReportScheduleDispatchScheduler", () => {
  let repo: jest.Mocked<
    Pick<
      ReportSchedulesRepository,
      "findDueCandidates" | "claimDueSchedule" | "recordRunOutcome" | "deactivate"
    >
  >;
  let authRepository: jest.Mocked<Pick<AuthRepository, "getRbacProfile" | "findUserById">>;
  let notificationsRepository: jest.Mocked<Pick<NotificationsRepository, "isSuppressed">>;
  let exportsService: jest.Mocked<Pick<ExportsService, "create">>;
  let mail: jest.Mocked<Pick<MailProvider, "send">>;
  let registry: ReturnType<typeof makeSchedulerRegistry>;
  let scheduler: ReportScheduleDispatchScheduler;

  const NOW = new Date("2026-07-04T09:00:05.000Z");

  beforeEach(() => {
    repo = {
      findDueCandidates: jest.fn().mockResolvedValue([]),
      claimDueSchedule: jest.fn().mockResolvedValue(true),
      recordRunOutcome: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    };
    authRepository = {
      getRbacProfile: jest.fn().mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [
          { key: "reports.export", scope: "branch" },
          { key: "reports.revenue.view", scope: "branch" },
        ],
      }),
      findUserById: jest.fn().mockResolvedValue({ email: "creator@stimuliiq.test" }),
    } as never;
    notificationsRepository = { isSuppressed: jest.fn().mockResolvedValue(false) };
    exportsService = { create: jest.fn().mockResolvedValue(succeededExportJob()) };
    mail = { send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }) };
    registry = makeSchedulerRegistry();

    scheduler = new ReportScheduleDispatchScheduler(
      repo as unknown as ReportSchedulesRepository,
      authRepository as unknown as AuthRepository,
      notificationsRepository as unknown as NotificationsRepository,
      exportsService as unknown as ExportsService,
      mail as unknown as MailProvider,
      registry as unknown as SchedulerRegistry,
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  // ─── onModuleInit() — CRITICAL test-safety gate ─────────────────────────────

  describe("onModuleInit()", () => {
    it("does NOT register an interval when SCHEDULER_ENABLED=false", () => {
      __resetEnvCacheForTests();
      // qa-engineer Wave 5 (T41 item 1): validateEnv() requires DATABASE_URL/REDIS_URL/
      // JWT key paths/COOKIE_SECRET/CSRF_SECRET with NO schema default — without this,
      // the test only passed if some EARLIER spec in the same Jest worker had already
      // warmed the (now-just-reset) cache via ambient exported env vars. See
      // test/unit-mocks/minimal-env.ts's header for the full rationale.
      setMinimalEnv();
      process.env.SCHEDULER_ENABLED = "false";
      scheduler.onModuleInit();
      expect(registry.addInterval).not.toHaveBeenCalled();
    });

    it("DOES register an interval when SCHEDULER_ENABLED=true", () => {
      __resetEnvCacheForTests();
      setMinimalEnv();
      process.env.SCHEDULER_ENABLED = "true";
      scheduler.onModuleInit();
      expect(registry.addInterval).toHaveBeenCalledTimes(1);
      const [name, timer] = registry.addInterval.mock.calls[0]!;
      expect(name).toBe("report-schedule-dispatch");
      clearInterval(timer as NodeJS.Timeout);
    });
  });

  // ─── dispatchDueSchedules() — due-schedule selection ────────────────────────

  describe("dispatchDueSchedules()", () => {
    it("scans via findDueCandidates and processes every due row", async () => {
      const dueA = baseSchedule({ id: "sched-a" });
      const dueB = baseSchedule({ id: "sched-b" });
      repo.findDueCandidates.mockResolvedValue([dueA, dueB]);

      await scheduler.dispatchDueSchedules();

      expect(repo.claimDueSchedule).toHaveBeenCalledTimes(2);
      expect(repo.claimDueSchedule).toHaveBeenCalledWith("sched-a", dueA.nextRunAt, expect.any(Date), expect.any(Date));
      expect(repo.claimDueSchedule).toHaveBeenCalledWith("sched-b", dueB.nextRunAt, expect.any(Date), expect.any(Date));
    });

    it("one schedule throwing never blocks processing of the others", async () => {
      const dueA = baseSchedule({ id: "sched-a" });
      const dueB = baseSchedule({ id: "sched-b" });
      repo.findDueCandidates.mockResolvedValue([dueA, dueB]);
      repo.claimDueSchedule.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(true);

      await scheduler.dispatchDueSchedules();

      expect(repo.claimDueSchedule).toHaveBeenCalledTimes(2);
    });
  });

  // ─── processSchedule() — idempotent single-fire ─────────────────────────────

  describe("processSchedule() — idempotent single-fire", () => {
    it("skips entirely when claimDueSchedule loses the race (returns false)", async () => {
      repo.claimDueSchedule.mockResolvedValue(false);
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(authRepository.getRbacProfile).not.toHaveBeenCalled();
      expect(exportsService.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      expect(repo.recordRunOutcome).not.toHaveBeenCalled();
    });
  });

  // ─── processSchedule() — AC-37: scope re-evaluated at send time ────────────

  describe("processSchedule() — AC-37 scope re-evaluation", () => {
    it("does NOT send and deactivates the schedule when the creator lost reports.export", async () => {
      authRepository.getRbacProfile.mockResolvedValue({ roleKeys: [], permissions: [] });
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(exportsService.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      expect(repo.deactivate).toHaveBeenCalledWith("sched-1", expect.stringContaining("reports.export"));
      expect(repo.recordRunOutcome).not.toHaveBeenCalled();
    });

    it("does NOT send and deactivates the schedule when the creator lost the domain view permission", async () => {
      authRepository.getRbacProfile.mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [{ key: "reports.export", scope: "branch" }], // no reports.revenue.view
      });
      const schedule = baseSchedule({ type: "revenue" });

      await scheduler.processSchedule(schedule, NOW);

      expect(exportsService.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      expect(repo.deactivate).toHaveBeenCalledWith("sched-1", expect.stringContaining("reports.revenue.view"));
    });

    it("generates under the creator's CURRENT (freshly-fetched) reports.export scope, not a stale value", async () => {
      // Creator was moved to a DIFFERENT branch scope grant since schedule creation —
      // getRbacProfile is the ONLY source of truth this scheduler consults.
      authRepository.getRbacProfile.mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [
          { key: "reports.export", scope: "all" }, // e.g. promoted to finance/all-scope
          { key: "reports.revenue.view", scope: "all" },
        ],
      });
      let observedScope: string | undefined;
      exportsService.create.mockImplementation(async () => {
        observedScope = requireScopeContext().scope;
        return succeededExportJob();
      });

      const schedule = baseSchedule();
      await scheduler.processSchedule(schedule, NOW);

      expect(observedScope).toBe("all");
      expect(exportsService.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ id: "creator-1", tenantId: "tenant-1" }),
        expect.objectContaining({ type: "revenue", format: "csv" }),
      );
    });
  });

  // ─── processSchedule() — happy path + AC-39 zero-row + suppression + AC-38 ──

  describe("processSchedule() — send outcomes", () => {
    it("sends the report and records 'succeeded' on the happy path", async () => {
      const schedule = baseSchedule();
      await scheduler.processSchedule(schedule, NOW);

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "creator@stimuliiq.test" }),
      );
      expect(repo.recordRunOutcome).toHaveBeenCalledWith("sched-1", "succeeded", null);
    });

    it("resolves the recipient to recipientEmail when explicitly set (skips creator-email lookup)", async () => {
      const schedule = baseSchedule({ recipientEmail: "ops@stimuliiq.test" });
      await scheduler.processSchedule(schedule, NOW);

      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@stimuliiq.test" }));
    });

    it("AC-39: a zero-row export still sends, recorded as 'sent_no_data'", async () => {
      exportsService.create.mockResolvedValue(succeededExportJob({ rowCount: 0 }));
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(repo.recordRunOutcome).toHaveBeenCalledWith("sched-1", "sent_no_data", null);
    });

    it("honors recipient suppression — never sends, records 'skipped_suppressed'", async () => {
      notificationsRepository.isSuppressed.mockResolvedValue(true);
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(mail.send).not.toHaveBeenCalled();
      expect(repo.recordRunOutcome).toHaveBeenCalledWith("sched-1", "skipped_suppressed", null);
    });

    it("AC-38: a mail-send failure is recorded as 'failed', never silently dropped", async () => {
      mail.send.mockRejectedValue(new Error("Resend API unavailable"));
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(repo.recordRunOutcome).toHaveBeenCalledWith("sched-1", "failed", expect.any(String));
    });

    it("records 'failed' when ExportsService.create() itself reports a failed job", async () => {
      exportsService.create.mockResolvedValue(succeededExportJob({ status: "failed", error: "generation blew up" }));
      const schedule = baseSchedule();

      await scheduler.processSchedule(schedule, NOW);

      expect(mail.send).not.toHaveBeenCalled();
      expect(repo.recordRunOutcome).toHaveBeenCalledWith("sched-1", "failed", "generation blew up");
    });
  });
});
