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
import { TwoFactorStore } from "../auth/lib/two-factor-store";
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
    private readonly twoFactorStore: TwoFactorStore,
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
    const passwordHashForNew = await argon2.hash(body.password, ARGON2_HASH_OPTIONS);

    // Re-adding someone who was REMOVED. `users` has a full unique on (tenant, email), so
    // the address stays reserved by the soft-deleted row and a plain insert would hit a raw
    // P2002 — an unexplainable 500 for an admin who can see no such user. Restore instead:
    // the account comes back as the one they just described, and its audit history (which
    // hangs off this id) stays connected rather than being split across two rows.
    const removed = await this.repository.findAnyByEmail(tenantId, body.email);
    if (removed?.deletedAt) {
      await this.repository.restore({
        userId: removed.id,
        name: body.name,
        phone: body.phone ?? null,
        passwordHash: passwordHashForNew,
        roleIds,
      });
      const restored = await this.repository.findById(tenantId, removed.id);
      if (!restored) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
      await this.repository.recordAudit({
        tenantId,
        actorId,
        userId: removed.id,
        action: "restore",
        before: undefined,
        after: { ...auditSnapshot(restored), restoredFromRemoved: true },
        ip,
      });
      return toDto(restored);
    }

    const passwordHash = passwordHashForNew;
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

  /**
   * `DELETE /crm/admin/users/:id/permanent` — remove the account from the CRM entirely.
   *
   * SEPARATE FROM DEACTIVATE, and gated on its own `users.remove` permission held by
   * super_admin ALONE (deactivate is `users.delete`, which admin also holds). The two do
   * different jobs: deactivate blocks a login you still expect to see in the list — someone
   * on leave, someone suspended pending a review. This is for an account that should not be
   * in the product at all: a test login, a wrong address, a person who never joined.
   *
   * SOFT delete, not a row wipe. Audit rows, lead ownership and onboarding reviews all point
   * at this user id; a hard delete would either orphan those references or cascade real
   * history away. The row stays, `deleted_at` is set, and every read filters it out — so
   * from the CRM's point of view the account is gone, while "who approved this in July?"
   * still answers. Re-adding the same email later restores this row (see `create`).
   *
   * Three guards, each protecting against a way an admin can lock the company out:
   *   - never yourself (the classic one-click foot-gun, same as deactivate);
   *   - never the last active super_admin — with no super_admin nobody can grant the role
   *     back, and `users.remove` itself becomes unreachable;
   *   - sessions are revoked, because a removed account must not keep working on an
   *     existing refresh token until it expires naturally.
   */
  async remove(tenantId: string, actorId: string, id: string, ip?: string): Promise<void> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });

    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_remove_self",
        title: "You cannot delete your own account",
        detail: "Ask another super admin to remove it.",
      });
    }

    const isSuperAdmin = existing.userRoles.some((ur) => ur.role.key === "super_admin");
    if (isSuperAdmin) {
      const others = await this.repository.countOtherActiveUsersWithRole(tenantId, "super_admin", id);
      if (others === 0) {
        throw new ForbiddenException({
          code: "users.last_super_admin",
          title: "This is the last super admin",
          detail:
            "Deleting them would leave nobody able to manage roles or users. Create another super admin first, then remove this one.",
        });
      }
    }

    await this.repository.softDelete(id);
    await this.authRepository.revokeAllSessionsForUser(id);

    // Written from the PRE-delete snapshot: after the soft-delete the row no longer reads,
    // so this audit entry is the only remaining record of who the account belonged to.
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "delete",
      before: auditSnapshot(existing),
      after: { removed: true },
      ip,
    });
  }

  /**
   * Admin rescue path — clears 2FA for a user who has lost BOTH their authenticator and
   * access to their inbox (the self-service email-OTP flow covers everyone else; see
   * TwoFactorRecoveryService).
   *
   * Gated on `twofa.reset` at the controller, deliberately SEPARATE from the own-scope
   * `twofa.manage` every role already holds — bundling them would have handed every
   * student the ability to strip a colleague's second factor.
   *
   * Self-clearing is blocked for the same reason deactivate() blocks self-deactivation,
   * and then some: an admin who can silently drop their own second factor turns a
   * hijacked admin session into a permanent 2FA bypass with no second party involved.
   * An admin who genuinely lost their device uses the email-OTP flow, or another admin.
   *
   * Idempotent: clearing a user who has no 2FA returns `cleared: false` rather than
   * erroring — the desired end state ("this user is not blocked by 2FA") already holds.
   */
  async clearTwoFactor(
    tenantId: string,
    actorId: string,
    id: string,
    reason: string,
    ip?: string,
  ): Promise<{ cleared: boolean }> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_clear_own_two_factor",
        title: "You cannot clear your own two-factor authentication",
        detail: "Use the recovery link on the sign-in page, or ask another admin.",
      });
    }

    const target = await this.authRepository.findUserById(id);
    if (!target?.twoFaEnabled) return { cleared: false };

    await this.twoFactorStore.deactivate(id);
    await this.authRepository.setTwoFaEnabled(id, false);
    // The target's live sessions predate the factor removal — end them so the account
    // is re-authenticated from scratch under its new (weaker) posture.
    await this.authRepository.revokeAllSessionsForUser(id);
    await this.authRepository.recordTwoFactorAudit({
      tenantId,
      actorId,
      userId: id,
      action: "two_factor.admin_clear",
      reason,
      ip,
    });

    return { cleared: true };
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
