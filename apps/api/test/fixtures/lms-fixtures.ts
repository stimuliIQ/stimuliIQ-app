// apps/api/test/fixtures/lms-fixtures.ts
//
// Fixture factory for the Phase-3 LMS integration suite (qa-engineer, Wave 6).
// Follows the exact patterns of commerce-leads-fixtures.ts (sequential upserts,
// shared "stimuliiq" tenant due to AuthService.login TENANT_SLUG hard-coding,
// idempotent teardown).
//
// WHAT IS SEEDED
// ══════════════
//   Tenant: the shared "stimuliiq" tenant (cannot be isolated — AuthService hard-codes slug).
//   2 programs   P1 and P2, each with 1 module and 2 lessons:
//                  - one non-preview lesson  (LMS_P1_LESSON_A / LMS_P2_LESSON_A)
//                  - one preview lesson      (LMS_P1_LESSON_PREVIEW / LMS_P2_LESSON_PREVIEW)
//   2 batches    one per program (both in a shared branch).
//   1 video      on LMS_P1_LESSON_A and LMS_P2_LESSON_A (status=ready, providerAssetId set).
//   2 students   studentA enrolled in P1 only; studentB enrolled in P2 only.
//   Permissions  courses.view, lessons.view, videos.stream, progress.edit,
//                progress.view, attendance.view — granted to the "student" role.
//
// SECURITY INVARIANTS UNDER TEST
// ═══════════════════════════════
//   • Student A can reach P1 content; must 404 on P2 content.
//   • Preview lessons in P2 ARE reachable by student A (enrollment=null path).
//   • Non-preview lessons in P2 are NOT reachable by student A.
//   • Cross-tenant (same DB, different logic) is noted as a carry-forward (AuthService
//     TENANT_SLUG hard-coding prevents a real second tenant login in this harness).

import { PrismaClient, RolePermissionScope } from "@prisma/client";
import { purgeAuditLogs } from "../../src/prisma/purge-audit-logs";
import * as argon2 from "argon2";

export const LMS_TENANT_SLUG = "stimuliiq";

// ── Student credentials ─────────────────────────────────────────────────────
export const LMS_STUDENT_A_EMAIL = "qa-lms-student-a@stimuliiq.test";
export const LMS_STUDENT_A_PASSWORD = "Qa-LmsStudentA-123!";

export const LMS_STUDENT_B_EMAIL = "qa-lms-student-b@stimuliiq.test";
export const LMS_STUDENT_B_PASSWORD = "Qa-LmsStudentB-123!";

// ── Program / batch slugs / names (deterministic so upserts are idempotent) ─
export const LMS_PROGRAM_P1_SLUG = "qa-lms-fixture-program-p1";
export const LMS_PROGRAM_P2_SLUG = "qa-lms-fixture-program-p2";
export const LMS_BATCH_P1_NAME = "QA LMS Fixture Batch P1";
export const LMS_BATCH_P2_NAME = "QA LMS Fixture Batch P2";

export const ALL_LMS_FIXTURE_EMAILS = [LMS_STUDENT_A_EMAIL, LMS_STUDENT_B_EMAIL];

// ── LMS permissions (P3 matrix) ─────────────────────────────────────────────
const LMS_PERMISSIONS = [
  "courses.view",
  "lessons.view",
  "videos.stream",
  "progress.edit",
  "progress.view",
  "attendance.view",
] as const;

export interface SeededLmsFixtures {
  tenantId: string;
  branchId: string;
  programP1Id: string;
  programP2Id: string;
  batchP1Id: string;
  batchP2Id: string;
  moduleP1Id: string;
  moduleP2Id: string;
  // Non-preview lessons
  lessonP1AId: string;
  lessonP2AId: string;
  // Preview lessons
  lessonP1PreviewId: string;
  lessonP2PreviewId: string;
  // Videos (on the non-preview lessons)
  videoP1AId: string;
  videoP2AId: string;
  // Users
  studentAUserId: string;
  studentBUserId: string;
  // Student profiles
  studentAProfileId: string;
  studentBProfileId: string;
  // Enrollments
  enrollmentAId: string; // Student A → P1
  enrollmentBId: string; // Student B → P2
}

async function ensureUser(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
  password: string,
  name: string,
): Promise<{ id: string }> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { passwordHash, status: "active" },
    create: { tenantId, email, name, passwordHash, status: "active" },
  });
}

async function upsertUserRole(
  prisma: PrismaClient,
  userId: string,
  roleId: string,
): Promise<void> {
  const existing = await prisma.userRole.findFirst({
    where: { userId, roleId, branchId: null },
  });
  if (!existing) {
    await prisma.userRole.create({ data: { userId, roleId, branchId: null } });
  }
}

/**
 * Seeds the full LMS test fixture set documented in the file header.
 * Sequential (never Promise.all on shared unique keys) — see commerce-leads-fixtures.ts
 * for the rationale (avoids unique-constraint races under concurrent Jest workers).
 */
export async function seedLmsFixtures(
  prisma: PrismaClient,
): Promise<SeededLmsFixtures> {
  // ── Tenant ──────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: LMS_TENANT_SLUG },
    update: {},
    create: {
      slug: LMS_TENANT_SLUG,
      name: "QA Integration Tenant",
      status: "active",
      settings: {},
      branding: {},
    },
  });
  const tenantId = tenant.id;

  // ── LMS Permission catalog (sequential) ─────────────────────────────────────
  const permByKey = new Map<string, string>();
  for (const key of LMS_PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, label: key.replace(".", " ") },
    });
    permByKey.set(key, perm.id);
  }

  // ── "student" role ──────────────────────────────────────────────────────────
  const studentRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: "student" } },
    update: { name: "Student" },
    create: { tenantId, key: "student", name: "Student", isSystem: false },
  });

  // Grant all LMS permissions to the student role (own scope).
  for (const key of LMS_PERMISSIONS) {
    const permId = permByKey.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: studentRole.id, permissionId: permId } },
      update: { scope: RolePermissionScope.own },
      create: {
        roleId: studentRole.id,
        permissionId: permId,
        scope: RolePermissionScope.own,
      },
    });
  }

  // ── Branch (shared between both programs) ────────────────────────────────────
  const existingBranch = await prisma.branch.findFirst({
    where: { tenantId, name: "QA LMS Fixture Branch" },
  });
  const branch =
    existingBranch ??
    (await prisma.branch.create({
      data: {
        tenantId,
        name: "QA LMS Fixture Branch",
        city: "Hyderabad",
        status: "active",
      },
    }));

  // ── Program P1 ────────────────────────────────────────────────────────────────
  // NOTE: `programs.slug` has NO Prisma-level global @unique (raw-SQL (tenant_id, slug)
  // partial-unique instead — see commerce-leads-fixtures.ts's comment on the same
  // pattern) — `upsert({ where: { slug } })` is not a valid Prisma selector; find-then-
  // create/update instead.
  const existingProgramP1 = await prisma.program.findFirst({ where: { tenantId, slug: LMS_PROGRAM_P1_SLUG } });
  const programP1 = existingProgramP1
    ? await prisma.program.update({ where: { id: existingProgramP1.id }, data: { status: "published" } })
    : await prisma.program.create({
        data: {
          tenantId,
          slug: LMS_PROGRAM_P1_SLUG,
          title: "QA LMS Program P1",
          domain: "test",
          level: "beginner",
          mode: "recorded",
          durationWeeks: 4,
          pricePaise: 100000,
          currency: "INR",
          status: "published",
        },
      });

  // ── Program P2 ────────────────────────────────────────────────────────────────
  const existingProgramP2 = await prisma.program.findFirst({ where: { tenantId, slug: LMS_PROGRAM_P2_SLUG } });
  const programP2 = existingProgramP2
    ? await prisma.program.update({ where: { id: existingProgramP2.id }, data: { status: "published" } })
    : await prisma.program.create({
        data: {
          tenantId,
          slug: LMS_PROGRAM_P2_SLUG,
          title: "QA LMS Program P2",
          domain: "test",
          level: "intermediate",
          mode: "recorded",
          durationWeeks: 4,
          pricePaise: 200000,
          currency: "INR",
          status: "published",
        },
      });

  // ── Batches (one per program) ─────────────────────────────────────────────────
  const existingBatchP1 = await prisma.batch.findFirst({
    where: { tenantId, name: LMS_BATCH_P1_NAME },
  });
  const batchP1 =
    existingBatchP1 ??
    (await prisma.batch.create({
      data: {
        tenantId,
        programId: programP1.id,
        branchId: branch.id,
        name: LMS_BATCH_P1_NAME,
        startDate: new Date("2026-03-01"),
        capacity: 20,
        mode: "recorded",
        schedule: [],
        status: "active",
      },
    }));

  const existingBatchP2 = await prisma.batch.findFirst({
    where: { tenantId, name: LMS_BATCH_P2_NAME },
  });
  const batchP2 =
    existingBatchP2 ??
    (await prisma.batch.create({
      data: {
        tenantId,
        programId: programP2.id,
        branchId: branch.id,
        name: LMS_BATCH_P2_NAME,
        startDate: new Date("2026-03-01"),
        capacity: 20,
        mode: "recorded",
        schedule: [],
        status: "active",
      },
    }));

  // ── Modules (one per program) ─────────────────────────────────────────────────
  const existingModP1 = await prisma.module.findFirst({
    where: { programId: programP1.id, title: "QA LMS Module P1" },
  });
  const moduleP1 =
    existingModP1 ??
    (await prisma.module.create({
      data: {
        programId: programP1.id,
        title: "QA LMS Module P1",
        order: 1,
      },
    }));

  const existingModP2 = await prisma.module.findFirst({
    where: { programId: programP2.id, title: "QA LMS Module P2" },
  });
  const moduleP2 =
    existingModP2 ??
    (await prisma.module.create({
      data: {
        programId: programP2.id,
        title: "QA LMS Module P2",
        order: 1,
      },
    }));

  // ── Lessons (non-preview + preview per program) ───────────────────────────────
  const existingLessonP1A = await prisma.lesson.findFirst({
    where: { moduleId: moduleP1.id, title: "QA LMS Lesson P1-A", isPreview: false },
  });
  const lessonP1A =
    existingLessonP1A ??
    (await prisma.lesson.create({
      data: {
        moduleId: moduleP1.id,
        title: "QA LMS Lesson P1-A",
        type: "video",
        order: 1,
        isPreview: false,
      },
    }));

  const existingLessonP1Preview = await prisma.lesson.findFirst({
    where: { moduleId: moduleP1.id, title: "QA LMS Lesson P1-Preview", isPreview: true },
  });
  const lessonP1Preview =
    existingLessonP1Preview ??
    (await prisma.lesson.create({
      data: {
        moduleId: moduleP1.id,
        title: "QA LMS Lesson P1-Preview",
        type: "video",
        order: 2,
        isPreview: true,
      },
    }));

  const existingLessonP2A = await prisma.lesson.findFirst({
    where: { moduleId: moduleP2.id, title: "QA LMS Lesson P2-A", isPreview: false },
  });
  const lessonP2A =
    existingLessonP2A ??
    (await prisma.lesson.create({
      data: {
        moduleId: moduleP2.id,
        title: "QA LMS Lesson P2-A",
        type: "video",
        order: 1,
        isPreview: false,
      },
    }));

  const existingLessonP2Preview = await prisma.lesson.findFirst({
    where: { moduleId: moduleP2.id, title: "QA LMS Lesson P2-Preview", isPreview: true },
  });
  const lessonP2Preview =
    existingLessonP2Preview ??
    (await prisma.lesson.create({
      data: {
        moduleId: moduleP2.id,
        title: "QA LMS Lesson P2-Preview",
        type: "video",
        order: 2,
        isPreview: true,
      },
    }));

  // ── Videos (ready status, noop provider) ─────────────────────────────────────
  // One video per non-preview lesson (stream-url tests need ready videos).
  const existingVideoP1A = await prisma.video.findFirst({
    where: { lessonId: lessonP1A.id },
  });
  const videoP1A =
    existingVideoP1A ??
    (await prisma.video.create({
      data: {
        tenantId,
        lessonId: lessonP1A.id,
        provider: "noop",
        providerAssetId: `qa-lms-asset-p1-${lessonP1A.id}`,
        durationS: 120,
        status: "ready",
      },
    }));

  const existingVideoP2A = await prisma.video.findFirst({
    where: { lessonId: lessonP2A.id },
  });
  const videoP2A =
    existingVideoP2A ??
    (await prisma.video.create({
      data: {
        tenantId,
        lessonId: lessonP2A.id,
        provider: "noop",
        providerAssetId: `qa-lms-asset-p2-${lessonP2A.id}`,
        durationS: 90,
        status: "ready",
      },
    }));

  // ── Preview lesson videos (processing so stream-url gives 409 on them) ────────
  // These don't need videos for stream-url tests (preview videos would give 409 if no video).
  // We skip adding videos to preview lessons — the gate returns null for non-ready.

  // ── Users ────────────────────────────────────────────────────────────────────
  const studentAUser = await ensureUser(
    prisma,
    tenantId,
    LMS_STUDENT_A_EMAIL,
    LMS_STUDENT_A_PASSWORD,
    "QA LMS Student A",
  );
  await upsertUserRole(prisma, studentAUser.id, studentRole.id);

  const studentBUser = await ensureUser(
    prisma,
    tenantId,
    LMS_STUDENT_B_EMAIL,
    LMS_STUDENT_B_PASSWORD,
    "QA LMS Student B",
  );
  await upsertUserRole(prisma, studentBUser.id, studentRole.id);

  // ── Student profiles ──────────────────────────────────────────────────────────
  const studentAProfile = await prisma.studentProfile.upsert({
    where: { userId: studentAUser.id },
    update: { status: "active" },
    create: {
      tenantId,
      userId: studentAUser.id,
      college: "QA College A",
      courseType: "btech",
      year: 2,
      city: "Hyderabad",
      source: "fixture",
      status: "active",
    },
  });

  const studentBProfile = await prisma.studentProfile.upsert({
    where: { userId: studentBUser.id },
    update: { status: "active" },
    create: {
      tenantId,
      userId: studentBUser.id,
      college: "QA College B",
      courseType: "btech",
      year: 3,
      city: "Bengaluru",
      source: "fixture",
      status: "active",
    },
  });

  // ── Enrollments ───────────────────────────────────────────────────────────────
  // Student A → P1 batch; Student B → P2 batch.
  // Use findFirst + create (no upsert available for the compound unique [studentId, batchId]).
  const existingEnrollA = await prisma.enrollment.findFirst({
    where: { studentId: studentAProfile.id, batchId: batchP1.id },
  });
  const enrollmentA =
    existingEnrollA ??
    (await prisma.enrollment.create({
      data: {
        tenantId,
        studentId: studentAProfile.id,
        batchId: batchP1.id,
        programId: programP1.id,
        status: "active",
        source: "manual",
        progressPct: 0,
      },
    }));

  const existingEnrollB = await prisma.enrollment.findFirst({
    where: { studentId: studentBProfile.id, batchId: batchP2.id },
  });
  const enrollmentB =
    existingEnrollB ??
    (await prisma.enrollment.create({
      data: {
        tenantId,
        studentId: studentBProfile.id,
        batchId: batchP2.id,
        programId: programP2.id,
        status: "active",
        source: "manual",
        progressPct: 0,
      },
    }));

  return {
    tenantId,
    branchId: branch.id,
    programP1Id: programP1.id,
    programP2Id: programP2.id,
    batchP1Id: batchP1.id,
    batchP2Id: batchP2.id,
    moduleP1Id: moduleP1.id,
    moduleP2Id: moduleP2.id,
    lessonP1AId: lessonP1A.id,
    lessonP2AId: lessonP2A.id,
    lessonP1PreviewId: lessonP1Preview.id,
    lessonP2PreviewId: lessonP2Preview.id,
    videoP1AId: videoP1A.id,
    videoP2AId: videoP2A.id,
    studentAUserId: studentAUser.id,
    studentBUserId: studentBUser.id,
    studentAProfileId: studentAProfile.id,
    studentBProfileId: studentBProfile.id,
    enrollmentAId: enrollmentA.id,
    enrollmentBId: enrollmentB.id,
  };
}

/**
 * Deletes only the rows THIS fixture file creates. Safe to call against a
 * shared dev DB. Deletes in FK-safe order.
 */
export async function teardownLmsFixtures(
  prisma: PrismaClient,
  _tenantId: string,
): Promise<void> {
  const fixtureUsers = await prisma.user.findMany({
    where: { email: { in: ALL_LMS_FIXTURE_EMAILS } },
    select: { id: true },
  });
  const userIds = fixtureUsers.map((u) => u.id);

  const studentProfiles = await prisma.studentProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const studentProfileIds = studentProfiles.map((s) => s.id);

  // Enrollments for our fixture students.
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: { in: studentProfileIds } },
    select: { id: true },
  });
  const enrollmentIds = enrollments.map((e) => e.id);

  // Delete in FK-safe order: attendance → lesson_progress → enrollments → ...
  if (enrollmentIds.length) {
    await prisma.attendance.deleteMany({
      where: { enrollmentId: { in: enrollmentIds } },
    });
    await prisma.lessonProgress.deleteMany({
      where: { enrollmentId: { in: enrollmentIds } },
    });
    await prisma.enrollment.deleteMany({
      where: { id: { in: enrollmentIds } },
    });
  }

  // Videos for our fixture lessons.
  const fixturePrograms = await prisma.program.findMany({
    where: {
      slug: { in: [LMS_PROGRAM_P1_SLUG, LMS_PROGRAM_P2_SLUG] },
    },
    select: { id: true },
  });
  const programIds = fixturePrograms.map((p) => p.id);

  if (programIds.length) {
    const modules = await prisma.module.findMany({
      where: { programId: { in: programIds } },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);

    if (moduleIds.length) {
      const lessons = await prisma.lesson.findMany({
        where: { moduleId: { in: moduleIds } },
        select: { id: true },
      });
      const lessonIds = lessons.map((l) => l.id);

      if (lessonIds.length) {
        await prisma.video.deleteMany({ where: { lessonId: { in: lessonIds } } });
        await prisma.resource.deleteMany({ where: { lessonId: { in: lessonIds } } });
        await prisma.attendance.deleteMany({ where: { lessonId: { in: lessonIds } } });
        await prisma.lessonProgress.deleteMany({ where: { lessonId: { in: lessonIds } } });
        await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
      }

      await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    }

    // Batches for our programs.
    await prisma.batch.deleteMany({ where: { programId: { in: programIds } } });

    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }

  // Student profiles + users.
  await prisma.studentProfile.deleteMany({ where: { id: { in: studentProfileIds } } });

  if (userIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await purgeAuditLogs(prisma, { actorId: { in: userIds } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  // Branch (only delete the QA-specific one).
  //
  // qa-engineer Wave 5 fix (docs/plans/phase-9-completion.md T41, item 3 — integration-
  // suite flakiness): this branch is looked up/reused BY NAME across every run
  // (`findFirst` above, not per-suffix like the programs/lessons/users this file also
  // owns) — a prior run that crashed/timed-out BEFORE reaching this teardown could leave
  // orphaned `Batch` rows pointing at it whose `programId` is NOT in THIS run's
  // `programIds` (that program was already deleted by ITS OWN teardown, or belonged to a
  // since-removed fixture program version) — `batch.deleteMany({ where: { programId: {
  // in: programIds } } })` above only ever targeted batches for the CURRENT run's
  // programs, so those orphans survived and `branch.deleteMany` below threw
  // `batches_branch_id_fkey`, aborting THIS run's teardown too (observed running the
  // full integration suite back-to-back). Since this branch's name is exclusively used
  // by this fixture file (never by `prisma/seed.ts` or any other fixture), it is safe to
  // sweep every batch still pointing at it, not just the ones this run itself created.
  const fixtureBranch = await prisma.branch.findFirst({
    where: { name: "QA LMS Fixture Branch" },
    select: { id: true },
  });
  if (fixtureBranch) {
    const orphanBatches = await prisma.batch.findMany({
      where: { branchId: fixtureBranch.id },
      select: { id: true },
    });
    const orphanBatchIds = orphanBatches.map((b) => b.id);
    if (orphanBatchIds.length) {
      // Same rationale as the branch-orphan comment above: an orphaned batch from a
      // prior crashed run may still have its OWN enrollments (this fixture's only
      // producer of Enrollment rows is always tied to one of ITS batches) — cascade the
      // same FK-safe order used for the current run's own enrollments above before the
      // batch itself can be deleted.
      const orphanEnrollments = await prisma.enrollment.findMany({
        where: { batchId: { in: orphanBatchIds } },
        select: { id: true },
      });
      const orphanEnrollmentIds = orphanEnrollments.map((e) => e.id);
      if (orphanEnrollmentIds.length) {
        await prisma.certificate.deleteMany({ where: { enrollmentId: { in: orphanEnrollmentIds } } });
        await prisma.attempt.deleteMany({ where: { enrollmentId: { in: orphanEnrollmentIds } } });
        await prisma.submission.deleteMany({ where: { enrollmentId: { in: orphanEnrollmentIds } } });
        await prisma.attendance.deleteMany({ where: { enrollmentId: { in: orphanEnrollmentIds } } });
        await prisma.lessonProgress.deleteMany({ where: { enrollmentId: { in: orphanEnrollmentIds } } });
        await prisma.enrollment.deleteMany({ where: { id: { in: orphanEnrollmentIds } } });
      }
      await prisma.batchMentor.deleteMany({ where: { batchId: { in: orphanBatchIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: orphanBatchIds } } });
    }
  }
  await prisma.branch.deleteMany({
    where: { name: "QA LMS Fixture Branch" },
  });

  // Intentionally leave the shared tenant/roles/permission-catalog rows in place
  // (same rationale as commerce-leads-fixtures.ts).
}
