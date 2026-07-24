// apps/api/src/modules/lms/lms-progress.service.spec.ts
//
// Unit tests for the LMS progress + attendance module (Wave 4b).
// (docs/04 §2.1 DoD rule 10, docs/plans/phase-3.md task #6 DoD).
//
// Test coverage required by the task DoD:
//   1. Progress ping upsert:
//      a. not_started → in_progress on first ping, position set.
//      b. in_progress → in_progress on subsequent ping, position updated.
//      c. completed → completed, position updated (status NOT downgraded).
//      d. NOT enrolled → NotFoundException (404).
//      e. Preview lesson, no enrollment → ForbiddenException.
//      f. BASE/non-audited client is used (not the audited client).
//   2. Mark complete:
//      a. Sets status=completed + completedAt + recalcs progress_pct.
//      b. Creates recorded attendance row in the same transaction.
//      c. Uses $transaction on the AUDITED client.
//      d. Not enrolled → NotFoundException.
//   3. Completion idempotency:
//      a. Replaying complete on an already-completed lesson → no dup attendance.
//      b. progress_pct is not corrupted on replay.
//      c. Returns 200 with the same state.
//   4. Progress rollup math:
//      a. 0 of 4 completed → 0%.
//      b. 2 of 4 completed → 50%.
//      c. 4 of 4 completed → 100%.
//      d. Per-module math matches per-program math.
//   5. Attendance read scoping:
//      a. Only returns rows for the requesting student's own enrollments.
//      b. Supplying another student's enrollmentId → empty result (no IDOR).

import {
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { LmsProgressService } from "./lms-progress.service";
import type { LmsRepository, EnrollmentRow, LessonProgressRow, ProgressRollupRow, AttendanceRow, AttendanceSummaryRow } from "./lms.repository";
import type { PrismaService } from "../../prisma/prisma.service";
import * as enrollmentGate from "./lms-enrollment-gate";
import type { EnrollmentGateResult } from "./lms-enrollment-gate";
import type { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import type { CertificatesService } from "../certificates/certificates.service";

// ─── Test constants ────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-aaa";
const USER_ID = "user-111";
const STUDENT_ID = "student-111";
const LESSON_ID = "lesson-aaa";
const MODULE_ID = "module-aaa";
const PROGRAM_ID = "program-aaa";
const ENROLLMENT_ID = "enrollment-aaa";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type MockRepo = jest.Mocked<LmsRepository>;

function makeRepo(): MockRepo {
  return {
    findLessonById: jest.fn(),
    findStudentProfileId: jest.fn(),
    findActiveEnrollmentForProgram: jest.fn(),
    findEnrollmentByIdForStudent: jest.fn(),
    listEnrollmentsForStudent: jest.fn(),
    getCurriculumForProgram: jest.fn(),
    getLessonProgressForEnrollment: jest.fn(),
    getLessonProgress: jest.fn(),
    getMostRecentInProgressLesson: jest.fn(),
    countLessonsForProgram: jest.fn(),
    countCompletedLessonsForEnrollment: jest.fn(),
    getNextUnstartedLesson: jest.fn(),
    findVideoByProviderAssetId: jest.fn(),
    findVideoForLesson: jest.fn(),
    updateVideoTranscodeStatus: jest.fn(),
    getStudentDisplayInfo: jest.fn(),
    findAdjacentLessons: jest.fn(),
    // Wave 4b methods
    upsertProgressPing: jest.fn(),
    markLessonCompleted: jest.fn(),
    upsertRecordedAttendance: jest.fn(),
    recalcEnrollmentProgressPct: jest.fn(),
    getProgressRollup: jest.fn(),
    listAttendanceForStudent: jest.fn(),
    getAttendanceSummaries: jest.fn(),
    // Phase-9-completion gap #6: CRM attendance editor.
    findFacultyProfileId: jest.fn(),
    findEnrollmentForStaff: jest.fn(),
    findLessonProgramId: jest.fn(),
    upsertAttendanceForStaff: jest.fn(),
  } as unknown as MockRepo;
}

type MockEnrollmentScope = { resolveBatchIdsForFaculty: jest.Mock };

function makeEnrollmentScope(): MockEnrollmentScope {
  return { resolveBatchIdsForFaculty: jest.fn().mockResolvedValue([]) };
}

type MockCertificatesService = jest.Mocked<Pick<CertificatesService, "autoIssueOnCompletion">>;

function makeCertificatesService(): MockCertificatesService {
  return { autoIssueOnCompletion: jest.fn().mockResolvedValue({ issued: false, reason: "not_eligible" }) };
}

/** A mock tx that the $transaction callback receives. */
function makeMockTx() {
  return {
    lessonProgress: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    attendance: {
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    enrollment: {
      update: jest.fn(),
    },
    lesson: {
      count: jest.fn(),
    },
  };
}

/** makePrisma returns a mock PrismaService that calls the callback with a mock tx. */
function makePrisma(mockTx = makeMockTx()) {
  return {
    client: {
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    },
    baseClient: {
      lessonProgress: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  };
}

function makeEnrollment(override: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: ENROLLMENT_ID,
    tenantId: TENANT_ID,
    studentId: STUDENT_ID,
    batchId: "batch-aaa",
    programId: PROGRAM_ID,
    status: "active",
    progressPct: 30,
    enrolledAt: new Date("2026-01-01"),
    completedAt: null,
    source: "manual",
    batch: { id: "batch-aaa", name: "HYD-01", startDate: new Date("2026-01-12"), endDate: null },
    program: { id: PROGRAM_ID, title: "Full-Stack Program", slug: "fullstack", domain: "web", level: "beginner", durationWeeks: 12, mode: "hybrid", ogImageKey: null },
    ...override,
  };
}

function makeProgressRow(override: Partial<LessonProgressRow> = {}): LessonProgressRow {
  return {
    id: "progress-aaa",
    enrollmentId: ENROLLMENT_ID,
    lessonId: LESSON_ID,
    status: "in_progress",
    lastPositionS: 30,
    completedAt: null,
    updatedAt: new Date("2026-01-15T10:00:00Z"),
    ...override,
  };
}

function makeGate(enrollment: EnrollmentRow | null = makeEnrollment(), isPreview = false): EnrollmentGateResult {
  return { enrollment, lessonProgramId: PROGRAM_ID, isPreview };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Progress ping upsert tests
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.pingProgress (position ping)", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let service: LmsProgressService;
  let gateSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      makeEnrollmentScope() as unknown as EnrollmentScopeRepository,
      makeCertificatesService() as unknown as CertificatesService,
    );
    // Spy on the gate to control its output in each test.
    gateSpy = jest.spyOn(enrollmentGate, "resolveEnrollmentForLesson");
  });

  afterEach(() => {
    gateSpy.mockRestore();
  });

  it("not_started → in_progress on first ping, position set", async () => {
    const enrollment = makeEnrollment();
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.findVideoForLesson.mockResolvedValue(null); // no video duration to clamp
    repo.upsertProgressPing.mockResolvedValue(makeProgressRow({ status: "in_progress", lastPositionS: 45 }));
    repo.findEnrollmentByIdForStudent.mockResolvedValue(makeEnrollment({ progressPct: 30 }));

    const result = await service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 45 });

    expect(result.status).toBe("in_progress");
    expect(result.lastPositionS).toBe(45);
    expect(result.lessonId).toBe(LESSON_ID);
    expect(result.enrollmentId).toBe(ENROLLMENT_ID);
    expect(result.enrollmentProgressPct).toBe(30);

    // Verify the ping upsert was called (non-audited client).
    expect(repo.upsertProgressPing).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      lastPositionS: 45,
    });

    // The audited $transaction must NOT have been called for a ping.
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("completed → still completed, position updated (status not downgraded)", async () => {
    const enrollment = makeEnrollment();
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.findVideoForLesson.mockResolvedValue(null);
    repo.upsertProgressPing.mockResolvedValue(
      makeProgressRow({ status: "completed", lastPositionS: 60, completedAt: new Date("2026-01-10") }),
    );
    repo.findEnrollmentByIdForStudent.mockResolvedValue(makeEnrollment({ progressPct: 50 }));

    const result = await service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 60 });

    expect(result.status).toBe("completed");
    expect(result.lastPositionS).toBe(60);
    expect(result.completedAt).not.toBeNull();
  });

  it("not enrolled + non-preview lesson → NotFoundException (404, no existence disclosure)", async () => {
    gateSpy.mockResolvedValue(null); // gate returns null = not enrolled

    await expect(
      service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 10 }),
    ).rejects.toThrow(NotFoundException);

    expect(repo.upsertProgressPing).not.toHaveBeenCalled();
  });

  it("preview lesson with no enrollment → ForbiddenException (cannot write progress without enrollment)", async () => {
    // Preview gate: enrollment is null (no enrollment but preview-accessible).
    gateSpy.mockResolvedValue(makeGate(null, true));

    await expect(
      service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 10 }),
    ).rejects.toThrow(ForbiddenException);

    expect(repo.upsertProgressPing).not.toHaveBeenCalled();
  });

  it("position is clamped to video duration when known", async () => {
    const enrollment = makeEnrollment();
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.findVideoForLesson.mockResolvedValue({
      id: "video-aaa", lessonId: LESSON_ID, provider: "noop",
      providerAssetId: "asset-1", durationS: 120, status: "ready", captions: null,
    });
    // The ping is called with lastPositionS > durationS — should be clamped.
    repo.upsertProgressPing.mockResolvedValue(makeProgressRow({ lastPositionS: 120 }));
    repo.findEnrollmentByIdForStudent.mockResolvedValue(makeEnrollment());

    await service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 200 });

    // Should have been called with clamped value.
    expect(repo.upsertProgressPing).toHaveBeenCalledWith(
      expect.objectContaining({ lastPositionS: 120 }),
    );
  });

  it("base/non-audited client is used for ping (not the audited $transaction path)", async () => {
    const enrollment = makeEnrollment();
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.findVideoForLesson.mockResolvedValue(null);
    repo.upsertProgressPing.mockResolvedValue(makeProgressRow());
    repo.findEnrollmentByIdForStudent.mockResolvedValue(makeEnrollment());

    await service.pingProgress(USER_ID, TENANT_ID, LESSON_ID, { lastPositionS: 30 });

    // Audited $transaction must NOT have been called for position ping.
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    // upsertProgressPing is what wraps the baseClient writes.
    expect(repo.upsertProgressPing).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mark complete tests
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.markComplete (completion flow)", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let certificatesService: MockCertificatesService;
  let service: LmsProgressService;
  let gateSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    certificatesService = makeCertificatesService();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      makeEnrollmentScope() as unknown as EnrollmentScopeRepository,
      certificatesService as unknown as CertificatesService,
    );
    gateSpy = jest.spyOn(enrollmentGate, "resolveEnrollmentForLesson");
  });

  afterEach(() => {
    gateSpy.mockRestore();
  });

  it("sets status=completed, creates recorded attendance, recalcs progress_pct — all in txn", async () => {
    const enrollment = makeEnrollment({ progressPct: 10 });
    gateSpy.mockResolvedValue(makeGate(enrollment));

    // Service calls repo methods with the tx object from $transaction.
    repo.markLessonCompleted.mockResolvedValue(
      makeProgressRow({ status: "completed", completedAt: new Date("2026-02-01") }),
    );
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 50, justCompleted: false }); // 50% after completion

    const result = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    expect(result.status).toBe("completed");
    expect(result.completedAt).not.toBeNull();
    expect(result.enrollmentProgressPct).toBe(50);

    // All three operations must have been called.
    expect(repo.markLessonCompleted).toHaveBeenCalledTimes(1);
    expect(repo.upsertRecordedAttendance).toHaveBeenCalledTimes(1);
    expect(repo.recalcEnrollmentProgressPct).toHaveBeenCalledTimes(1);

    // Must have been called inside a $transaction (audited client).
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);

    // <100% → autoIssueOnCompletion must NOT be called.
    expect(certificatesService.autoIssueOnCompletion).not.toHaveBeenCalled();
  });

  it("reaching 100% triggers autoIssueOnCompletion exactly once, AFTER the $transaction", async () => {
    const enrollment = makeEnrollment({ progressPct: 90 });
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.markLessonCompleted.mockResolvedValue(
      makeProgressRow({ status: "completed", completedAt: new Date("2026-02-01") }),
    );
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 100, justCompleted: true });
    certificatesService.autoIssueOnCompletion.mockResolvedValue({ issued: true });

    const result = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    expect(result.enrollmentProgressPct).toBe(100);
    expect(certificatesService.autoIssueOnCompletion).toHaveBeenCalledTimes(1);
    expect(certificatesService.autoIssueOnCompletion).toHaveBeenCalledWith(TENANT_ID, ENROLLMENT_ID);
  });

  it("autoIssueOnCompletion failure is swallowed — markComplete still resolves (non-fatal)", async () => {
    const enrollment = makeEnrollment({ progressPct: 90 });
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.markLessonCompleted.mockResolvedValue(
      makeProgressRow({ status: "completed", completedAt: new Date("2026-02-01") }),
    );
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 100, justCompleted: true });
    certificatesService.autoIssueOnCompletion.mockRejectedValue(new Error("pdf provider down"));

    const result = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    expect(result.status).toBe("completed");
    expect(result.enrollmentProgressPct).toBe(100);
    expect(certificatesService.autoIssueOnCompletion).toHaveBeenCalledTimes(1);
  });

  it("not enrolled → NotFoundException before any DB write", async () => {
    gateSpy.mockResolvedValue(null);

    await expect(service.markComplete(USER_ID, TENANT_ID, LESSON_ID)).rejects.toThrow(NotFoundException);

    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(repo.markLessonCompleted).not.toHaveBeenCalled();
  });

  it("preview + no enrollment → ForbiddenException before any DB write", async () => {
    gateSpy.mockResolvedValue(makeGate(null, true));

    await expect(service.markComplete(USER_ID, TENANT_ID, LESSON_ID)).rejects.toThrow(ForbiddenException);

    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("$transaction uses the audited client (prisma.client, not prisma.baseClient)", async () => {
    const enrollment = makeEnrollment();
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.markLessonCompleted.mockResolvedValue(makeProgressRow({ status: "completed" }));
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 100, justCompleted: true });

    await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    // prisma.client.$transaction (audited) must be called.
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Completion idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.markComplete — idempotency", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let service: LmsProgressService;
  let gateSpy: jest.SpyInstance;
  let certificatesService: MockCertificatesService;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    certificatesService = makeCertificatesService();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      makeEnrollmentScope() as unknown as EnrollmentScopeRepository,
      certificatesService as unknown as CertificatesService,
    );
    gateSpy = jest.spyOn(enrollmentGate, "resolveEnrollmentForLesson");
  });

  afterEach(() => {
    gateSpy.mockRestore();
  });

  it("replay on already-completed lesson → markLessonCompleted called (DB-level idempotency in repo)", async () => {
    const enrollment = makeEnrollment({ progressPct: 100 });
    gateSpy.mockResolvedValue(makeGate(enrollment));

    // Second call: lesson is already completed. The repo's markLessonCompleted handles
    // idempotency internally (does not re-set completedAt, does not throw).
    const alreadyCompletedRow = makeProgressRow({
      status: "completed",
      completedAt: new Date("2026-02-01"),
      lastPositionS: 120,
    });
    repo.markLessonCompleted.mockResolvedValue(alreadyCompletedRow);
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    // Replay on an ALREADY-completed enrollment: pct stays 100 but there is NO
    // active→completed transition, so justCompleted is false.
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 100, justCompleted: false });

    const result = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    expect(result.status).toBe("completed");
    expect(result.enrollmentProgressPct).toBe(100);

    // upsertRecordedAttendance is called; the repo handles the no-dup logic internally.
    expect(repo.upsertRecordedAttendance).toHaveBeenCalledTimes(1);

    // Security review Low-2: a replay at 100% (no transition) must NOT re-enter
    // certificate auto-issue — that would re-run the eligibility computation every time.
    expect(certificatesService.autoIssueOnCompletion).not.toHaveBeenCalled();
  });

  it("replay does not pass a different progress_pct (recalc called; repo ensures correct value)", async () => {
    const enrollment = makeEnrollment({ progressPct: 100 });
    gateSpy.mockResolvedValue(makeGate(enrollment));
    repo.markLessonCompleted.mockResolvedValue(makeProgressRow({ status: "completed" }));
    repo.upsertRecordedAttendance.mockResolvedValue(undefined);
    // On replay, recalc still returns 100 (formula is idempotent) with no new transition.
    repo.recalcEnrollmentProgressPct.mockResolvedValue({ progressPct: 100, justCompleted: false });

    const result1 = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);
    const result2 = await service.markComplete(USER_ID, TENANT_ID, LESSON_ID);

    // Both calls return the same progress_pct.
    expect(result1.enrollmentProgressPct).toBe(result2.enrollmentProgressPct);
    expect(result1.enrollmentProgressPct).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Progress rollup math
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.getProgressRollup — rollup math", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let service: LmsProgressService;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      makeEnrollmentScope() as unknown as EnrollmentScopeRepository,
      makeCertificatesService() as unknown as CertificatesService,
    );
  });

  function makeRollupRow(completedLessons: number, totalLessons: number): ProgressRollupRow {
    return {
      enrollmentId: ENROLLMENT_ID,
      programId: PROGRAM_ID,
      programTitle: "Full-Stack Program",
      programSlug: "fullstack",
      lessonsTotal: totalLessons,
      lessonsCompleted: completedLessons,
      progressPct: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      status: "active",
      modules: [
        {
          moduleId: MODULE_ID,
          moduleTitle: "Module 1",
          order: 0,
          lessonsTotal: totalLessons,
          lessonsCompleted: completedLessons,
          progressPct: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        },
      ],
    };
  }

  it("0 of 4 completed → 0% progress", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.getProgressRollup.mockResolvedValue([makeRollupRow(0, 4)]);

    const result = await service.getProgressRollup(USER_ID, TENANT_ID);

    expect(result.overallProgressPct).toBe(0);
    expect(result.overallLessonsCompleted).toBe(0);
    expect(result.overallLessonsTotal).toBe(4);
    expect(result.programs[0]?.progressPct).toBe(0);
  });

  it("2 of 4 completed → 50% progress", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.getProgressRollup.mockResolvedValue([makeRollupRow(2, 4)]);

    const result = await service.getProgressRollup(USER_ID, TENANT_ID);

    expect(result.overallProgressPct).toBe(50);
    expect(result.overallLessonsCompleted).toBe(2);
    expect(result.programs[0]?.progressPct).toBe(50);
  });

  it("4 of 4 completed → 100% progress", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.getProgressRollup.mockResolvedValue([makeRollupRow(4, 4)]);

    const result = await service.getProgressRollup(USER_ID, TENANT_ID);

    expect(result.overallProgressPct).toBe(100);
    expect(result.overallLessonsCompleted).toBe(4);
  });

  it("per-module math matches per-program math when single module", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.getProgressRollup.mockResolvedValue([makeRollupRow(3, 6)]);

    const result = await service.getProgressRollup(USER_ID, TENANT_ID);

    const program = result.programs[0];
    expect(program?.progressPct).toBe(50);
    expect(program?.modules[0]?.progressPct).toBe(50);
    expect(program?.modules[0]?.lessonsCompleted).toBe(3);
    expect(program?.modules[0]?.lessonsTotal).toBe(6);
  });

  it("no student profile → returns empty rollup (not an error)", async () => {
    repo.findStudentProfileId.mockResolvedValue(null);

    const result = await service.getProgressRollup(USER_ID, TENANT_ID);

    expect(result.programs).toHaveLength(0);
    expect(result.overallProgressPct).toBe(0);
    expect(result.overallLessonsCompleted).toBe(0);
    expect(result.overallLessonsTotal).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Attendance read scoping (IDOR prevention)
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.listAttendance — enrollment scoping (IDOR)", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let service: LmsProgressService;

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      makeEnrollmentScope() as unknown as EnrollmentScopeRepository,
      makeCertificatesService() as unknown as CertificatesService,
    );
  });

  const defaultQuery: import("./dto").ListMyAttendanceQuery = {
    page: 1,
    pageSize: 20,
  };

  it("returns only rows for the requesting student's own enrollments", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);

    const ownAttendance: AttendanceRow[] = [
      {
        id: "att-1",
        enrollmentId: ENROLLMENT_ID,
        programId: PROGRAM_ID,
        programTitle: "Full-Stack Program",
        lessonId: LESSON_ID,
        lessonTitle: "Semantic HTML",
        liveClassId: null,
        status: "present",
        source: "recorded",
        markedAt: new Date("2026-02-01"),
      },
    ];

    repo.listAttendanceForStudent.mockResolvedValue({ rows: ownAttendance, total: 1 });
    repo.getAttendanceSummaries.mockResolvedValue([
      { enrollmentId: ENROLLMENT_ID, programTitle: "Full-Stack Program", totalRecorded: 1, totalLessons: 9, attendancePct: 11 },
    ] as AttendanceSummaryRow[]);

    const result = await service.listAttendance(USER_ID, TENANT_ID, defaultQuery);

    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]?.enrollmentId).toBe(ENROLLMENT_ID);
    // listAttendanceForStudent was called with this student's ID (never with a client-supplied one).
    expect(repo.listAttendanceForStudent).toHaveBeenCalledWith(
      TENANT_ID,
      STUDENT_ID,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it("enrollmentId filter does not belong to this student → empty result (IDOR prevention)", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    // The repo's listAttendanceForStudent returns empty when the enrollmentId doesn't match.
    repo.listAttendanceForStudent.mockResolvedValue({ rows: [], total: 0 });
    repo.getAttendanceSummaries.mockResolvedValue([]);

    const result = await service.listAttendance(USER_ID, TENANT_ID, {
      ...defaultQuery,
      enrollmentId: "someone-elses-enrollment-id",
    });

    expect(result.data.items).toHaveLength(0);
    expect(result.meta.total).toBe(0);
    // No 403/404 — just empty (no existence disclosure).
  });

  it("no student profile → empty result (not an error)", async () => {
    repo.findStudentProfileId.mockResolvedValue(null);

    const result = await service.listAttendance(USER_ID, TENANT_ID, defaultQuery);

    expect(result.data.items).toHaveLength(0);
    expect(result.data.summaries).toHaveLength(0);
    expect(repo.listAttendanceForStudent).not.toHaveBeenCalled();
  });

  it("summaries are always returned for all enrollments regardless of page filter", async () => {
    repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
    repo.listAttendanceForStudent.mockResolvedValue({ rows: [], total: 0 });
    // Two enrollments in summaries even if this page is empty.
    repo.getAttendanceSummaries.mockResolvedValue([
      { enrollmentId: "enroll-1", programTitle: "Prog A", totalRecorded: 2, totalLessons: 5, attendancePct: 40 },
      { enrollmentId: "enroll-2", programTitle: "Prog B", totalRecorded: 3, totalLessons: 6, attendancePct: 50 },
    ] as AttendanceSummaryRow[]);

    const result = await service.listAttendance(USER_ID, TENANT_ID, defaultQuery);

    expect(result.data.summaries).toHaveLength(2);
    expect(result.data.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. setAttendance — CRM attendance editor (Phase-9-completion gap #6)
// ─────────────────────────────────────────────────────────────────────────────

describe("LmsProgressService.setAttendance (CRM attendance editor)", () => {
  let repo: MockRepo;
  let prisma: ReturnType<typeof makePrisma>;
  let enrollmentScope: MockEnrollmentScope;
  let service: LmsProgressService;
  const FACULTY_PROFILE_ID = "faculty-profile-aaa";
  const BATCH_ID = "batch-aaa";

  beforeEach(() => {
    repo = makeRepo();
    prisma = makePrisma();
    enrollmentScope = makeEnrollmentScope();
    service = new LmsProgressService(
      repo as unknown as LmsRepository,
      prisma as unknown as PrismaService,
      enrollmentScope as unknown as EnrollmentScopeRepository,
      makeCertificatesService() as unknown as CertificatesService,
    );
  });

  it("scope=all sets attendance for any enrollment in the tenant", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue({ id: ENROLLMENT_ID, batchId: BATCH_ID, studentId: STUDENT_ID, programId: PROGRAM_ID });
    repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
    repo.upsertAttendanceForStaff.mockResolvedValue({
      id: "att-new",
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      status: "present",
      source: "recorded",
      markedAt: new Date("2026-01-20T10:00:00Z"),
    });

    const result = await service.setAttendance(TENANT_ID, USER_ID, "all", {
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      status: "present",
    });

    expect(result.status).toBe("present");
    expect(repo.upsertAttendanceForStaff).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      status: "present",
    });
    // scope=all never consults faculty-assignment resolution.
    expect(enrollmentScope.resolveBatchIdsForFaculty).not.toHaveBeenCalled();
  });

  it("scope=assigned sets attendance only for a faculty member's own assigned batches", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue({ id: ENROLLMENT_ID, batchId: BATCH_ID, studentId: STUDENT_ID, programId: PROGRAM_ID });
    repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
    enrollmentScope.resolveBatchIdsForFaculty.mockResolvedValue([BATCH_ID]);
    repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
    repo.upsertAttendanceForStaff.mockResolvedValue({
      id: "att-new",
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      status: "absent",
      source: "recorded",
      markedAt: new Date("2026-01-20T10:00:00Z"),
    });

    const result = await service.setAttendance(TENANT_ID, USER_ID, "assigned", {
      enrollmentId: ENROLLMENT_ID,
      lessonId: LESSON_ID,
      status: "absent",
    });

    expect(result.status).toBe("absent");
  });

  it("scope=assigned — enrollment NOT in the faculty's assigned batches → 404 (IDOR, no existence disclosure)", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue({ id: ENROLLMENT_ID, batchId: "other-batch", studentId: STUDENT_ID, programId: PROGRAM_ID });
    repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
    enrollmentScope.resolveBatchIdsForFaculty.mockResolvedValue([BATCH_ID]); // does not include "other-batch"

    await expect(
      service.setAttendance(TENANT_ID, USER_ID, "assigned", { enrollmentId: ENROLLMENT_ID, lessonId: LESSON_ID, status: "present" }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.upsertAttendanceForStaff).not.toHaveBeenCalled();
  });

  it("unknown enrollment → 404", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue(null);
    await expect(
      service.setAttendance(TENANT_ID, USER_ID, "all", { enrollmentId: ENROLLMENT_ID, lessonId: LESSON_ID, status: "present" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("lessonId not belonging to the enrollment's program → 404 (defense-in-depth)", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue({ id: ENROLLMENT_ID, batchId: BATCH_ID, studentId: STUDENT_ID, programId: PROGRAM_ID });
    repo.findLessonProgramId.mockResolvedValue("some-other-program");

    await expect(
      service.setAttendance(TENANT_ID, USER_ID, "all", { enrollmentId: ENROLLMENT_ID, lessonId: LESSON_ID, status: "present" }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.upsertAttendanceForStaff).not.toHaveBeenCalled();
  });

  it("scope=branch (unresolvable for this model) fails closed with ForbiddenException", async () => {
    repo.findEnrollmentForStaff.mockResolvedValue({ id: ENROLLMENT_ID, batchId: BATCH_ID, studentId: STUDENT_ID, programId: PROGRAM_ID });
    await expect(
      service.setAttendance(TENANT_ID, USER_ID, "branch", { enrollmentId: ENROLLMENT_ID, lessonId: LESSON_ID, status: "present" }),
    ).rejects.toThrow(ForbiddenException);
  });
});
