// apps/api/src/modules/live-classes/live-classes.service.spec.ts
//
// Unit tests for LiveClassesService (docs/plans/phase-9-completion.md T20). Covers:
// scope resolution (all/branch/assigned/own -> repository restriction), IDOR->404 for a
// live class outside the caller's resolved scope, schedule() calling the provider +
// persisting + scheduling reminders, join() minting a scoped URL and writing the
// attendance row SYNCHRONOUSLY (the "<=60s of join" requirement) only for own-scope
// (student) callers, cancel() calling provider.endMeeting + cancelling reminders, and the
// provider-unavailable fail-closed path on schedule().

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { LiveClassesService } from "./live-classes.service";
import { LiveClassesRepository, type LiveClassRow } from "./live-classes.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { LiveClassProvider } from "../lms/providers/live-class/live-class-provider.interface";
import type { LiveClassReminderPort } from "./reminders/live-class-reminder.port";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<LiveClassesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByProviderMeetingId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    listCallerBranchIds: jest.fn().mockResolvedValue([]),
    findOwnFacultyProfileId: jest.fn().mockResolvedValue(null),
    findBatchForCreate: jest.fn(),
    userExists: jest.fn().mockResolvedValue(true),
    findUserContact: jest.fn().mockResolvedValue({ name: "Test User", email: "user@test.com" }),
    listBatchStudentRecipients: jest.fn().mockResolvedValue([]),
    findActiveEnrollmentForBatch: jest.fn(),
    findActiveEnrollmentForBatchByEmail: jest.fn(),
    upsertLiveAttendance: jest.fn().mockResolvedValue({ created: true }),
  } as unknown as Mocked<LiveClassesRepository>;
}

function mockScopeRepository(): Mocked<EnrollmentScopeRepository> {
  return {
    resolveStudentIdsForBranches: jest.fn(),
    resolveStudentIdsForFaculty: jest.fn(),
    resolveBatchIdsForFaculty: jest.fn().mockResolvedValue([]),
    resolveProgramIdsForFaculty: jest.fn(),
    resolveBatchIdsForMentor: jest.fn().mockResolvedValue([]),
    resolveBatchIdsForStudent: jest.fn().mockResolvedValue([]),
  } as unknown as Mocked<EnrollmentScopeRepository>;
}

function mockProvider(): Mocked<LiveClassProvider> {
  return {
    createMeeting: jest.fn().mockResolvedValue({ providerMeetingId: "zoom-123", provider: "zoom" }),
    getJoinUrl: jest.fn().mockResolvedValue({ url: "https://zoom.example/join/abc", expiresAt: new Date("2026-01-01T10:05:00Z") }),
    endMeeting: jest.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    parseRecordingEvent: jest.fn(),
  } as unknown as Mocked<LiveClassProvider>;
}

function mockReminders(): Mocked<LiveClassReminderPort> {
  return {
    scheduleReminders: jest.fn().mockResolvedValue(undefined),
    cancelReminders: jest.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<LiveClassReminderPort>;
}

const ROW: LiveClassRow = {
  id: "lc-1",
  tenantId: "tenant-1",
  batchId: "batch-1",
  batchName: "Batch A",
  branchId: "branch-1",
  programId: "program-1",
  programTitle: "Full Stack",
  title: "Week 3 — DSA",
  provider: "zoom",
  providerMeetingId: "zoom-123",
  joinUrl: null,
  startsAt: new Date("2026-01-01T10:00:00Z"),
  endsAt: new Date("2026-01-01T11:00:00Z"),
  status: "scheduled",
  recordingUrl: null,
  hostUserId: "faculty-user-1",
  hostName: "Prof. Rao",
  attendeeCount: 0,
  createdAt: new Date("2025-12-01T00:00:00Z"),
  updatedAt: new Date("2025-12-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "liveclass.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("LiveClassesService", () => {
  let service: LiveClassesService;
  let repo: Mocked<LiveClassesRepository>;
  let scopeRepo: Mocked<EnrollmentScopeRepository>;
  let provider: Mocked<LiveClassProvider>;
  let reminders: Mocked<LiveClassReminderPort>;

  beforeEach(() => {
    repo = mockRepository();
    scopeRepo = mockScopeRepository();
    provider = mockProvider();
    reminders = mockReminders();
    service = new LiveClassesService(
      repo as unknown as LiveClassesRepository,
      scopeRepo as unknown as EnrollmentScopeRepository,
      provider as unknown as LiveClassProvider,
      reminders as unknown as LiveClassReminderPort,
    );
  });

  describe("scope resolution + IDOR", () => {
    it("scope=all -> no restriction, row returned", async () => {
      repo.findById.mockResolvedValue(ROW);
      const result = await runWithScope("all", "admin-1", () => service.getById("tenant-1", "admin-1", "lc-1"));
      expect(result.id).toBe("lc-1");
    });

    it("scope=branch restricted to caller's branches -> 404 when live class's batch is in a different branch", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["some-other-branch"]);
      await expect(
        runWithScope("branch", "bm-1", () => service.getById("tenant-1", "bm-1", "lc-1")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("scope=assigned (faculty) restricted to their taught batches -> visible when batchId matches", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-profile-1");
      scopeRepo.resolveBatchIdsForFaculty.mockResolvedValue(["batch-1"]);
      const result = await runWithScope("assigned", "faculty-user-1", () =>
        service.getById("tenant-1", "faculty-user-1", "lc-1"),
      );
      expect(result.id).toBe("lc-1");
    });

    it("scope=assigned with no faculty/mentor profile -> fails closed (404, never 'all')", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findOwnFacultyProfileId.mockResolvedValue(null);
      scopeRepo.resolveBatchIdsForMentor.mockResolvedValue([]);
      await expect(
        runWithScope("assigned", "nobody-1", () => service.getById("tenant-1", "nobody-1", "lc-1")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("scope=own (student) restricted to their enrolled batches -> visible when enrolled in the batch", async () => {
      repo.findById.mockResolvedValue(ROW);
      scopeRepo.resolveBatchIdsForStudent.mockResolvedValue(["batch-1"]);
      const result = await runWithScope("own", "student-user-1", () =>
        service.getById("tenant-1", "student-user-1", "lc-1"),
      );
      expect(result.id).toBe("lc-1");
    });

    it("scope=own for a student NOT enrolled in the batch -> 404 (IDOR fail-closed)", async () => {
      repo.findById.mockResolvedValue(ROW);
      scopeRepo.resolveBatchIdsForStudent.mockResolvedValue(["some-other-batch"]);
      await expect(
        runWithScope("own", "student-user-2", () => service.getById("tenant-1", "student-user-2", "lc-1")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("schedule()", () => {
    const REQUEST = {
      batchId: "batch-1",
      title: "Week 3 — DSA",
      provider: "zoom" as const,
      startsAt: "2026-01-01T10:00:00.000Z",
      endsAt: "2026-01-01T11:00:00.000Z",
      hostUserId: "faculty-user-1",
    };

    it("branch scope cannot create a live class (only all|assigned may manage)", async () => {
      await expect(
        runWithScope("branch", "bm-1", () => service.schedule("tenant-1", "bm-1", REQUEST)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(provider.createMeeting).not.toHaveBeenCalled();
    });

    it("all scope: calls provider.createMeeting, persists the row, and schedules reminders", async () => {
      repo.findBatchForCreate.mockResolvedValue({ id: "batch-1", programId: "program-1", branchId: "branch-1" });
      repo.create.mockResolvedValue({ id: "lc-new" });
      repo.findById.mockResolvedValue({ ...ROW, id: "lc-new" });
      repo.listBatchStudentRecipients.mockResolvedValue([{ userId: "student-1", email: "s1@test.com" }]);

      const result = await runWithScope("all", "admin-1", () => service.schedule("tenant-1", "admin-1", REQUEST));

      expect(provider.createMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "Week 3 — DSA", hostUserId: "faculty-user-1" }),
      );
      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ batchId: "batch-1", providerMeetingId: "zoom-123" }),
      );
      expect(reminders.scheduleReminders).toHaveBeenCalledWith(
        expect.objectContaining({ liveClassId: "lc-new", offsetMinutes: 30 }),
      );
      expect(result.id).toBe("lc-new");
    });

    it("fails closed (503-equivalent ConflictException) when the provider throws — never persists a fabricated meeting", async () => {
      repo.findBatchForCreate.mockResolvedValue({ id: "batch-1", programId: "program-1", branchId: "branch-1" });
      provider.createMeeting.mockRejectedValue(new Error("Zoom API unreachable"));

      await expect(
        runWithScope("all", "admin-1", () => service.schedule("tenant-1", "admin-1", REQUEST)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("assigned-scope faculty scheduling for a batch outside their assignment -> 404 (not 403 — no existence leak)", async () => {
      repo.findBatchForCreate.mockResolvedValue({ id: "batch-1", programId: "program-1", branchId: "branch-1" });
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-profile-1");
      scopeRepo.resolveBatchIdsForFaculty.mockResolvedValue(["a-different-batch"]);

      await expect(
        runWithScope("assigned", "faculty-user-1", () => service.schedule("tenant-1", "faculty-user-1", REQUEST)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(provider.createMeeting).not.toHaveBeenCalled();
    });
  });

  describe("join() — attendance auto-sync (T20 '<=60s of join')", () => {
    it("own-scope (student) join writes the attendance row SYNCHRONOUSLY in the same call", async () => {
      repo.findById.mockResolvedValue(ROW);
      scopeRepo.resolveBatchIdsForStudent.mockResolvedValue(["batch-1"]);
      repo.findActiveEnrollmentForBatch.mockResolvedValue({ enrollmentId: "enr-1" });

      const before = Date.now();
      const result = await runWithScope("own", "student-user-1", () =>
        service.join("tenant-1", "student-user-1", "lc-1"),
      );
      const after = Date.now();

      expect(result.joinUrl).toBe("https://zoom.example/join/abc");
      expect(repo.upsertLiveAttendance).toHaveBeenCalledTimes(1);
      const call = repo.upsertLiveAttendance.mock.calls[0][0];
      expect(call.liveClassId).toBe("lc-1");
      expect(call.enrollmentId).toBe("enr-1");
      // The attendance write happened INLINE, in the same synchronous call — its
      // markedAt is bounded by the wall-clock window of this very test, trivially
      // satisfying "<=60s of join" (there is no queue/poll delay in the sync path).
      expect(call.markedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.markedAt.getTime()).toBeLessThanOrEqual(after);
      expect(after - before).toBeLessThan(60_000);
    });

    it("assigned-scope (faculty host) join does NOT write an attendance row (not a student)", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-profile-1");
      scopeRepo.resolveBatchIdsForFaculty.mockResolvedValue(["batch-1"]);

      await runWithScope("assigned", "faculty-user-1", () => service.join("tenant-1", "faculty-user-1", "lc-1"));

      expect(repo.upsertLiveAttendance).not.toHaveBeenCalled();
      // Host role passed through to the provider.
      expect(provider.getJoinUrl).toHaveBeenCalledWith(expect.objectContaining({ role: "host" }));
    });

    it("a cancelled live class cannot be joined", async () => {
      repo.findById.mockResolvedValue({ ...ROW, status: "cancelled" });
      scopeRepo.resolveBatchIdsForStudent.mockResolvedValue(["batch-1"]);
      await expect(
        runWithScope("own", "student-user-1", () => service.join("tenant-1", "student-user-1", "lc-1")),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("cancel()", () => {
    it("calls provider.endMeeting, marks status=cancelled, and cancels reminders", async () => {
      repo.findById
        .mockResolvedValueOnce(ROW)
        .mockResolvedValueOnce({ ...ROW, status: "cancelled" });
      repo.listBatchStudentRecipients.mockResolvedValue([{ userId: "student-1", email: "s1@test.com" }]);

      const result = await runWithScope("all", "admin-1", () => service.cancel("tenant-1", "admin-1", "lc-1"));

      expect(provider.endMeeting).toHaveBeenCalledWith({ providerMeetingId: "zoom-123" });
      expect(repo.update).toHaveBeenCalledWith("lc-1", { status: "cancelled" });
      expect(reminders.cancelReminders).toHaveBeenCalledWith("lc-1", expect.arrayContaining(["student-1", "faculty-user-1"]), 30);
      expect(result.status).toBe("cancelled");
    });

    it("cannot cancel an already-completed live class", async () => {
      repo.findById.mockResolvedValue({ ...ROW, status: "completed" });
      await expect(
        runWithScope("all", "admin-1", () => service.cancel("tenant-1", "admin-1", "lc-1")),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
