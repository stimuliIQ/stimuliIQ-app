// apps/api/src/modules/admin/users.service.ts
//
// Business logic for Admin ▸ Users (staff-account credential management). No Prisma
// here (CLAUDE.md §3.3). Permission keys users.view/create/edit/delete are seeded at
// scope=all for super_admin + admin only, so like roles.service.ts there is no
// data-scope resolution — only the safety guards below:
//
//   - Students never surface here (repository filters to non-student roles) and the
//     `student` role can never be assigned from this surface — student accounts are
//     owned by the enrollment flow.
//   - You cannot deactivate/suspend YOURSELF (locking the last admin out of the CRM
//     one click at a time is a classic foot-gun).
//   - A password reset or a deactivation revokes every refresh session for the target
//     user (a rotated credential or a disabled account must not keep working until the
//     old refresh token expires).
//   - Every mutation writes one explicit audit row (entity="User") with before/after.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import type { StaffUser, CreateStaffUserRequest, ListStaffUsersQuery, UpdateStaffUserRequest } from "@repo/types";
import { UsersAdminRepository, type StaffUserRow } from "./users.repository";
import { AuthRepository } from "../auth/auth.repository";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { PaginatedResult } from "../../common/dto/paginated-result";

function toDto(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name })),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The audit snapshot — never includes the password hash. */
function auditSnapshot(row: StaffUserRow) {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.userRoles.map((ur) => ur.role.key),
  };
}

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly repository: UsersAdminRepository,
    private readonly authRepository: AuthRepository,
  ) {}

  async list(tenantId: string, query: ListStaffUsersQuery): Promise<PaginatedResult<StaffUser>> {
    const { rows, total } = await this.repository.list(tenantId, {
      search: query.search,
      roleId: query.roleId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<StaffUser> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    return toDto(row);
  }

  async create(tenantId: string, actorId: string, body: CreateStaffUserRequest, ip?: string): Promise<StaffUser> {
    if (await this.repository.emailTaken(tenantId, body.email)) {
      throw new ConflictException({
        code: "users.email_taken",
        title: "Email already in use",
        detail: `A user with email "${body.email}" already exists.`,
      });
    }
    const roleIds = await this.resolveStaffRoleIds(tenantId, body.roleIds);

    const passwordHash = await argon2.hash(body.password, ARGON2_HASH_OPTIONS);
    const userId = await this.repository.create({
      tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      passwordHash,
      roleIds,
    });

    const created = await this.repository.findById(tenantId, userId);
    if (!created) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId,
      action: "create",
      before: undefined,
      after: auditSnapshot(created),
      ip,
    });
    return toDto(created);
  }

  async update(tenantId: string, actorId: string, id: string, body: UpdateStaffUserRequest, ip?: string): Promise<StaffUser> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });

    if (id === actorId && body.status && body.status !== "active") {
      throw new ForbiddenException({
        code: "users.cannot_disable_self",
        title: "You cannot suspend or deactivate your own account",
        detail: "Ask another admin to change your account's status.",
      });
    }

    const roleIds = body.roleIds ? await this.resolveStaffRoleIds(tenantId, body.roleIds) : undefined;
    const passwordHash = body.password ? await argon2.hash(body.password, ARGON2_HASH_OPTIONS) : undefined;

    await this.repository.update({
      userId: id,
      name: body.name,
      phone: body.phone,
      status: body.status,
      passwordHash,
      roleIds,
    });

    // A rotated credential or a no-longer-active account must not keep riding an
    // existing refresh session until natural expiry.
    if (body.password || (body.status && body.status !== "active")) {
      await this.authRepository.revokeAllSessionsForUser(id);
    }

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "update",
      before: auditSnapshot(existing),
      after: { ...auditSnapshot(updated), ...(body.password ? { passwordReset: true } : {}) },
      ip,
    });
    return toDto(updated);
  }

  /** DELETE = deactivate (status=deactivated + revoke sessions), never a row wipe. */
  async deactivate(tenantId: string, actorId: string, id: string, ip?: string): Promise<StaffUser> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_disable_self",
        title: "You cannot deactivate your own account",
        detail: "Ask another admin to deactivate your account.",
      });
    }

    await this.repository.deactivate(id);
    await this.authRepository.revokeAllSessionsForUser(id);

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "delete",
      before: auditSnapshot(existing),
      after: auditSnapshot(updated),
      ip,
    });
    return toDto(updated);
  }

  /** Every requested roleId must exist in this tenant and must not be the student role. */
  private async resolveStaffRoleIds(tenantId: string, requested: string[]): Promise<string[]> {
    const unique = [...new Set(requested)];
    const roles = await this.repository.findRolesByIds(tenantId, unique);
    if (roles.length !== unique.length) {
      throw new NotFoundException({ code: "users.role_not_found", title: "One or more roles were not found" });
    }
    const student = roles.find((role) => role.key === "student");
    if (student) {
      throw new BadRequestException({
        code: "users.student_role_not_allowed",
        title: "Student accounts are not managed here",
        detail: "Student logins are provisioned by the enrollment flow — assign staff roles only.",
      });
    }
    return unique;
  }
}
