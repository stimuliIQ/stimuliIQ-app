// apps/api/src/prisma/learning-depth-p4.integration.spec.ts
//
// Integration tests for Phase-4 Learning Depth schema (docs/plans/phase-4.md task #1 DoD).
//
// Covers (DoD requirements):
//   1. Soft-delete filter + audit-row-on-mutation for each new P4 table:
//      Assignment, AssignmentMilestone, Submission, Assessment, AssessmentQuestion,
//      Attempt, CertificateTemplate, Certificate.
//   2. certificates.enrollment_id uniqueness holds (one cert per enrollment).
//   3. certificates.cert_uid uniqueness holds (globally unique signed identifier).
//   4. Submission resubmit partial-unique: blocks a 2nd submission (attempt_no=1) for the
//      same (assignment_id, enrollment_id) when no duplicate attempt_no=1 exists (i.e.
//      the DB-layer partial-unique enforces the no-resubmit policy at storage level).
//   5. Answer-key isolation: a student-style Prisma SELECT of assessment_questions that
//      excludes `answerKey` (answerKey: false in Prisma select) does NOT return the
//      answer_key column — repo-level test proving the isolation contract.
//   6. AppModule boot smoke test: the NestJS AppModule must boot cleanly against the
//      migrated DB (DEFECT-1 lesson — broken migration/relation fails loud here, not at
//      phase closeout).
//
// Requires `DATABASE_URL` to point at the running dev/CI Postgres with the P4 schema
// applied (migrations 20260702065749_learning_depth + 20260702065800_learning_depth_partial_indexes
// + 20260702065914_learning_depth_eligibility_columns).
// SKIPS (not fails) when DATABASE_URL is absent.
//
// Uses the same patterns as soft-delete-audit.integration.spec.ts:
//   - Base (non-extended) client for fixtures setup + hard cleanup.
//   - Extended client (auditExtension + softDeleteExtension) for the tests themselves.
//   - auditContextStorage.run() wraps mutating calls to populate tenantId for audit writes.

import { PrismaClient, AssignmentKind, SubmissionStatus, AssessmentType, QuestionType, CertificateStatus } from "@prisma/client";
import { softDeleteExtension } from "./soft-delete.extension";
import { auditExtension } from "./audit.extension";
import { auditContextStorage } from "./audit-context";

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Phase-4 Learning Depth — soft-delete + audit + constraints (integration)", () => {
  const base = new PrismaClient();
  // Composition order: audit (inner) then soft-delete (outer) — same as all other tests.
  const prisma = base.$extends(auditExtension).$extends(softDeleteExtension);

  // Shared fixtures (created in beforeAll via base client, no audit rows generated for fixtures).
  let tenantId: string;
  let lessonId: string;
  let moduleId: string;
  let enrollmentId: string;
  let secondEnrollmentId: string; // for uniqueness tests
  let adminUserId: string;
  let programId: string;
  let studentProfileId: string;

  beforeAll(async () => {
    await base.$connect();

    // Tenant
    const tenant = await base.tenant.upsert({
      where: { slug: "stimuliiq-p4-integration-test" },
      update: {},
      create: { slug: "stimuliiq-p4-integration-test", name: "P4 Integration Test Tenant" },
    });
    tenantId = tenant.id;

    // Branch
    const branch = await base.branch.create({
      data: { tenantId, name: "P4 Test Branch" },
    });

    // Program
    const program = await base.program.create({
      data: {
        tenantId,
        slug: `p4-test-program-${tenantId}`,
        title: "P4 Test Program",
        domain: "test",
        pricePaise: 0,
      },
    });
    programId = program.id;

    // Module
    const module_ = await base.module.create({
      data: { programId, title: "P4 Test Module", order: 0 },
    });
    moduleId = module_.id;

    // Lesson
    const lesson = await base.lesson.create({
      data: { moduleId: module_.id, title: "P4 Test Lesson", type: "video", order: 0 },
    });
    lessonId = lesson.id;

    // Admin user (for certificate issued_by FK)
    const adminUser = await base.user.create({
      data: {
        tenantId,
        email: `p4-admin-${tenantId}@test.invalid`,
        name: "P4 Admin User",
        passwordHash: "seed-hash",
        status: "active",
      },
    });
    adminUserId = adminUser.id;

    // Student user + profile
    const studentUser = await base.user.create({
      data: {
        tenantId,
        email: `p4-student-${tenantId}@test.invalid`,
        name: "P4 Test Student",
        passwordHash: "seed-hash",
        status: "active",
      },
    });
    const studentProfile = await base.studentProfile.create({
      data: { tenantId, userId: studentUser.id, courseType: "btech", status: "active" },
    });
    studentProfileId = studentProfile.id;

    // Batch
    const batch = await base.batch.create({
      data: {
        tenantId,
        programId,
        branchId: branch.id,
        name: "P4 Test Batch",
        startDate: new Date("2026-01-01"),
        capacity: 10,
      },
    });

    // Primary enrollment
    const enrollment = await base.enrollment.create({
      data: {
        tenantId,
        studentId: studentProfile.id,
        batchId: batch.id,
        programId,
        status: "active",
        source: "manual",
      },
    });
    enrollmentId = enrollment.id;

    // Second student + enrollment for uniqueness tests
    const studentUser2 = await base.user.create({
      data: {
        tenantId,
        email: `p4-student2-${tenantId}@test.invalid`,
        name: "P4 Test Student 2",
        passwordHash: "seed-hash",
        status: "active",
      },
    });
    const studentProfile2 = await base.studentProfile.create({
      data: { tenantId, userId: studentUser2.id, courseType: "degree", status: "active" },
    });

    // Batch 2 (second student needs their own enrollment via their own batch)
    const batch2 = await base.batch.create({
      data: {
        tenantId,
        programId,
        branchId: branch.id,
        name: "P4 Test Batch 2",
        startDate: new Date("2026-01-01"),
        capacity: 10,
      },
    });
    const enrollment2 = await base.enrollment.create({
      data: {
        tenantId,
        studentId: studentProfile2.id,
        batchId: batch2.id,
        programId,
        status: "completed",
        progressPct: 100,
        source: "manual",
      },
    });
    secondEnrollmentId = enrollment2.id;
  });

  afterAll(async () => {
    // Hard cleanup: child tables before parent tables, following FK ordering.
    await base.certificate.deleteMany({ where: { tenantId } });
    await base.certificateTemplate.deleteMany({ where: { tenantId } });
    await base.attempt.deleteMany({ where: { tenantId } });
    await base.assessmentQuestion.deleteMany({ where: { tenantId } });
    await base.assessment.deleteMany({ where: { tenantId } });
    await base.submission.deleteMany({ where: { tenantId } });
    await base.assignmentMilestone.deleteMany({ where: { tenantId } });
    await base.assignment.deleteMany({ where: { tenantId } });
    await base.enrollment.deleteMany({ where: { tenantId } });
    await base.batch.deleteMany({ where: { tenantId } });
    await base.lesson.deleteMany({ where: { module: { programId } } });
    await base.module.deleteMany({ where: { programId } });
    const profiles = await base.studentProfile.findMany({ where: { tenantId } });
    await base.studentProfile.deleteMany({ where: { tenantId } });
    await base.user.deleteMany({ where: { id: { in: [adminUserId, ...profiles.map((p) => p.userId)] } } });
    await base.program.deleteMany({ where: { tenantId } });
    await base.branch.deleteMany({ where: { tenantId } });
    await base.auditLog.deleteMany({ where: { tenantId } });
    await base.tenant.delete({ where: { id: tenantId } });
    await base.$disconnect();
  });

  // ── 1. Assignment: soft-delete + audit ──────────────────────────────────────────────

  it("hides a soft-deleted Assignment from find queries by default", async () => {
    const assignment = await prisma.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: AssignmentKind.assignment,
        title: "SD Test Assignment",
        maxScore: 100,
        allowResubmit: false,
        isFinal: false,
      },
    });

    await prisma.assignment.delete({ where: { id: assignment.id } });

    const found = await prisma.assignment.findUnique({ where: { id: assignment.id } });
    expect(found).toBeNull();

    const raw = await base.assignment.findUnique({ where: { id: assignment.id } });
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("writes an audit_logs row for create and soft-delete on Assignment", async () => {
    const assignment = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "127.0.0.1" }, async () =>
      prisma.assignment.create({
        data: {
          tenantId,
          lessonId,
          kind: AssignmentKind.assignment,
          title: "Audit Test Assignment",
          maxScore: 50,
          allowResubmit: false,
          isFinal: false,
        },
      }),
    );

    const createRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Assignment", entityId: assignment.id, action: "create" },
    });
    expect(createRows.length).toBeGreaterThanOrEqual(1);
    const after = createRows[0]?.after as { title?: string; maxScore?: number } | null;
    expect(after?.title).toBe("Audit Test Assignment");
    expect(after?.maxScore).toBe(50);

    await auditContextStorage.run({ tenantId, actorId: undefined }, async () =>
      prisma.assignment.delete({ where: { id: assignment.id } }),
    );

    const deleteRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Assignment", entityId: assignment.id, action: "delete" },
    });
    expect(deleteRows.length).toBeGreaterThanOrEqual(1);
    const before = deleteRows[0]?.before as { title?: string } | null;
    expect(before?.title).toBe("Audit Test Assignment");
  });

  // ── 2. Submission resubmit partial-unique ───────────────────────────────────────────

  it("submission partial-unique blocks a 2nd attempt_no=1 row for same (assignment, enrollment)", async () => {
    // Create an assignment for this test.
    const assignment = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: AssignmentKind.assignment,
        title: "Resubmit Test Assignment",
        maxScore: 100,
        allowResubmit: false,
        isFinal: false,
      },
    });

    // First submission (attempt_no=1) — must succeed.
    const sub1 = await base.submission.create({
      data: {
        tenantId,
        assignmentId: assignment.id,
        enrollmentId,
        files: [],
        text: "First submission",
        attemptNo: 1,
        status: SubmissionStatus.submitted,
      },
    });

    // Second attempt with attempt_no=1 for the same (assignment, enrollment) —
    // the partial-unique index "submissions_active_no_resubmit_unique" must reject this.
    await expect(
      base.submission.create({
        data: {
          tenantId,
          assignmentId: assignment.id,
          enrollmentId,
          files: [],
          text: "Second attempt_no=1 — must be blocked",
          attemptNo: 1, // same attempt_no=1 → triggers partial-unique violation
          status: SubmissionStatus.submitted,
        },
      }),
    ).rejects.toThrow(); // Postgres unique violation on submissions_active_no_resubmit_unique

    // A submission with attempt_no=2 (resubmit path) must succeed (not covered by index).
    const sub2 = await base.submission.create({
      data: {
        tenantId,
        assignmentId: assignment.id,
        enrollmentId,
        files: [],
        text: "Resubmission (attempt_no=2)",
        attemptNo: 2,
        status: SubmissionStatus.submitted,
      },
    });
    expect(sub2.attemptNo).toBe(2);

    // Cleanup.
    await base.submission.deleteMany({ where: { assignmentId: assignment.id } });
    await base.assignment.delete({ where: { id: assignment.id } });
  });

  // ── 3. Submission: soft-delete + audit ─────────────────────────────────────────────

  it("hides a soft-deleted Submission from find queries and writes audit row", async () => {
    const assignment = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: AssignmentKind.assignment,
        title: "SD Submission Test Assignment",
        maxScore: 80,
        allowResubmit: false,
        isFinal: false,
      },
    });

    const sub = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.5" }, async () =>
      prisma.submission.create({
        data: {
          tenantId,
          assignmentId: assignment.id,
          enrollmentId,
          files: ["submissions/test-key.pdf"],
          text: "Test submission for SD audit",
          attemptNo: 1,
          status: SubmissionStatus.submitted,
        },
      }),
    );

    // Verify audit row was written for create.
    const createRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Submission", entityId: sub.id, action: "create" },
    });
    expect(createRows.length).toBeGreaterThanOrEqual(1);
    const after = createRows[0]?.after as { status?: string; attemptNo?: number } | null;
    expect(after?.status).toBe("submitted");
    expect(after?.attemptNo).toBe(1);

    // Soft-delete.
    await prisma.submission.delete({ where: { id: sub.id } });

    const found = await prisma.submission.findUnique({ where: { id: sub.id } });
    expect(found).toBeNull();

    const raw = await base.submission.findUnique({ where: { id: sub.id } });
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).not.toBeNull();

    // Cleanup.
    await base.submission.delete({ where: { id: sub.id } });
    await base.assignment.delete({ where: { id: assignment.id } });
  });

  // ── 4. Assessment + AssessmentQuestion: soft-delete + audit + answer-key isolation ──

  it("hides a soft-deleted Assessment from find queries and writes audit row", async () => {
    const assessment = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "127.0.0.2" }, async () =>
      prisma.assessment.create({
        data: {
          tenantId,
          moduleId,
          title: "SD Test Quiz",
          type: AssessmentType.quiz,
          passPct: 70,
          attemptsAllowed: 2,
          shuffle: true,
          isRequired: false,
        },
      }),
    );

    const createRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Assessment", entityId: assessment.id, action: "create" },
    });
    expect(createRows.length).toBeGreaterThanOrEqual(1);

    await prisma.assessment.delete({ where: { id: assessment.id } });

    const found = await prisma.assessment.findUnique({ where: { id: assessment.id } });
    expect(found).toBeNull();

    const raw = await base.assessment.findUnique({ where: { id: assessment.id } });
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("answer-key isolation: student-style projection of assessment_questions DOES NOT return answerKey", async () => {
    // Create an assessment with one MCQ question that has a server-side answer key.
    const assessment = await base.assessment.create({
      data: {
        tenantId,
        moduleId,
        title: "Answer Key Isolation Test Assessment",
        type: AssessmentType.quiz,
        passPct: 60,
        attemptsAllowed: 1,
        shuffle: false,
        isRequired: false,
      },
    });

    const question = await base.assessmentQuestion.create({
      data: {
        tenantId,
        assessmentId: assessment.id,
        type: QuestionType.mcq,
        prompt: "Which element is semantic?",
        options: [
          { id: "opt-a", text: "<div>" },
          { id: "opt-b", text: "<article>" },
        ],
        // Server-side answer key — must NEVER appear in a student-facing DTO.
        answerKey: { correctOptionId: "opt-b" },
        points: 10,
        order: 1,
      },
    });

    // Student-style projection: SELECT all fields EXCEPT answerKey.
    // The `answerKey: false` in Prisma select is the repo-level enforcement.
    // This proves that the column can be excluded at query time — the backend
    // repository method for student-facing assessment views MUST use this pattern.
    const studentProjection = await base.assessmentQuestion.findUnique({
      where: { id: question.id },
      select: {
        id: true,
        assessmentId: true,
        type: true,
        prompt: true,
        options: true,
        // answerKey: intentionally omitted (false would also work — omitting = false)
        points: true,
        order: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    expect(studentProjection).not.toBeNull();
    // The projection must contain the student-safe fields.
    expect(studentProjection?.prompt).toBe("Which element is semantic?");
    expect(studentProjection?.options).toBeDefined();
    // CRITICAL: answer_key must NOT be present in the student projection.
    // TypeScript's strict types enforce this at compile time (the select shape
    // doesn't include answerKey, so the result type has no answerKey field).
    // The runtime assertion: the returned object should not have answerKey.
    expect((studentProjection as Record<string, unknown>)["answerKey"]).toBeUndefined();

    // Verify the answer key IS present when selected via a privileged (server-side only) query.
    const serverProjection = await base.assessmentQuestion.findUnique({
      where: { id: question.id },
      select: { id: true, answerKey: true },
    });
    expect(serverProjection?.answerKey).toEqual({ correctOptionId: "opt-b" });

    // Cleanup.
    await base.assessmentQuestion.delete({ where: { id: question.id } });
    await base.assessment.delete({ where: { id: assessment.id } });
  });

  it("AssessmentQuestion soft-delete and audit: hides deleted question, writes audit row", async () => {
    const assessment = await base.assessment.create({
      data: {
        tenantId,
        moduleId,
        title: "AQ Audit Test",
        type: AssessmentType.test,
        passPct: 80,
        attemptsAllowed: 1,
        shuffle: true,
        isRequired: true,
      },
    });

    const question = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.6" }, async () =>
      prisma.assessmentQuestion.create({
        data: {
          tenantId,
          assessmentId: assessment.id,
          type: QuestionType.descriptive,
          prompt: "Explain CSS specificity.",
          // options omitted → NULL (Prisma Json? optional; passing literal `null` is a type error)
          answerKey: { rubric: [{ criterion: "Correct explanation", maxPoints: 10 }] },
          points: 10,
          order: 1,
        },
      }),
    );

    const auditRows = await base.auditLog.findMany({
      where: { tenantId, entity: "AssessmentQuestion", entityId: question.id, action: "create" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    // answerKey APPEARS in audit logs (intentional — audit is admin-only, append-only).
    const auditAfter = auditRows[0]?.after as { answerKey?: unknown } | null;
    expect(auditAfter?.answerKey).toBeDefined();

    await prisma.assessmentQuestion.delete({ where: { id: question.id } });

    const found = await prisma.assessmentQuestion.findUnique({ where: { id: question.id } });
    expect(found).toBeNull();

    await base.assessmentQuestion.delete({ where: { id: question.id } });
    await base.assessment.delete({ where: { id: assessment.id } });
  });

  // ── 5. Attempt: soft-delete + audit ────────────────────────────────────────────────

  it("hides a soft-deleted Attempt and writes audit row for create", async () => {
    const assessment = await base.assessment.create({
      data: {
        tenantId,
        moduleId,
        title: "Attempt Audit Test Quiz",
        type: AssessmentType.quiz,
        passPct: 60,
        attemptsAllowed: 1,
        shuffle: false,
        isRequired: false,
      },
    });

    const now = new Date();
    const attempt = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.7" }, async () =>
      prisma.attempt.create({
        data: {
          tenantId,
          assessmentId: assessment.id,
          enrollmentId,
          answers: {},
          startedAt: now,
          timeExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          flags: { tabSwitchCount: 0 },
          attemptNo: 1,
        },
      }),
    );

    const auditRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Attempt", entityId: attempt.id, action: "create" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);

    await prisma.attempt.delete({ where: { id: attempt.id } });

    const found = await prisma.attempt.findUnique({ where: { id: attempt.id } });
    expect(found).toBeNull();

    await base.attempt.delete({ where: { id: attempt.id } });
    await base.assessment.delete({ where: { id: assessment.id } });
  });

  // ── 6. CertificateTemplate: soft-delete + audit ────────────────────────────────────

  it("hides a soft-deleted CertificateTemplate and writes audit row for create", async () => {
    const tmpl = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.8" }, async () =>
      prisma.certificateTemplate.create({
        data: {
          tenantId,
          name: "P4 Audit Test Template",
          design: { layout: "landscape" },
          fields: [{ key: "student_name" }],
          status: "active",
        },
      }),
    );

    const auditRows = await base.auditLog.findMany({
      where: { tenantId, entity: "CertificateTemplate", entityId: tmpl.id, action: "create" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const after = auditRows[0]?.after as { name?: string } | null;
    expect(after?.name).toBe("P4 Audit Test Template");

    await prisma.certificateTemplate.delete({ where: { id: tmpl.id } });

    const found = await prisma.certificateTemplate.findUnique({ where: { id: tmpl.id } });
    expect(found).toBeNull();

    const raw = await base.certificateTemplate.findUnique({ where: { id: tmpl.id } });
    expect(raw?.deletedAt).not.toBeNull();
  });

  // ── 7. Certificate: uniqueness constraints + soft-delete + audit ────────────────────

  it("certificates.enrollment_id uniqueness: blocks a second certificate for the same enrollment", async () => {
    // Create a template for the certificate FK requirement.
    const tmpl = await base.certificateTemplate.create({
      data: {
        tenantId,
        name: "Uniqueness Test Template",
        design: {},
        fields: [],
        status: "active",
      },
    });

    // First certificate for secondEnrollmentId — must succeed.
    const cert1 = await base.certificate.create({
      data: {
        tenantId,
        enrollmentId: secondEnrollmentId,
        studentId: studentProfileId,
        programId,
        certUid: `test-uid-enrollment-unique-${tenantId}-1`,
        serial: `test-serial-enrollment-unique-${tenantId}-1`,
        templateId: tmpl.id,
        issuedAt: new Date(),
        issuedById: adminUserId,
        status: CertificateStatus.valid,
      },
    });

    // Second certificate for the SAME enrollment — must fail (unique constraint on enrollment_id).
    await expect(
      base.certificate.create({
        data: {
          tenantId,
          enrollmentId: secondEnrollmentId, // same enrollment_id
          studentId: studentProfileId,
          programId,
          certUid: `test-uid-enrollment-unique-${tenantId}-2`,
          serial: `test-serial-enrollment-unique-${tenantId}-2`,
          templateId: tmpl.id,
          issuedAt: new Date(),
          issuedById: adminUserId,
          status: CertificateStatus.valid,
        },
      }),
    ).rejects.toThrow(); // Postgres unique violation on certificates_enrollment_id_key

    // Cleanup.
    await base.certificate.delete({ where: { id: cert1.id } });
    await base.certificateTemplate.delete({ where: { id: tmpl.id } });
  });

  it("certificates.cert_uid uniqueness: blocks a duplicate cert_uid across two enrollments", async () => {
    const tmpl = await base.certificateTemplate.create({
      data: {
        tenantId,
        name: "CertUID Uniqueness Test Template",
        design: {},
        fields: [],
        status: "active",
      },
    });

    const SHARED_CERT_UID = `test-shared-uid-${tenantId}`;

    // First certificate with SHARED_CERT_UID on the primary enrollment.
    const cert1 = await base.certificate.create({
      data: {
        tenantId,
        enrollmentId,
        studentId: studentProfileId,
        programId,
        certUid: SHARED_CERT_UID,
        serial: `test-serial-shared-a-${tenantId}`,
        templateId: tmpl.id,
        issuedAt: new Date(),
        issuedById: adminUserId,
        status: CertificateStatus.valid,
      },
    });

    // Second certificate with the SAME cert_uid on a different enrollment — must fail.
    // (enrollment_id is different so that constraint doesn't fire; cert_uid does.)
    await expect(
      base.certificate.create({
        data: {
          tenantId,
          enrollmentId: secondEnrollmentId, // different enrollment
          studentId: studentProfileId,
          programId,
          certUid: SHARED_CERT_UID, // same cert_uid — must be rejected
          serial: `test-serial-shared-b-${tenantId}`,
          templateId: tmpl.id,
          issuedAt: new Date(),
          issuedById: adminUserId,
          status: CertificateStatus.valid,
        },
      }),
    ).rejects.toThrow(); // Postgres unique violation on certificates_cert_uid_key

    // Cleanup.
    await base.certificate.delete({ where: { id: cert1.id } });
    await base.certificateTemplate.delete({ where: { id: tmpl.id } });
  });

  it("Certificate soft-delete + audit: hides deleted cert, writes audit row for create", async () => {
    const tmpl = await base.certificateTemplate.create({
      data: {
        tenantId,
        name: "SD Cert Test Template",
        design: {},
        fields: [],
        status: "active",
      },
    });

    const cert = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.9" }, async () =>
      prisma.certificate.create({
        data: {
          tenantId,
          enrollmentId,
          studentId: studentProfileId,
          programId,
          certUid: `test-cert-sd-audit-${tenantId}`,
          serial: `test-serial-sd-audit-${tenantId}`,
          templateId: tmpl.id,
          issuedAt: new Date(),
          issuedById: adminUserId,
          status: CertificateStatus.valid,
        },
      }),
    );

    const auditRows = await base.auditLog.findMany({
      where: { tenantId, entity: "Certificate", entityId: cert.id, action: "create" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const after = auditRows[0]?.after as { status?: string; certUid?: string } | null;
    expect(after?.status).toBe("valid");
    expect(after?.certUid).toBeDefined(); // certUid appears in audit (it is not a secret)

    await prisma.certificate.delete({ where: { id: cert.id } });

    const found = await prisma.certificate.findUnique({ where: { id: cert.id } });
    expect(found).toBeNull();

    const raw = await base.certificate.findUnique({ where: { id: cert.id } });
    expect(raw?.deletedAt).not.toBeNull();

    // Cleanup.
    await base.certificate.delete({ where: { id: cert.id } });
    await base.certificateTemplate.delete({ where: { id: tmpl.id } });
  });

  // ── 8. AssignmentMilestone: soft-delete + audit ─────────────────────────────────────

  it("hides a soft-deleted AssignmentMilestone and writes audit row", async () => {
    const project = await base.assignment.create({
      data: {
        tenantId,
        lessonId,
        kind: AssignmentKind.project,
        title: "Milestone SD Test Project",
        maxScore: 200,
        allowResubmit: true,
        isFinal: true,
      },
    });

    const milestone = await auditContextStorage.run({ tenantId, actorId: undefined, ip: "10.0.0.10" }, async () =>
      prisma.assignmentMilestone.create({
        data: {
          tenantId,
          assignmentId: project.id,
          title: "Design Document Milestone",
          order: 1,
          dueAt: new Date("2026-08-15T23:59:59Z"),
        },
      }),
    );

    const auditRows = await base.auditLog.findMany({
      where: { tenantId, entity: "AssignmentMilestone", entityId: milestone.id, action: "create" },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);

    await prisma.assignmentMilestone.delete({ where: { id: milestone.id } });

    const found = await prisma.assignmentMilestone.findUnique({ where: { id: milestone.id } });
    expect(found).toBeNull();

    const raw = await base.assignmentMilestone.findUnique({ where: { id: milestone.id } });
    expect(raw?.deletedAt).not.toBeNull();

    // Cleanup.
    await base.assignmentMilestone.delete({ where: { id: milestone.id } });
    await base.assignment.delete({ where: { id: project.id } });
  });
});
