// apps/api/src/modules/assignments/assignments.integration.spec.ts
//
// Integration tests for the Assignments + Submissions module (P4 Wave 4 task #6).
// Follows the `.integration.spec.ts` pattern (unit jest config, self-skip when
// DATABASE_URL is absent, same as appmodule-p4-boot.integration.spec.ts).
//
// COVERAGE:
//   - Student submits and views only their own submission (IDOR cross-student → 404, AC-J1).
//   - Faculty grades only assigned-batch submissions (unassigned → 404, AC-B2).
//   - Grade changes are audited with before/after entries (AC-B3).
//   - Resubmit blocked when allow_resubmit=false (AC-A5).
//   - Submission after due_at → 422 ASSIGNMENT_OVERDUE (AC-A2).
//   - Cross-tenant isolation: submission in tenant2 not visible from tenant1 (AC-J4).
//   - Submission files are stored as storage keys; download URLs are signed (AC-I2).

import { PrismaClient } from "@prisma/client";
import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AssignmentsRepository } from "./assignments.repository";
import { AssignmentsService } from "./assignments.service";
import { NoopStorageProvider } from "../storage/providers/storage/noop-storage.provider";
import { PrismaService } from "../../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { StudentsRepository } from "../students/students.repository";

import { describeIfLocalDb } from "../../prisma/local-db-guard";

// Fail closed: this spec writes real rows, so it runs ONLY against a disposable local
// database. The previous `!!process.env.DATABASE_URL` gate passed against PRODUCTION,
// because importing @prisma/client auto-loads the repo-root .env. See local-db-guard.ts.
const describeIfDb = describeIfLocalDb;

describeIfDb("AssignmentsService integration tests", () => {
  let base: PrismaClient;
  let prismaService: PrismaService;
  let repo: AssignmentsRepository;
  let service: AssignmentsService;

  // ─── Seed data IDs ────────────────────────────────────────────────────────

  let tenantId: string;
  let tenant2Id: string;
  let programId: string;
  let lessonId: string;
  let assignmentId: string;

  // Student A (in Batch A, faculty assigned)
  let userA_id: string;
  let studentA_id: string;
  let enrollmentA_id: string;
  let batchA_id: string;

  // Student B (in Batch B, faculty NOT assigned)
  let userB_id: string;
  let studentB_id: string;
  let enrollmentB_id: string;

  // Faculty
  let facultyUserId: string;
  let facultyProfileId: string;

  const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    base = new PrismaClient();
    await base.$connect();

    prismaService = new PrismaService();
    await prismaService.onModuleInit();

    repo = new AssignmentsRepository(prismaService);
    const storage = new NoopStorageProvider();
    // T31/R3: notifyGradeReady is best-effort (caught by the service), a stub is
    // sufficient here since this suite's coverage is the grading/scope/audit flow, not
    // the notification fan-out itself (that's covered by assignments.service.spec.ts's
    // dedicated T31/R3 tests + notifications.service.spec.ts).
    const notifSvcStub = { notifyGradeReady: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const studentsRepository = new StudentsRepository(prismaService);
    service = new AssignmentsService(repo, storage, notifSvcStub, studentsRepository);

    // ─── Seed ──────────────────────────────────────────────────────────────

    const suffix = uniqueSuffix();

    const tenant = await base.tenant.create({
      data: { name: "Assign Test Tenant", slug: `assign-t-${suffix}` },
    });
    tenantId = tenant.id;

    const tenant2 = await base.tenant.create({
      data: { name: "Other Tenant", slug: `assign-other-${suffix}` },
    });
    tenant2Id = tenant2.id;

    const branch = await base.branch.create({
      data: { tenantId, name: "Test Branch" },
    });

    const program = await base.program.create({
      data: {
        tenantId,
        title: "Test Program",
        slug: `assign-prog-${suffix}`,
        domain: "IT",
        pricePaise: 0,
      },
    });
    programId = program.id;

    const mod = await base.module.create({
      data: { programId, title: "Module 1", order: 1 },
    });

    const lesson = await base.lesson.create({
      data: { moduleId: mod.id, title: "Lesson 1", type: "assignment", order: 1 },
    });
    lessonId = lesson.id;

    // Users.
    const userA = await base.user.create({
      data: {
        tenantId,
        name: "Student A",
        email: `student-a-${suffix}@test.com`,
        passwordHash: "x",
        status: "active",
      },
    });
    userA_id = userA.id;

    const userB = await base.user.create({
      data: {
        tenantId,
        name: "Student B",
        email: `student-b-${suffix}@test.com`,
        passwordHash: "x",
        status: "active",
      },
    });
    userB_id = userB.id;

    const facultyUser = await base.user.create({
      data: {
        tenantId,
        name: "Faculty",
        email: `faculty-${suffix}@test.com`,
        passwordHash: "x",
        status: "active",
      },
    });
    facultyUserId = facultyUser.id;

    // Student profiles.
    const profA = await base.studentProfile.create({
      data: { tenantId, userId: userA_id, courseType: "btech", status: "active" },
    });
    studentA_id = profA.id;

    const profB = await base.studentProfile.create({
      data: { tenantId, userId: userB_id, courseType: "btech", status: "active" },
    });
    studentB_id = profB.id;

    // Faculty profile.
    const facProf = await base.facultyProfile.create({
      data: { tenantId, userId: facultyUserId },
    });
    facultyProfileId = facProf.id;

    // Batch A, faculty is assigned.
    const batchA = await base.batch.create({
      data: {
        tenantId,
        programId,
        branchId: branch.id,
        name: "Batch A",
        startDate: new Date("2026-01-01"),
        capacity: 10,
        facultyId: facultyProfileId,
      },
    });
    batchA_id = batchA.id;

    // Batch B, faculty NOT assigned.
    const batchB = await base.batch.create({
      data: {
        tenantId,
        programId,
        branchId: branch.id,
        name: "Batch B",
        startDate: new Date("2026-01-01"),
        capacity: 10,
      },
    });

    // Enrollments.
    const enrollA = await base.enrollment.create({
      data: {
        tenantId,
        studentId: studentA_id,
        programId,
        batchId: batchA_id,
        status: "active",
        source: "manual",
      },
    });
    enrollmentA_id = enrollA.id;

    const enrollB = await base.enrollment.create({
      data: {
        tenantId,
        studentId: studentB_id,
        programId,
        batchId: batchB.id,
        status: "active",
        source: "manual",
      },
    });
    enrollmentB_id = enrollB.id;

    // Assignment.
    const assignment = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: "assignment",
        title: "Integration Test Assignment",
        maxScore: 100,
        allowResubmit: false,
        isFinal: false,
      },
    });
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    // Clean up in FK order (children before parents).
    await base.auditLog.deleteMany({ where: { tenantId } });
    await base.submission.deleteMany({ where: { tenantId } });
    await base.assignment.deleteMany({ where: { tenantId } });
    await base.enrollment.deleteMany({ where: { tenantId } });
    await base.batch.deleteMany({ where: { tenantId } });
    const profs = await base.studentProfile.findMany({ where: { tenantId }, select: { userId: true } });
    await base.studentProfile.deleteMany({ where: { tenantId } });
    await base.facultyProfile.deleteMany({ where: { tenantId } });
    await base.user.deleteMany({ where: { id: { in: [...profs.map((p) => p.userId), facultyUserId, userA_id, userB_id] } } });
    await base.lesson.deleteMany({ where: { module: { program: { tenantId } } } });
    await base.module.deleteMany({ where: { program: { tenantId } } });
    await base.program.deleteMany({ where: { tenantId } });
    await base.branch.deleteMany({ where: { tenantId } });
    await base.tenant.deleteMany({ where: { id: { in: [tenantId, tenant2Id] } } });
    await base.$disconnect();
    await prismaService.onModuleDestroy();
  });

  // ─── AC-A1: Student A submits ──────────────────────────────────────────────

  it("AC-A1: student submits assignment and gets own submission", async () => {
    const result = await service.submitAssignment(userA_id, tenantId, assignmentId, {
      files: [],
      text: "My answer here",
    });

    expect(result.enrollmentId).toBe(enrollmentA_id);
    expect(result.status).toBe("submitted");
    expect(result.attemptNo).toBe(1);
    expect(result.text).toBe("My answer here");
  });

  // ─── AC-J1: IDOR, Student B cannot see Student A's submission ────────────

  it("AC-J1: Student B has no submission, not Student A's (own-scope isolation)", async () => {
    // Student B accessing getMySubmission → their own enrollment has no submission.
    await expect(
      service.getMySubmission(userB_id, tenantId, assignmentId),
    ).rejects.toThrow(NotFoundException);
  });

  // ─── AC-A5: Resubmit blocked ──────────────────────────────────────────────

  it("AC-A5: second submission blocked when allow_resubmit=false", async () => {
    const err = await service.submitAssignment(userA_id, tenantId, assignmentId, {
      files: [],
      text: "Second attempt",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    // @ts-expect-error -- NestJS getResponse() returns string | object; we know it's an object with code
    expect((err as ConflictException).getResponse()["code"]).toBe("RESUBMIT_NOT_ALLOWED");
  });

  // ─── AC-B2: Faculty cannot grade submission outside assigned batch ─────────

  it("AC-B2: faculty cannot grade Student B's submission (unassigned batch)", async () => {
    // Student B submits.
    await service.submitAssignment(userB_id, tenantId, assignmentId, {
      files: [],
      text: "Student B answer",
    });

    const subB = await repo.findLatestSubmission(tenantId, assignmentId, enrollmentB_id);
    expect(subB).not.toBeNull();

    // Faculty only assigned to batch A, Student B is in batch B.
    await expect(
      service.gradeSubmission(facultyUserId, tenantId, subB!.id, { score: 70 }, "assigned"),
    ).rejects.toThrow(NotFoundException);
  });

  // ─── AC-B1: Faculty grades Student A's submission ─────────────────────────

  it("AC-B1: faculty grades Student A's submission (assigned batch)", async () => {
    const subA = await repo.findLatestSubmission(tenantId, assignmentId, enrollmentA_id);
    expect(subA).not.toBeNull();

    const result = await service.gradeSubmission(
      facultyUserId,
      tenantId,
      subA!.id,
      { score: 88, feedback: "Great work!" },
      "assigned",
    );

    expect(result.score).toBe(88);
    expect(result.feedback).toBe("Great work!");
  });

  // ─── AC-B3: Grade change is audited with before/after ─────────────────────

  it("AC-B3: re-grading writes audit log with before/after", async () => {
    const subA = await repo.findLatestSubmission(tenantId, assignmentId, enrollmentA_id);
    expect(subA).not.toBeNull();

    // Re-grade from 88 to 95.
    await service.gradeSubmission(
      facultyUserId,
      tenantId,
      subA!.id,
      { score: 95, feedback: "Updated" },
      "assigned",
    );

    const auditRows = await base.auditLog.findMany({
      where: { entity: "Submission", entityId: subA!.id, action: "submission.grade" },
      orderBy: { createdAt: "desc" },
    });

    expect(auditRows.length).toBeGreaterThanOrEqual(2);

    const latest = auditRows[0];
    expect(latest).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- audit payload is arbitrary JSON
    expect((latest!.before as Record<string, unknown>)?.score).toBe(88);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- audit payload is arbitrary JSON
    expect((latest!.after as Record<string, unknown>)?.score).toBe(95);
  });

  // ─── AC-A2: Overdue assignment ────────────────────────────────────────────

  it("AC-A2: submission after due_at → 422 ASSIGNMENT_OVERDUE", async () => {
    const overdue = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: "assignment",
        title: "Overdue",
        maxScore: 100,
        dueAt: new Date("2020-01-01"),
        allowResubmit: false,
        isFinal: false,
      },
    });

    const err = await service.submitAssignment(userA_id, tenantId, overdue.id, {
      files: [],
      text: "late",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    // @ts-expect-error -- NestJS getResponse() returns string | object; we know it's an object with code
    expect((err as UnprocessableEntityException).getResponse()["code"]).toBe("ASSIGNMENT_OVERDUE");

    await base.assignment.delete({ where: { id: overdue.id } });
  });

  // ─── AC-J4: Cross-tenant isolation ────────────────────────────────────────

  it("AC-J4: cross-tenant lookup returns null (IDOR → 404)", async () => {
    const subA = await repo.findLatestSubmission(tenantId, assignmentId, enrollmentA_id);
    expect(subA).not.toBeNull();

    // Query from tenant2 context, should NOT find the submission.
    const crossTenantResult = await repo.findSubmissionById(tenant2Id, subA!.id);
    expect(crossTenantResult).toBeNull();
  });

  // ─── Files stored as keys, download URLs are signed ─────────────────────

  it("submission files returned with signed download URLs (not raw keys)", async () => {
    const a2 = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: "assignment",
        title: "File Key Test",
        maxScore: 50,
        allowResubmit: false,
        isFinal: false,
      },
    });

    const storageKey = `submissions/${tenantId}/${enrollmentA_id}/test-file.pdf`;

    const result = await service.submitAssignment(userA_id, tenantId, a2.id, {
      files: [storageKey],
    });

    expect(result.fileDownloadUrls).toHaveLength(1);
    const firstUrl = result.fileDownloadUrls[0];
    expect(firstUrl).toBeDefined();
    expect(firstUrl!.key).toBe(storageKey);
    // Noop provider returns a fake signed URL starting with https://noop.local
    expect(firstUrl!.url).toContain("noop.local");
    // The raw storage key must NOT be the URL.
    expect(firstUrl!.url).not.toBe(storageKey);

    // Cleanup.
    await base.submission.deleteMany({ where: { assignmentId: a2.id } });
    await base.assignment.delete({ where: { id: a2.id } });
  });

  it("H-1: rejects submission file keys not scoped to the student's own submission prefix (storage-key IDOR)", async () => {
    const a3 = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: "assignment",
        title: "Storage-key IDOR Test",
        maxScore: 50,
        allowResubmit: true,
        isFinal: false,
      },
    });

    const foreignKeys = [
      // A public certificate PDF (cert_uids are exposed via the public verify page).
      `certificates/${tenantId}/any-cert-uid.pdf`,
      // Another enrollment's submission folder (same tenant).
      `submissions/${tenantId}/00000000-0000-0000-0000-000000000000/foreign.pdf`,
      // Path traversal that starts with the student's own prefix but escapes it.
      `submissions/${tenantId}/${enrollmentA_id}/../../certificates/x.pdf`,
    ];

    for (const badKey of foreignKeys) {
      const err = await service
        .submitAssignment(userA_id, tenantId, a3.id, { files: [badKey] })
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getStatus()).toBe(422);
      // No submission row is created when a foreign key is rejected.
      const rows = await base.submission.findMany({ where: { assignmentId: a3.id } });
      expect(rows).toHaveLength(0);
    }

    // A correctly-scoped key for THIS student's enrollment still succeeds.
    const okKey = `submissions/${tenantId}/${enrollmentA_id}/legit.pdf`;
    const ok = await service.submitAssignment(userA_id, tenantId, a3.id, { files: [okKey] });
    expect(ok.fileDownloadUrls).toHaveLength(1);

    await base.submission.deleteMany({ where: { assignmentId: a3.id } });
    await base.assignment.delete({ where: { id: a3.id } });
  });
});
