// apps/api/src/modules/assignments/assignments.service.spec.ts
//
// Unit tests for AssignmentsService (P4 Wave 4 task #6).
//
// Coverage:
//   1. Resubmit policy: blocks when allow_resubmit=false (AC-A5), blocks when
//      previous submission is still pending (edge case), allows when allow_resubmit=true
//      with previous graded (AC-A4).
//   2. Due-date enforcement: submission after due_at → 422 ASSIGNMENT_OVERDUE (AC-A2).
//   3. Faculty assigned-scope resolver: faculty who is not in the batch gets 404 (AC-B2);
//      faculty in the batch can grade (AC-B1).
//   4. Grade audit: gradeSubmission calls writeGradeAuditLog with before/after (AC-B3).
//   5. IDOR: student attempting to access assignment not in their enrolled program → 404 (AC-A3).
//   6. Signed file download URLs are minted from StorageProvider (never raw).

import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import type { AssignmentsRepository, AssignmentRow, SubmissionRow } from "./assignments.repository";
import type { NoopStorageProvider } from "../storage/providers/storage/noop-storage.provider";
import type { StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import type { NotificationsService } from "../notifications/notifications.service";
import type { StudentsRepository, StudentRow } from "../students/students.repository";

// ─── Test helpers ──────────────────────────────────────────────────────────────

type MockRepo = jest.Mocked<Pick<
  AssignmentsRepository,
  | "findFacultyProfileId"
  | "findStudentProfileId"
  | "findAssignedBatchIds"
  | "findAssignmentById"
  | "findAssignmentForEnrollment"
  | "findLatestSubmission"
  | "countSubmissions"
  | "createSubmission"
  | "findSubmissionById"
  | "gradeSubmission"
  | "returnSubmission"
  | "enableResubmission"
  | "writeGradeAuditLog"
  | "listSubmissionsForAssignment"
  | "findMilestone"
  | "getMilestoneSubmissions"
  | "getMilestoneSubmissionsForAssignment"
  | "listAssignmentsForStudent"
  | "listAssignments"
  | "createAssignment"
  | "createMilestones"
  | "updateAssignment"
  | "softDeleteAssignment"
  | "findEnrollmentById"
  | "findProgramIdsForBatches"
  | "isLessonInPrograms"
  | "findActiveEnrollmentsForStudent"
  | "findLessonProgramId"
>>;

function makeRepo(): MockRepo {
  return {
    findFacultyProfileId: jest.fn(),
    findStudentProfileId: jest.fn(),
    findAssignedBatchIds: jest.fn(),
    findAssignmentById: jest.fn(),
    findAssignmentForEnrollment: jest.fn(),
    findLatestSubmission: jest.fn(),
    countSubmissions: jest.fn(),
    createSubmission: jest.fn(),
    findSubmissionById: jest.fn(),
    gradeSubmission: jest.fn(),
    returnSubmission: jest.fn(),
    enableResubmission: jest.fn(),
    writeGradeAuditLog: jest.fn(),
    listSubmissionsForAssignment: jest.fn(),
    findMilestone: jest.fn(),
    getMilestoneSubmissions: jest.fn(),
    getMilestoneSubmissionsForAssignment: jest.fn(),
    listAssignmentsForStudent: jest.fn(),
    listAssignments: jest.fn(),
    createAssignment: jest.fn(),
    createMilestones: jest.fn(),
    updateAssignment: jest.fn(),
    softDeleteAssignment: jest.fn(),
    findEnrollmentById: jest.fn(),
    findProgramIdsForBatches: jest.fn(),
    isLessonInPrograms: jest.fn(),
    findActiveEnrollmentsForStudent: jest.fn(),
    findLessonProgramId: jest.fn(),
  } as unknown as MockRepo;
}

function makeStorage(): jest.Mocked<StorageProvider> {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      url: "https://noop.local/storage/upload/key?sig=noop&exp=9999999",
      storageKey: "submissions/t/e/file.pdf",
      expiresAt: new Date(Date.now() + 300_000),
      requiredHeaders: { "Content-Type": "application/pdf" },
    }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue({
      url: "https://noop.local/storage/download/key?sig=noop&exp=9999999",
      expiresAt: new Date(Date.now() + 300_000),
    }),
    putObject: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
    head: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
    getObject: jest.fn().mockResolvedValue({ body: Buffer.from("stub"), contentType: "application/pdf", size: 4 }),
  };
}

function makeNotifSvc(): jest.Mocked<Pick<NotificationsService, "notifyGradeReady" | "notifySubmissionReturned">> {
  return {
    notifyGradeReady: jest.fn().mockResolvedValue(undefined),
    notifySubmissionReturned: jest.fn().mockResolvedValue(undefined),
  };
}

function makeStudentsRepository(): jest.Mocked<Pick<StudentsRepository, "findById">> {
  return { findById: jest.fn() };
}

function makeStudentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "00000000-0000-0000-0000-000000000003",
    userId: "00000000-0000-0000-0000-000000000099",
    name: "Test Student",
    email: "student@test.com",
    phone: null,
    alternatePhone: null,
    college: null,
    courseType: "btech",
    year: 3,
    city: null,
    source: null,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const STUDENT_ID = "00000000-0000-0000-0000-000000000003";
const FACULTY_USER_ID = "00000000-0000-0000-0000-000000000004";
const FACULTY_PROFILE_ID = "00000000-0000-0000-0000-000000000005";
const ASSIGNMENT_ID = "00000000-0000-0000-0000-000000000010";
const ENROLLMENT_ID = "00000000-0000-0000-0000-000000000020";
const BATCH_ID = "00000000-0000-0000-0000-000000000030";
const SUBMISSION_ID = "00000000-0000-0000-0000-000000000040";
const PROGRAM_ID = "00000000-0000-0000-0000-000000000050";
const LESSON_ID = "00000000-0000-0000-0000-000000000060";

function makeAssignment(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: ASSIGNMENT_ID,
    tenantId: TENANT_ID,
    lessonId: LESSON_ID,
    lessonTitle: "Test Lesson",
    programId: PROGRAM_ID,
    programTitle: "Clinical Neurology",
    kind: "assignment",
    title: "Test Assignment",
    instructions: null,
    maxScore: 100,
    dueAt: null,
    allowResubmit: false,
    isFinal: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    milestones: [],
    submissionCount: 0,
    gradedCount: 0,
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: SUBMISSION_ID,
    tenantId: TENANT_ID,
    assignmentId: ASSIGNMENT_ID,
    assignmentTitle: "Test Assignment",
    assignmentMaxScore: 100,
    milestoneId: null,
    milestoneTitle: null,
    enrollmentId: ENROLLMENT_ID,
    studentId: STUDENT_ID,
    studentName: "Test Student",
    files: [],
    text: null,
    link: null,
    attemptNo: 1,
    status: "submitted",
    score: null,
    rubric: null,
    feedback: null,
    gradedById: null,
    gradedByName: null,
    gradedAt: null,
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
    batchId: BATCH_ID,
  batchName: "September 2026 Batch",
    batchFacultyId: FACULTY_PROFILE_ID,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AssignmentsService", () => {
  let service: AssignmentsService;
  let repo: MockRepo;
  let storage: jest.Mocked<StorageProvider>;
  let notifSvc: jest.Mocked<Pick<NotificationsService, "notifyGradeReady" | "notifySubmissionReturned">>;
  let studentsRepository: jest.Mocked<Pick<StudentsRepository, "findById">>;

  beforeEach(() => {
    repo = makeRepo();
    storage = makeStorage();
    notifSvc = makeNotifSvc();
    studentsRepository = makeStudentsRepository();
    studentsRepository.findById.mockResolvedValue(makeStudentRow());
    service = new AssignmentsService(
      repo as unknown as AssignmentsRepository,
      storage,
      notifSvc as unknown as NotificationsService,
      studentsRepository as unknown as StudentsRepository,
    );
  });

  // ─── 1. Resubmit policy ────────────────────────────────────────────────────

  describe("submitAssignment, resubmit policy", () => {
    const setupStudentEnrollment = () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: ENROLLMENT_ID, programId: PROGRAM_ID, batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
      repo.findAssignmentForEnrollment.mockResolvedValue(makeAssignment());
      repo.findAssignmentById.mockResolvedValue(makeAssignment());
    };

    it("AC-A5: blocks resubmit when allow_resubmit=false and submission exists", async () => {
      setupStudentEnrollment();
      repo.findLatestSubmission.mockResolvedValue(makeSubmission({ status: "graded" }));

      await expect(
        service.submitAssignment(USER_ID, TENANT_ID, ASSIGNMENT_ID, {
          files: ["key"],
        }),
      ).rejects.toThrow(ConflictException);

      const err = await service.submitAssignment(USER_ID, TENANT_ID, ASSIGNMENT_ID, {
        files: ["key"],
      }).catch((e: ConflictException) => e);
      // @ts-expect-error -- accessing NestJS exception response
      expect((err as ConflictException).getResponse()["code"]).toBe("RESUBMIT_NOT_ALLOWED");
    });

    it("edge case: blocks resubmit when previous submission is still pending (status=submitted)", async () => {
      setupStudentEnrollment();
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findAssignmentForEnrollment.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findLatestSubmission.mockResolvedValue(makeSubmission({ status: "submitted" }));

      const err = await service.submitAssignment(USER_ID, TENANT_ID, ASSIGNMENT_ID, {
        files: ["key"],
      }).catch((e) => e);
      // @ts-expect-error -- accessing NestJS exception response
      expect((err as ConflictException).getResponse()["code"]).toBe("PREVIOUS_SUBMISSION_PENDING");
    });

    it("AC-A4: allows resubmit when allow_resubmit=true and previous is graded", async () => {
      setupStudentEnrollment();
      const assignment = makeAssignment({ allowResubmit: true });
      repo.findAssignmentById.mockResolvedValue(assignment);
      repo.findAssignmentForEnrollment.mockResolvedValue(assignment);
      repo.findLatestSubmission.mockResolvedValue(makeSubmission({ status: "graded" }));
      repo.countSubmissions.mockResolvedValue(1);
      repo.createSubmission.mockResolvedValue("new-submission-id");
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ id: "new-submission-id", attemptNo: 2, status: "submitted" }));
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://noop.local", expiresAt: new Date() });

      const result = await service.submitAssignment(USER_ID, TENANT_ID, ASSIGNMENT_ID, {
        files: [],
        text: "my answer",
      });

      expect(repo.createSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ attemptNo: 2 }),
      );
      expect(result.status).toBe("submitted");
    });
  });

  // ─── 2. Due-date enforcement ───────────────────────────────────────────────

  describe("submitAssignment, due date", () => {
    it("AC-A2: returns 422 ASSIGNMENT_OVERDUE when due_at is in the past", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: ENROLLMENT_ID, programId: PROGRAM_ID, batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
      const overdueAssignment = makeAssignment({ dueAt: new Date("2020-01-01") });
      repo.findAssignmentForEnrollment.mockResolvedValue(overdueAssignment);
      repo.findAssignmentById.mockResolvedValue(overdueAssignment);
      repo.findLatestSubmission.mockResolvedValue(null);

      const err = await service.submitAssignment(USER_ID, TENANT_ID, ASSIGNMENT_ID, {
        files: [],
        text: "late",
      }).catch((e) => e as UnprocessableEntityException);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      // @ts-expect-error -- getResponse() returns string | object; we know it's an object with code
      expect(err.getResponse()["code"]).toBe("ASSIGNMENT_OVERDUE");
    });
  });

  // ─── 3. Faculty assigned-scope resolver ───────────────────────────────────

  describe("gradeSubmission, faculty assigned-scope", () => {
    const submission = makeSubmission({ batchId: BATCH_ID });

    it("AC-B2: faculty from unassigned batch gets 404", async () => {
      repo.findSubmissionById.mockResolvedValue(submission);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      // Faculty assigned to a DIFFERENT batch.
      repo.findAssignedBatchIds.mockResolvedValue(["different-batch-id"]);

      await expect(
        service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 80 }, "assigned"),
      ).rejects.toThrow(NotFoundException);
    });

    it("AC-B1: faculty from assigned batch can grade", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(submission);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]); // same batch
      repo.gradeSubmission.mockResolvedValue({ beforeScore: null, beforeStatus: "submitted" });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 85 }));
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://noop.local", expiresAt: new Date() });
      repo.findAssignmentById.mockResolvedValue(makeAssignment());

      const result = await service.gradeSubmission(
        FACULTY_USER_ID,
        TENANT_ID,
        SUBMISSION_ID,
        { score: 85, feedback: "Good work" },
        "assigned",
      );

      expect(result.score).toBe(85);
      expect(repo.gradeSubmission).toHaveBeenCalled();
    });

    it("no faculty profile → 404", async () => {
      repo.findSubmissionById.mockResolvedValue(submission);
      repo.findFacultyProfileId.mockResolvedValue(null); // no profile

      await expect(
        service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 80 }, "assigned"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Send back for changes (the other half of review) ─────────────────────
  //
  // `SubmissionStatus.returned` shipped in Phase 4 and nothing ever wrote it, so review had
  // one outcome: approve. These pin the loop that makes returning actually work end to end,
  // it must be a pending attempt, resubmission must be possible afterwards, and the student
  // must be told why.
  describe("returnSubmission", () => {
    const REASON = "The differential diagnosis section is missing, add it with references.";

    beforeEach(() => {
      repo.returnSubmission.mockResolvedValue({ updated: 1 });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://noop.local", expiresAt: new Date() });
    });

    it("sets status=returned with the reason, and writes NO score", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(makeSubmission({ status: "submitted" }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned", feedback: REASON }));

      const result = await service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all");

      expect(repo.returnSubmission).toHaveBeenCalledWith(TENANT_ID, SUBMISSION_ID, {
        reason: REASON,
        returnedById: FACULTY_USER_ID,
      });
      // Returning is not grading, a score here would land in gradedCount and read as done.
      expect(repo.gradeSubmission).not.toHaveBeenCalled();
      expect(result.status).toBe("returned");
    });

    // Without this the student is told to fix and resend something the submit endpoint
    // refuses with RESUBMIT_NOT_ALLOWED, a dead end from both sides of the product.
    it("turns on resubmission when the project had it switched off", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(makeSubmission({ status: "submitted" }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: false }));
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned" }));

      await service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all");

      expect(repo.enableResubmission).toHaveBeenCalledWith(TENANT_ID, ASSIGNMENT_ID);
    });

    it("leaves the flag alone when resubmission was already allowed", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(makeSubmission({ status: "submitted" }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned" }));

      await service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all");

      expect(repo.enableResubmission).not.toHaveBeenCalled();
    });

    it("notifies the student WITH the reason, a notice they can't act on is worse than none", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(makeSubmission({ status: "submitted" }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned" }));
      studentsRepository.findById.mockResolvedValue(
        makeStudentRow({ email: "alice@test.com", phone: "+911234567890", userId: "user-alice" }),
      );

      await service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all");

      expect(notifSvc.notifySubmissionReturned).toHaveBeenCalledWith(
        "user-alice",
        TENANT_ID,
        expect.objectContaining({ reason: REASON, assignmentId: ASSIGNMENT_ID }),
        expect.objectContaining({ toEmail: "alice@test.com" }),
      );
    });

    it("does not fail the return when the notification does", async () => {
      repo.findSubmissionById.mockResolvedValueOnce(makeSubmission({ status: "submitted" }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment({ allowResubmit: true }));
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned" }));
      notifSvc.notifySubmissionReturned.mockRejectedValue(new Error("mail provider down"));

      await expect(
        service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all"),
      ).resolves.toBeDefined();
    });

    it("refuses to return work that is already graded", async () => {
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 80 }));

      await expect(
        service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all"),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(repo.returnSubmission).not.toHaveBeenCalled();
    });

    it("refuses to return the same attempt twice", async () => {
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "returned" }));

      await expect(
        service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all"),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    // Two reviewers working the same queue: the guarded UPDATE matches zero rows for the
    // one who lost, and that has to surface rather than looking like success.
    it("surfaces a lost race when another reviewer got there first", async () => {
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "submitted" }));
      repo.returnSubmission.mockResolvedValue({ updated: 0 });

      await expect(
        service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "all"),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("applies the same faculty assigned-scope boundary as grading", async () => {
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ batchId: BATCH_ID, status: "submitted" }));
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue(["a-different-batch"]);

      await expect(
        service.returnSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { reason: REASON }, "assigned"),
      ).rejects.toThrow(NotFoundException);
      expect(repo.returnSubmission).not.toHaveBeenCalled();
    });
  });

  // The student-facing consequence of `returned` existing at all. Before this, a returned
  // submission derived to "submitted", so the student's screen said they were waiting for a
  // verdict that had already arrived, and the resubmit form is gated on this status.
  describe("student status derivation", () => {
    it("reports a returned submission as `returned`, not `submitted`", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.listAssignmentsForStudent.mockResolvedValue({
        rows: [makeAssignment()],
        total: 1,
      });
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: ENROLLMENT_ID, programId: PROGRAM_ID, batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
      repo.findLatestSubmission.mockResolvedValue(makeSubmission({ status: "returned" }));

      const result = await service.listMyAssignments(USER_ID, TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.items[0]?.status).toBe("returned");
    });

    it("still reports a pending submission as `submitted`", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.listAssignmentsForStudent.mockResolvedValue({ rows: [makeAssignment()], total: 1 });
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: ENROLLMENT_ID, programId: PROGRAM_ID, batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
      repo.findLatestSubmission.mockResolvedValue(makeSubmission({ status: "submitted" }));

      const result = await service.listMyAssignments(USER_ID, TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.items[0]?.status).toBe("submitted");
    });
  });

  // The reviewer's batch filter must NARROW an already-scoped queue, never widen it.
  describe("listSubmissions, batch narrowing", () => {
    it("passes the reviewer's batch alongside the scope-allowed batches, not instead of them", async () => {
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]);
      repo.listSubmissionsForAssignment.mockResolvedValue({ rows: [], total: 0 });

      await service.listSubmissions(
        TENANT_ID,
        ASSIGNMENT_ID,
        { page: 1, pageSize: 20, batchId: BATCH_ID },
        "assigned",
        FACULTY_USER_ID,
      );

      expect(repo.listSubmissionsForAssignment).toHaveBeenCalledWith(
        TENANT_ID,
        ASSIGNMENT_ID,
        expect.objectContaining({ allowedBatchIds: [BATCH_ID], batchId: BATCH_ID }),
      );
    });
  });

  // ─── Phase-9 Completion T31 / R3: notifyGradeReady wired at the real event site ────

  describe("gradeSubmission, T31/R3: notifyGradeReady fires on successful grading", () => {
    it("calls notifSvc.notifyGradeReady with the student's contact info after grading commits", async () => {
      const submission = makeSubmission({ batchId: BATCH_ID, studentId: "00000000-0000-0000-0000-000000000003" });
      repo.findSubmissionById.mockResolvedValueOnce(submission);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]);
      repo.gradeSubmission.mockResolvedValue({ beforeScore: null, beforeStatus: "submitted" });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 92 }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment());
      studentsRepository.findById.mockResolvedValue(
        makeStudentRow({ email: "alice@test.com", phone: "+911234567890", userId: "user-alice" }),
      );

      await service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 92 }, "assigned");

      expect(studentsRepository.findById).toHaveBeenCalledWith(TENANT_ID, submission.studentId);
      expect(notifSvc.notifyGradeReady).toHaveBeenCalledWith(
        "user-alice",
        TENANT_ID,
        expect.objectContaining({ submissionId: SUBMISSION_ID, score: 92, studentName: "Test Student" }),
        { toEmail: "alice@test.com", toPhone: "+911234567890" },
      );
    });

    it("does not fail the grading request when notifyGradeReady throws (best-effort)", async () => {
      const submission = makeSubmission({ batchId: BATCH_ID });
      repo.findSubmissionById.mockResolvedValueOnce(submission);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]);
      repo.gradeSubmission.mockResolvedValue({ beforeScore: null, beforeStatus: "submitted" });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 90 }));
      repo.findAssignmentById.mockResolvedValue(makeAssignment());
      notifSvc.notifyGradeReady.mockRejectedValueOnce(new Error("mail provider down"));

      const result = await service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 90 }, "assigned");

      expect(result.score).toBe(90);
    });
  });

  // ─── 4. Grade audit ───────────────────────────────────────────────────────

  describe("gradeSubmission, audit log (AC-B3)", () => {
    it("writes audit log with before/after when grading a previously-graded submission", async () => {
      const alreadyGraded = makeSubmission({ status: "graded", score: 70, batchId: BATCH_ID });
      repo.findSubmissionById.mockResolvedValueOnce(alreadyGraded);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]);
      repo.gradeSubmission.mockResolvedValue({ beforeScore: 70, beforeStatus: "graded" });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 90 }));
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://noop.local", expiresAt: new Date() });
      repo.findAssignmentById.mockResolvedValue(makeAssignment());

      await service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 90 }, "assigned");

      expect(repo.writeGradeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: SUBMISSION_ID,
          before: { score: 70, status: "graded" },
          after: { score: 90, status: "graded" },
        }),
      );
    });

    it("writes audit log with before=null when grading a fresh submission", async () => {
      const notGraded = makeSubmission({ status: "submitted", score: null, batchId: BATCH_ID });
      repo.findSubmissionById.mockResolvedValueOnce(notGraded);
      repo.findFacultyProfileId.mockResolvedValue(FACULTY_PROFILE_ID);
      repo.findAssignedBatchIds.mockResolvedValue([BATCH_ID]);
      repo.gradeSubmission.mockResolvedValue({ beforeScore: null, beforeStatus: "submitted" });
      repo.writeGradeAuditLog.mockResolvedValue(undefined);
      repo.findSubmissionById.mockResolvedValue(makeSubmission({ status: "graded", score: 80 }));
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://noop.local", expiresAt: new Date() });
      repo.findAssignmentById.mockResolvedValue(makeAssignment());

      await service.gradeSubmission(FACULTY_USER_ID, TENANT_ID, SUBMISSION_ID, { score: 80 }, "assigned");

      expect(repo.writeGradeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { score: null, status: "submitted" },
          after: { score: 80, status: "graded" },
        }),
      );
    });
  });

  // ─── 5. IDOR: cross-student assignment access ──────────────────────────────

  describe("getMySubmission, IDOR (AC-A3, AC-J1)", () => {
    it("returns 404 when student is not enrolled in the assignment's program", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      // Student enrolled only in PROGRAM_B, not the assignment's program.
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: "other-enrollment", programId: "program-b", batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID); // assignment is in a different program
      // For the student's enrolled program → not matching
      repo.findAssignmentForEnrollment.mockResolvedValue(null);

      await expect(
        service.getMySubmission(USER_ID, TENANT_ID, ASSIGNMENT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── 6. Signed download URLs ──────────────────────────────────────────────

  describe("getMySubmission, signed download URLs", () => {
    it("mints signed download URLs for submission files (never raw storage keys)", async () => {
      repo.findStudentProfileId.mockResolvedValue(STUDENT_ID);
      repo.findActiveEnrollmentsForStudent.mockResolvedValue([
        { id: ENROLLMENT_ID, programId: PROGRAM_ID, batchId: BATCH_ID },
      ]);
      repo.findLessonProgramId.mockResolvedValue(PROGRAM_ID);
      repo.findAssignmentForEnrollment.mockResolvedValue(makeAssignment());
      const sub = makeSubmission({ files: ["submissions/t/e/report.pdf"] });
      repo.findLatestSubmission.mockResolvedValue(sub);
      const signedUrl = "https://noop.local/storage/download/submissions%2Ft%2Fe%2Freport.pdf?sig=noop&exp=9999999";
      storage.getSignedDownloadUrl.mockResolvedValue({ url: signedUrl, expiresAt: new Date() });
      repo.findAssignmentById.mockResolvedValue(makeAssignment());

      const result = await service.getMySubmission(USER_ID, TENANT_ID, ASSIGNMENT_ID);

      expect(result.fileDownloadUrls).toHaveLength(1);
      const firstDownload = result.fileDownloadUrls[0];
      expect(firstDownload).toBeDefined();
      expect(firstDownload!.url).toBe(signedUrl);
      // Ensure the raw storage key is not returned as a URL.
      expect(firstDownload!.key).toBe("submissions/t/e/report.pdf");
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ key: "submissions/t/e/report.pdf" }),
      );
    });
  });
});
