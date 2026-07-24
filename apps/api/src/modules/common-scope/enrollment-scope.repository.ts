// apps/api/src/modules/common-scope/enrollment-scope.repository.ts
//
// Shared scope-resolution helper (Wave 3b — closes the Wave-3a "students branch/assigned
// scope fail-closed" gap documented in students.service.ts / students.repository.ts file
// headers). Now that `batches`/`enrollments` exist, a student's branch and a faculty
// member's "assigned" students/programs ARE resolvable — but only via the
// batches/enrollments join, which students/faculty/courses repositories should not
// duplicate ad-hoc. This repository is the single, reusable place that knows how to turn
// "caller's branch ids" / "caller's faculty_profiles.id" into the concrete id sets the
// students/faculty/courses modules need, via Prisma reads ONLY (no business logic — same
// "repository" contract as every other repository in this codebase, just shared across
// module boundaries instead of owned by one module).
//
// HOW WAVE-3a MODULES SHOULD CONSUME THIS (documented integration seam):
//   - students.service.ts `assertAllScope()` -> replace the `branch`/`assigned` branches
//     with a call to `resolveStudentIdsForBranches()` / `resolveStudentIdsForFaculty()`
//     below, then pass the resulting `studentProfileIds` into
//     `StudentsRepository.list({ ..., restrictToIds: studentProfileIds })` (a new optional
//     filter the students repository would need to add — left as the concrete follow-up
//     since this Wave does not modify students.service.ts/students.repository.ts directly,
//     to avoid touching Wave-3a's already-tested files. See "Wave-3a gap closure" in this
//     module's report for the exact two-line patch each fail-closed branch needs).
//   - courses.service.ts `assertResolvableScope()` "assigned" branch -> replace with
//     `resolveProgramIdsForFaculty()` below (derives "faculty's courses" = programs that
//     have a batch taught by this faculty, per the task brief's option (a)).
//
// Every method here is tenant-scoped and returns empty arrays (never throws, never
// returns "all") when the caller has no resolvable rows — callers MUST treat an empty
// array as "filter to zero rows", not as "no filter" (the same fail-closed discipline as
// `requireScopeContext()`).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class EnrollmentScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Student-profile ids visible to a "branch" scope: students with at least one
   * (non-deleted) enrollment in a batch whose `branchId` is in `branchIds`. This is the
   * concrete resolution for the Wave-3a `students.service.ts` "branch" fail-closed TODO.
   */
  async resolveStudentIdsForBranches(tenantId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.client.enrollment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        batch: { branchId: { in: branchIds }, deletedAt: null },
      },
      select: { studentId: true },
      distinct: ["studentId"],
    });
    return rows.map((row) => row.studentId);
  }

  /**
   * Student-profile ids "assigned" to a faculty member: students with at least one
   * (non-deleted) enrollment in a batch taught by `facultyProfileId`
   * (`batches.facultyId`). Resolution for the Wave-3a `students.service.ts` "assigned"
   * fail-closed TODO.
   */
  async resolveStudentIdsForFaculty(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        batch: { facultyId: facultyProfileId, deletedAt: null },
      },
      select: { studentId: true },
      distinct: ["studentId"],
    });
    return rows.map((row) => row.studentId);
  }

  /**
   * Batch ids taught by a faculty member (`batches.facultyId = facultyProfileId`) —
   * the "assigned" scope resolution for the batches module itself.
   */
  async resolveBatchIdsForFaculty(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Program ids "authored"/taught by a faculty member, derived per the task brief's
   * pragmatic option (a): "faculty's courses" = programs that have at least one batch
   * taught by this faculty (`batches.facultyId`). No `programs.created_by` column exists
   * in the P1 schema (confirmed against prisma/schema.prisma) — this is the chosen
   * resolution for the Wave-3a `courses.service.ts` "assigned" fail-closed TODO, in
   * preference to a schema migration, since "the faculty member teaching a batch of this
   * program" is a reasonable, already-modeled proxy for authorship/ownership in P1. If a
   * future phase needs true authorship (a program with no batches yet, or co-authorship
   * independent of teaching), add `programs.created_by` then.
   */
  async resolveProgramIdsForFaculty(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { programId: true },
      distinct: ["programId"],
    });
    return rows.map((row) => row.programId);
  }

  // ── Phase 8 (human Mentor track, docs/specs/phase-8-mentor.md LOCK-2/Rule M-1) ──────
  //
  // Mentor `assigned` scope is the M:N analogue of `resolveBatchIdsForFaculty` above:
  // `enrollment.batch_id -> batch_mentors WHERE mentor_id = current_user.mentorProfile.id
  // AND deleted_at IS NULL`, instead of a single `batches.facultyId` FK. Fail-closed
  // identically — a Mentor-role user with no `mentors` row (userId never linked, or the
  // row was soft-deleted), or with zero active `batch_mentors` rows, resolves to `[]`
  // (never "all"). Callers MUST treat `[]` as "filter to zero rows".

  /**
   * Batch ids a Mentor (resolved by `userId`, NOT a pre-resolved mentor-profile id — see
   * task brief) is actively assigned to via `batch_mentors`. Mirrors
   * `resolveBatchIdsForFaculty`'s shape/contract but resolves its own profile id
   * internally (Mentor's `assigned` scope has no equivalent of a repository-level
   * `findOwnFacultyProfileId` today, so this method folds that lookup in rather than
   * requiring every caller to resolve the mentor profile id first).
   */
  async resolveBatchIdsForMentor(tenantId: string, userId: string): Promise<string[]> {
    const mentor = await this.prisma.client.mentor.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!mentor) {
      return [];
    }
    const rows = await this.prisma.client.batchMentor.findMany({
      where: { tenantId, mentorId: mentor.id, deletedAt: null },
      select: { batchId: true },
    });
    return rows.map((row) => row.batchId);
  }

  // ── Phase 9 (docs/plans/phase-9-completion.md T20 — Live Class "own" scope) ────────
  //
  // A student's OWN scope resolves to the batches they hold an active (non-deleted)
  // enrollment in — resolved by `userId` (NOT a pre-resolved student-profile id), folding
  // the `user_id -> student_profiles.id` lookup in, mirroring `resolveBatchIdsForMentor`'s
  // shape/contract exactly. Fails closed to `[]` (never "all") when the caller has no
  // `student_profiles` row or zero active enrollments.

  /**
   * Batch ids a student (resolved by `userId`) holds an active enrollment in. Used by the
   * Live Class module's `own` scope (student view/join own-batch sessions) and reusable by
   * any future own-scope module keyed off enrollment membership.
   */
  async resolveBatchIdsForStudent(tenantId: string, userId: string): Promise<string[]> {
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!student) {
      return [];
    }
    const rows = await this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId: student.id, deletedAt: null, batch: { deletedAt: null } },
      select: { batchId: true },
      distinct: ["batchId"],
    });
    return rows.map((row) => row.batchId);
  }
}
