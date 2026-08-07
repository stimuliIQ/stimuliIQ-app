// apps/api/src/modules/students/students.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1: "repository never contains
// business logic"). StudentsService is the only caller. Every query goes through
// `PrismaService.client` (soft-delete + audit extensions already applied — see
// apps/api/src/prisma/prisma.service.ts) and is ALWAYS tenant-scoped from the caller's
// `req.user.tenantId` (CLAUDE.md §3: "never trust a tenantId from the client body").
//
// SCOPE RESOLUTION (docs/03 §9 matrix; docs/plans/phase-1.md Wave-3 task brief; Wave 3b
// closes the branch/assigned gap) — `student_profiles` carries NO branch/owner column of
// its own (confirmed against prisma/schema.prisma: `StudentProfile` has `tenantId`,
// `userId`, college/courseType/year/city/source/status only — no `branchId`, no
// `ownerId`). A student's branch is only resolvable via `enrollments ->
// batches.branchId`, and "assigned" (faculty) only via `enrollments ->
// batches.facultyId`. students.service.ts resolves the caller's scope into a concrete
// student-profile id set (via `EnrollmentScopeRepository`, shared across modules) BEFORE
// calling this repository, and passes it as `restrictToIds`. Concretely:
//   - scope "all"      -> tenant-wide (no extra filter). `restrictToIds` is `undefined`.
//   - scope "branch"   -> `restrictToIds` is the (possibly empty) set of student-profile
//                          ids enrolled in a batch whose `branchId` is one of the
//                          caller's branch ids. Empty array filters to zero rows.
//   - scope "assigned" -> `restrictToIds` is the (possibly empty) set of student-profile
//                          ids enrolled in a batch taught by the caller's faculty profile.
//   - scope "own"      -> not a meaningful scope for the students module in P1; the
//                          service fails closed before this repository is ever called.
// This repository never resolves a scope itself — it only ever applies the already-
// resolved `restrictToIds` set (or no filter, for scope "all") that students.service.ts
// computed via the shared `EnrollmentScopeRepository`.

import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  Prisma,
  StudentProfileStatus,
  StudentCourseType,
  EnrollmentStatus,
  LeadStage,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The raw per-student facts needed to derive the unified lifecycle stage
 * (lifecycle-redesign P1). Collapsed to ONE representative enrollment (the
 * furthest-along) plus commerce/certificate/lead flags — exactly the signal
 * bundle `resolveLifecycleStage()` consumes. Computed in a single batched
 * query per directory page (see `getLifecycleSignals`).
 */
export interface StudentLifecycleSignals {
  /** The furthest-along enrollment collapsed to a single {status, progress}, or null. */
  enrollment: { status: EnrollmentStatus; progressPct: number } | null;
  /** Whether ANY order exists for the student (paid or not). */
  hasOrder: boolean;
  /** Whether any order is captured/paid. */
  hasPaidOrder: boolean;
  /** Whether a currently-valid certificate has been issued. */
  hasCertificate: boolean;
  /** The stage of the lead this student was converted from, if any. */
  leadStage: LeadStage | null;
}

export interface ListStudentsFilters {
  tenantId: string;
  search?: string;
  status?: StudentProfileStatus;
  courseType?: StudentCourseType;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
  /**
   * Student-profile ids to restrict to, when the caller's scope is "branch"/"assigned"
   * (resolved by students.service.ts via EnrollmentScopeRepository). `undefined` means no
   * restriction (scope "all"); an empty array means "match zero rows" — NEVER treat an
   * empty array as "no filter".
   */
  restrictToIds?: string[];
}

export interface StudentRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  college: string | null;
  alternatePhone: string | null;
  courseType: StudentCourseType;
  year: number | null;
  city: string | null;
  source: string | null;
  status: StudentProfileStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

@Injectable()
export class StudentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListStudentsFilters): Promise<{ rows: StudentRow[]; total: number }> {
    const where: Prisma.StudentProfileWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.courseType ? { courseType: filters.courseType } : {}),
      // See findById()'s comment: the soft-delete extension re-injects `deletedAt: null`
      // for any `where` missing the `deletedAt` KEY entirely — `deletedAt: undefined` (a
      // present key) is required to actually opt out when `includeDeleted` is true.
      deletedAt: filters.includeDeleted ? undefined : null,
      ...(filters.restrictToIds ? { id: { in: filters.restrictToIds } } : {}),
      ...(filters.search
        ? {
            user: {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search, mode: "insensitive" } },
                { phone: { contains: filters.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.studentProfile.count({ where }),
    ]);

    return { rows: rows.map(toStudentRow), total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<StudentRow | null> {
    // NOTE: the soft-delete extension (soft-delete.extension.ts `withNotDeleted`) injects
    // `deletedAt: null` into any `where` that does NOT already have a `deletedAt` KEY —
    // an absent key, not merely a falsy/undefined value, is what triggers the injection.
    // So `includeDeleted` must explicitly set `deletedAt: undefined` (a present key) to
    // opt out of the filter and see soft-deleted rows; spreading `{}` leaves the key
    // absent and the extension silently re-adds `deletedAt: null` anyway, which is why a
    // bare `findById(..., true)` immediately after `softDelete()` would otherwise always
    // return null.
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
      include: { user: true },
    });
    return row ? toStudentRow(row) : null;
  }

  /**
   * Batch-fetch the lifecycle signals for a set of student-profile ids (one page of
   * the directory / a single detail row). Runs four cheap indexed queries
   * (enrollments, orders, certificates, originating leads) keyed on `studentId in (…)`,
   * then reduces per student to the furthest-along enrollment. Returns a Map so the
   * service can enrich each row in O(1); students with no signals are simply absent.
   *
   * Deliberately NOT joined into `list()`'s main query: keeping it a separate batched
   * lookup avoids fanning the directory query into a multi-table join that Prisma would
   * materialize per row, and it scopes the work to exactly the page being returned.
   */
  async getLifecycleSignals(
    tenantId: string,
    studentIds: string[],
  ): Promise<Map<string, StudentLifecycleSignals>> {
    const result = new Map<string, StudentLifecycleSignals>();
    if (studentIds.length === 0) return result;

    const [enrollments, orders, certificates, leads] = await Promise.all([
      this.prisma.client.enrollment.findMany({
        where: { tenantId, studentId: { in: studentIds } },
        select: { studentId: true, status: true, progressPct: true },
      }),
      this.prisma.client.order.findMany({
        where: { tenantId, studentId: { in: studentIds } },
        select: { studentId: true, status: true },
      }),
      this.prisma.client.certificate.findMany({
        where: { tenantId, studentId: { in: studentIds }, status: "valid" },
        select: { studentId: true },
      }),
      // The originating lead denormalizes onto `convertedStudentId`. Bypass the
      // soft-delete filter (deletedAt: undefined) so a converted-then-archived lead
      // still contributes its stage.
      this.prisma.client.lead.findMany({
        where: { tenantId, convertedStudentId: { in: studentIds }, deletedAt: undefined },
        select: { convertedStudentId: true, stage: true },
      }),
    ]);

    const ensure = (id: string): StudentLifecycleSignals => {
      let s = result.get(id);
      if (!s) {
        s = { enrollment: null, hasOrder: false, hasPaidOrder: false, hasCertificate: false, leadStage: null };
        result.set(id, s);
      }
      return s;
    };

    // Collapse each student's enrollments to the single furthest-along one.
    for (const e of enrollments) {
      const s = ensure(e.studentId);
      s.enrollment = mergeFurthestEnrollment(s.enrollment, {
        status: e.status,
        progressPct: e.progressPct,
      });
    }
    for (const o of orders) {
      const s = ensure(o.studentId);
      s.hasOrder = true;
      if (o.status === "paid") s.hasPaidOrder = true;
    }
    for (const c of certificates) {
      ensure(c.studentId).hasCertificate = true;
    }
    for (const l of leads) {
      if (l.convertedStudentId) ensure(l.convertedStudentId).leadStage = l.stage;
    }

    return result;
  }

  async findUserByEmail(tenantId: string, email: string): Promise<{ id: string } | null> {
    return this.prisma.client.user.findFirst({ where: { tenantId, email }, select: { id: true } });
  }

  /**
   * Like findUserByEmail, but also reports WHAT holds the address. `users.email` is
   * UNIQUE per tenant (non-partial), and soft-deleting a student only deletes its
   * `student_profiles` row — the `users` row survives and keeps owning the email.
   * Without this context the create path can only say "email in use", and a student
   * you deleted could NEVER be re-added. Callers use `deletedStudentProfileId` to
   * restore the profile instead of erroring.
   *
   * Two deliberate soft-delete opt-outs (see prisma/soft-delete.extension.ts):
   *   - `deletedAt: undefined` in the top-level where: the mere PRESENCE of a
   *     `deletedAt` key makes the extension skip injecting `deletedAt: null`, so a
   *     soft-deleted user (which still owns the email at the DB level) is found and
   *     reported rather than sailing into a unique-constraint 500.
   *   - Nested relation selects are not filtered by the extension at all, so the
   *     profile rows come back regardless of their own `deletedAt`.
   */
  async findUserByEmailWithOwner(
    tenantId: string,
    email: string,
  ): Promise<{
    userId: string;
    /** Set when the email belongs to a student whose profile is soft-deleted (restorable). */
    deletedStudentProfileId: string | null;
    /** What currently holds the email — used verbatim in the caller's error message. */
    heldBy: string;
  } | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { tenantId, email, deletedAt: undefined },
      select: {
        id: true,
        deletedAt: true,
        studentProfile: { select: { id: true, deletedAt: true } },
        facultyProfile: { select: { id: true, deletedAt: true } },
        mentorProfile: { select: { id: true, deletedAt: true } },
      },
    });
    if (!user) return null;

    const student = user.studentProfile;
    if (student && student.deletedAt !== null) {
      return {
        userId: user.id,
        deletedStudentProfileId: student.id,
        heldBy: "a deleted student record",
      };
    }

    const heldBy =
      user.deletedAt !== null
        ? "a deleted account"
        : student
          ? "an existing student"
          : user.facultyProfile && user.facultyProfile.deletedAt === null
            ? "a faculty member"
            : user.mentorProfile && user.mentorProfile.deletedAt === null
              ? "a mentor"
              : "another user (staff or admin)";

    return { userId: user.id, deletedStudentProfileId: null, heldBy };
  }

  /**
   * Creates the backing `users` row (role `student`, status `invited`) + the
   * `student_profiles` row in ONE transaction (docs/plans/phase-1.md task brief:
   * "in ONE transaction"). Returns the created profile id + userId for the caller to
   * re-fetch via `findById`.
   */
  async createStudentWithUser(args: {
    tenantId: string;
    name: string;
    email: string;
    phone?: string;
    alternatePhone?: string;
    college?: string;
    courseType: StudentCourseType;
    year?: number;
    city?: string;
    source?: string;
    status: StudentProfileStatus;
  }): Promise<{ id: string; userId: string }> {
    return this.prisma.client.$transaction(async (tx) => {
      const studentRole = await tx.role.findUnique({
        where: { tenantId_key: { tenantId: args.tenantId, key: "student" } },
        select: { id: true },
      });
      if (!studentRole) {
        // A bare `Error` here surfaced to the CRM as "Internal server error" with nothing
        // to act on — the counsellor converting a lead had no way to know a ROLE was
        // missing, let alone which one or how to restore it. This happened in production
        // on 2026-07-29 when the "student" role was soft-deleted (see
        // UNDELETABLE_ROLE_KEYS in admin/roles.service.ts, which now prevents it).
        // A 503 with a named cause is honest: the request is valid, the tenant is
        // misconfigured, and the fix is an admin action rather than a retry.
        throw new ServiceUnavailableException({
          code: "students.student_role_missing",
          title: "The Student role is missing",
          detail:
            'This tenant has no active "student" role, so a student account cannot be created. Restore it under Admin → Roles, then try again.',
        });
      }

      const user = await tx.user.create({
        data: {
          tenantId: args.tenantId,
          name: args.name,
          email: args.email,
          phone: args.phone,
          passwordHash: "", // invited, no login until a P5 invite flow sets a password.
          status: "invited",
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: studentRole.id, branchId: null },
      });

      const profile = await tx.studentProfile.create({
        data: {
          tenantId: args.tenantId,
          userId: user.id,
          alternatePhone: args.alternatePhone,
          college: args.college,
          courseType: args.courseType,
          year: args.year,
          city: args.city,
          source: args.source,
          status: args.status,
        },
      });

      return { id: profile.id, userId: user.id };
    });
  }

  /**
   * Partial update spanning both the `users` row (name/phone) and the
   * `student_profiles` row (college/courseType/year/city/source/status), in one
   * transaction so a partial failure never leaves the two rows inconsistent.
   */
  async updateStudent(
    tenantId: string,
    id: string,
    userId: string,
    patch: {
      name?: string;
      phone?: string;
      alternatePhone?: string | null;
      college?: string;
      courseType?: StudentCourseType;
      year?: number;
      city?: string;
      source?: string;
      status?: StudentProfileStatus;
    },
  ): Promise<void> {
    const { name, phone, ...profilePatch } = patch;

    await this.prisma.client.$transaction(async (tx) => {
      if (name !== undefined || phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}) },
        });
      }
      if (Object.keys(profilePatch).length > 0) {
        await tx.studentProfile.update({
          where: { id },
          data: profilePatch,
        });
      }
    });
    void tenantId; // tenant ownership already verified by the caller via findById before this runs.
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.studentProfile.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async restore(id: string): Promise<void> {
    await this.prisma.client.studentProfile.update({ where: { id }, data: { deletedAt: null } });
  }
}

/**
 * Reduce two enrollments to the one that represents the furthest lifecycle progress.
 * Ranking: completed/100% > active-with-progress > active-no-progress > dropped.
 * `dropped` only wins when it is the ONLY thing present (a student with any active or
 * completed enrollment is not "dropped").
 */
function mergeFurthestEnrollment(
  current: { status: EnrollmentStatus; progressPct: number } | null,
  next: { status: EnrollmentStatus; progressPct: number },
): { status: EnrollmentStatus; progressPct: number } {
  if (!current) return next;
  const rank = (e: { status: EnrollmentStatus; progressPct: number }): number => {
    if (e.status === "completed" || e.progressPct >= 100) return 3_000 + e.progressPct;
    if (e.status === "active") return 1_000 + e.progressPct; // 1000..1099
    return 0; // dropped
  };
  return rank(next) > rank(current) ? next : current;
}

function toStudentRow(row: {
  id: string;
  userId: string;
  college: string | null;
  alternatePhone: string | null;
  courseType: StudentCourseType;
  year: number | null;
  city: string | null;
  source: string | null;
  status: StudentProfileStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: { name: string; email: string; phone: string | null };
}): StudentRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    phone: row.user.phone,
    college: row.college,
    alternatePhone: row.alternatePhone,
    courseType: row.courseType,
    year: row.year,
    city: row.city,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
