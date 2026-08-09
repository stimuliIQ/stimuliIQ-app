// apps/api/src/modules/faculty/faculty.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). FacultyService is the only
// caller. Every query is tenant-scoped from the caller's `req.user.tenantId`, and — unlike
// students — `faculty_profiles.branchId` is a DIRECT column, so "branch" scope IS fully
// resolvable here (no Wave-3b dependency, unlike the students module). "own"/"self" scope
// is resolved by filtering to the caller's own `faculty_profiles.userId`.
//
// SCOPE RESOLUTION (docs/03 §9 + prisma/seed.ts):
//   - "all"      -> tenant-wide. super_admin/admin/support(view-all).
//   - "branch"   -> `faculty_profiles.branchId IN (caller's user_roles.branchId values)`.
//                    branch_manager is seeded at this scope. Resolved fully in P1 (no gap).
//   - "assigned" -> NOT seeded for the faculty module itself in P1 (faculty's "assigned"
//                    grants in seed.ts are for students/batches/courses, not faculty.*).
//                    Fails closed defensively in the service if ever encountered.
//   - "own"      -> faculty role is seeded `faculty.view`/`faculty.edit` at scope=own —
//                    filtered to the caller's own `faculty_profiles.userId = actorId`.

import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListFacultyFilters {
  tenantId: string;
  search?: string;
  branchId?: string;
  expertise?: string;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
  /** Branch ids to additionally restrict to, when the caller's scope is "branch". Undefined = no extra restriction (scope "all"). */
  restrictToBranchIds?: string[];
  /** When the caller's scope is "own", restrict to this single user id (the caller's own faculty profile). */
  restrictToOwnUserId?: string;
}

export interface FacultyRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  expertise: string[];
  bio: string | null;
  rating: number | null;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AssignedBatchRow {
  id: string;
  programId: string;
  programTitle: string;
  branchId: string;
  branchName: string;
  facultyId: string | null;
  facultyName: string | null;
  name: string;
  startDate: Date;
  endDate: Date | null;
  capacity: number;
  enrolledCount: number;
  mode: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class FacultyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListFacultyFilters): Promise<{ rows: FacultyRow[]; total: number }> {
    const where: Prisma.FacultyProfileWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      // See findById()'s comment: the soft-delete extension re-injects `deletedAt: null`
      // for any `where` missing the `deletedAt` KEY entirely — `deletedAt: undefined` (a
      // present key) is required to actually opt out when `includeDeleted` is true.
      deletedAt: filters.includeDeleted ? undefined : null,
      ...(filters.restrictToBranchIds ? { branchId: { in: filters.restrictToBranchIds } } : {}),
      ...(filters.restrictToOwnUserId ? { userId: filters.restrictToOwnUserId } : {}),
      ...(filters.search
        ? {
            user: {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.facultyProfile.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.facultyProfile.count({ where }),
    ]);

    const filtered = filters.expertise
      ? rows.filter((row) => Array.isArray(row.expertise) && (row.expertise as unknown[]).includes(filters.expertise))
      : rows;

    return { rows: filtered.map(toFacultyRow), total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<FacultyRow | null> {
    // NOTE: the soft-delete extension (soft-delete.extension.ts `withNotDeleted`) injects
    // `deletedAt: null` into any `where` that does NOT already have a `deletedAt` KEY —
    // an absent key, not merely a falsy/undefined value, triggers the injection. So
    // `includeDeleted` must explicitly set `deletedAt: undefined` (a present key) to opt
    // out and see soft-deleted rows; a bare `findById(..., true)` immediately after
    // `softDelete()` would otherwise always return null.
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
      include: { user: true },
    });
    return row ? toFacultyRow(row) : null;
  }

  async findUserByEmail(tenantId: string, email: string): Promise<{ id: string } | null> {
    return this.prisma.client.user.findFirst({ where: { tenantId, email }, select: { id: true } });
  }

  /** The caller's own faculty_profiles row, used to resolve "own"/"self" scope. */
  async findOwnFacultyId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Branch ids the caller's `user_roles` rows are scoped to (non-null `branchId`
   * entries only). Used to resolve "branch" scope — a branch_manager's `user_roles`
   * row(s) carry the branch(es) they manage (docs/05 §3: `user_roles.branch_id`).
   */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  async listAssignedBatches(facultyId: string): Promise<AssignedBatchRow[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { facultyId, deletedAt: null },
      include: {
        program: { select: { title: true } },
        branch: { select: { name: true } },
        faculty: { select: { id: true, user: { select: { name: true } } } },
        enrollments: { where: { status: { in: ["active", "completed"] }, deletedAt: null }, select: { id: true } },
      },
      orderBy: { startDate: "desc" },
    });

    return rows.map((row) => ({
      id: row.id,
      programId: row.programId,
      programTitle: row.program.title,
      branchId: row.branchId,
      branchName: row.branch.name,
      facultyId: row.faculty?.id ?? null,
      facultyName: row.faculty?.user.name ?? null,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      capacity: row.capacity,
      enrolledCount: row.enrollments.length,
      mode: row.mode,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  async createFacultyWithUser(args: {
    tenantId: string;
    name: string;
    email: string;
    phone?: string;
    expertise: string[];
    bio?: string;
    branchId?: string;
  }): Promise<{ id: string; userId: string }> {
    return this.prisma.client.$transaction(async (tx) => {
      const facultyRole = await tx.role.findUnique({
        where: { tenantId_key: { tenantId: args.tenantId, key: "faculty" } },
        select: { id: true },
      });
      if (!facultyRole) {
        // Same reasoning as students.repository.ts's student-role guard: a bare Error
        // reaches the CRM as an unactionable "Internal server error".
        throw new ServiceUnavailableException({
          code: "faculty.faculty_role_missing",
          title: "The Faculty role is missing",
          detail:
            'This tenant has no active "faculty" role, so a faculty account cannot be created. Restore it under Admin → Roles, then try again.',
        });
      }

      const user = await tx.user.create({
        data: {
          tenantId: args.tenantId,
          name: args.name,
          email: args.email,
          phone: args.phone,
          passwordHash: "",
          status: "invited",
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: facultyRole.id, branchId: args.branchId ?? null },
      });

      const profile = await tx.facultyProfile.create({
        data: {
          tenantId: args.tenantId,
          userId: user.id,
          expertise: args.expertise,
          bio: args.bio,
          branchId: args.branchId,
        },
      });

      return { id: profile.id, userId: user.id };
    });
  }

  async updateFaculty(
    id: string,
    userId: string,
    patch: {
      name?: string;
      phone?: string;
      expertise?: string[];
      bio?: string;
      branchId?: string | null;
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
        await tx.facultyProfile.update({ where: { id }, data: profilePatch });
      }
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.facultyProfile.delete({ where: { id } });
  }

  async restore(id: string): Promise<void> {
    await this.prisma.client.facultyProfile.update({ where: { id }, data: { deletedAt: null } });
  }
}

function toFacultyRow(row: {
  id: string;
  userId: string;
  expertise: unknown;
  bio: string | null;
  rating: number | null;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: { name: string; email: string; phone: string | null };
}): FacultyRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    phone: row.user.phone,
    expertise: Array.isArray(row.expertise) ? (row.expertise as string[]) : [],
    bio: row.bio,
    rating: row.rating,
    branchId: row.branchId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
