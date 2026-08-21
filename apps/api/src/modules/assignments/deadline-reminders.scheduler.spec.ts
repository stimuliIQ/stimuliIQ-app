// apps/api/src/modules/assignments/deadline-reminders.scheduler.spec.ts
//
// Unit tests for DeadlineRemindersScheduler (Phase-9 Completion T31 / R3).
//
// Coverage:
//   - CRITICAL test-safety: onModuleInit() gated exactly like every other P7+ scheduler.
//   - scanAndNotify() scans the due-soon window and calls notifyDeadline for every
//     enrolled-not-yet-submitted recipient of every due-soon assignment.
//   - a notifyDeadline failure for one recipient does not block the rest of the batch.
//   - zero due-soon assignments -> no repository/notification calls beyond the scan.

import type { SchedulerRegistry } from "@nestjs/schedule";
import { DeadlineRemindersScheduler } from "./deadline-reminders.scheduler";
import type { AssignmentsRepository } from "./assignments.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import { __resetEnvCacheForTests } from "../../config/env";
import { setMinimalEnv } from "../../common/testing/minimal-env";

const ORIGINAL_ENV = { ...process.env };

function makeSchedulerRegistry(): jest.Mocked<Pick<SchedulerRegistry, "addInterval" | "doesExist" | "deleteInterval">> {
  return { addInterval: jest.fn(), doesExist: jest.fn().mockReturnValue(false), deleteInterval: jest.fn() };
}

describe("DeadlineRemindersScheduler", () => {
  let repo: jest.Mocked<
    Pick<AssignmentsRepository, "findAssignmentsDueInWindow" | "findEnrolledStudentsWithoutSubmission">
  >;
  let notifSvc: jest.Mocked<Pick<NotificationsService, "notifyDeadline">>;
  let registry: ReturnType<typeof makeSchedulerRegistry>;
  let scheduler: DeadlineRemindersScheduler;

  beforeEach(() => {
    repo = {
      findAssignmentsDueInWindow: jest.fn().mockResolvedValue([]),
      findEnrolledStudentsWithoutSubmission: jest.fn().mockResolvedValue([]),
    };
    notifSvc = { notifyDeadline: jest.fn().mockResolvedValue(undefined) };
    registry = makeSchedulerRegistry();

    // qa-engineer Wave 5 (docs/plans/phase-9-completion.md T41 item 1, cold-validateEnv
    // test-hygiene): scanAndNotify() (and onModuleInit()) call the REAL validateEnv(),
    // without this, every test here only passed if an earlier spec in the same Jest
    // worker had already warmed the cache via ambient exported env vars (DATABASE_URL
    // etc. have no schema default). See test/unit-mocks/minimal-env.ts's header.
    setMinimalEnv();

    scheduler = new DeadlineRemindersScheduler(
      repo as unknown as AssignmentsRepository,
      notifSvc as unknown as NotificationsService,
      registry as unknown as SchedulerRegistry,
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  describe("onModuleInit()", () => {
    it("does NOT register an interval when SCHEDULER_ENABLED=false", () => {
      __resetEnvCacheForTests();
      process.env.SCHEDULER_ENABLED = "false";
      scheduler.onModuleInit();
      expect(registry.addInterval).not.toHaveBeenCalled();
    });

    it("DOES register an interval when SCHEDULER_ENABLED=true", () => {
      __resetEnvCacheForTests();
      process.env.SCHEDULER_ENABLED = "true";
      scheduler.onModuleInit();
      expect(registry.addInterval).toHaveBeenCalledWith("deadline-reminders-scan", expect.anything());
    });
  });

  describe("scanAndNotify()", () => {
    it("does nothing when no assignments are due-soon", async () => {
      await scheduler.scanAndNotify();
      expect(repo.findEnrolledStudentsWithoutSubmission).not.toHaveBeenCalled();
      expect(notifSvc.notifyDeadline).not.toHaveBeenCalled();
    });

    it("fires notifyDeadline for every enrolled-not-yet-submitted recipient of a due-soon assignment", async () => {
      repo.findAssignmentsDueInWindow.mockResolvedValue([
        {
          id: "assign-1",
          tenantId: "tenant-1",
          title: "Build a REST API",
          dueAt: new Date("2026-07-10T10:00:00Z"),
          programId: "prog-1",
        },
      ]);
      repo.findEnrolledStudentsWithoutSubmission.mockResolvedValue([
        { studentId: "student-1", userId: "user-1", email: "a@test.com", phone: null, name: "Alice" },
        { studentId: "student-2", userId: "user-2", email: "b@test.com", phone: "+911234567890", name: "Bob" },
      ]);

      await scheduler.scanAndNotify();

      expect(repo.findEnrolledStudentsWithoutSubmission).toHaveBeenCalledWith("tenant-1", "prog-1", "assign-1");
      expect(notifSvc.notifyDeadline).toHaveBeenCalledTimes(2);
      expect(notifSvc.notifyDeadline).toHaveBeenCalledWith(
        "user-1",
        "tenant-1",
        {
          refType: "assignment",
          refId: "assign-1",
          title: "Build a REST API",
          dueAt: "2026-07-10T10:00:00.000Z",
        },
        { toEmail: "a@test.com", toPhone: undefined },
      );
    });

    it("continues the batch when notifyDeadline fails for one recipient", async () => {
      repo.findAssignmentsDueInWindow.mockResolvedValue([
        { id: "assign-1", tenantId: "tenant-1", title: "X", dueAt: new Date(), programId: "prog-1" },
      ]);
      repo.findEnrolledStudentsWithoutSubmission.mockResolvedValue([
        { studentId: "s1", userId: "u1", email: "a@test.com", phone: null, name: "A" },
        { studentId: "s2", userId: "u2", email: "b@test.com", phone: null, name: "B" },
      ]);
      notifSvc.notifyDeadline.mockRejectedValueOnce(new Error("mail provider down")).mockResolvedValueOnce(undefined);

      await scheduler.scanAndNotify();

      expect(notifSvc.notifyDeadline).toHaveBeenCalledTimes(2);
    });
  });
});
