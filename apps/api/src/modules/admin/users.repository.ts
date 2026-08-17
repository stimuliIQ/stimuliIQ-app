// apps/api/src/modules/admin/users.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1) for Admin ▸ Users —
// staff-account credential management. UsersAdminService is the only caller.
//
// "Staff" definition (mirrors @repo/types crm/admin.schemas.ts §Staff users): a user
// holding at least one live role whose key is NOT "student". Students are provisioned
// by the enrollment flow and managed on the Students screen — they never appear here.

import { Injectable } from "@nestjs/common";
import type { Prisma, UserStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface StaffUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  userRoles: Array<{ role: { id: string; key: string; name: string } }>;
}

const STAFF_ROLE_FILTER = {
  some: { deletedAt: null, role: { key: { not: "student" }, deletedAt: null } },
} as const;

const ROLE_INCLUDE = {
  userRoles: {
    where: { deletedAt: null, role: { key: { not: "student" }, deletedAt: null } },
    select: { role: { select: { id: true, key: true, name: true } } },
  },
} as const;

@Injectable()
export class UsersAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    args: { search?: string; roleId?: string; status?: UserStatus; page: number; pageSize: number },
  ): Promise<{ rows: StaffUserRow[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      tenantId,
      userRoles: args.roleId
        ? { some: { deletedAt: null, roleId: args.roleId, role: { key: { not: "student" }, deletedAt: null } } }
        : STAFF_ROLE_FILTER,
      ...(args.status ? { status: args.status } : {}),
      ...(args.search
        ? {
            OR: [
              { name: { contains: args.search, mode: "insensitive" } },
              { email: { contains: args.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        include: ROLE_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
      }),
      this.prisma.client.user.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<StaffUserRow | null> {
    return this.prisma.client.user.findFirst({
      where: { id, tenantId, userRoles: STAFF_ROLE_FILTER },
      include: ROLE_INCLUDE,
    });
  }

  /** Live-row email uniqueness check (tenant-scoped, matches the DB partial-unique). */
  async emailTaken(tenantId: string, email: string): Promise<boolean> {
    const existing = await this.prisma.client.user.findFirst({ where: { tenantId, email }, select: { id: true } });
    return existing !== null;
  }

  /**
   * Find a user by email INCLUDING soft-deleted rows.
   *
   * `users` carries a FULL `@@unique([tenantId, email])`, not a partial one — soft-deleting
   * a user therefore keeps their address reserved forever. Without this lookup, re-adding a
   * removed colleague would sail past `emailTaken` (which reads through the soft-delete
   * filter and sees nothing) straight into a raw P2002 at the database. The service uses it
   * to restore the row instead, so "delete then re-add" behaves the way staff expect.
   *
   * `deletedAt: undefined` is the documented opt-out from the soft-delete extension's
   * auto-filter (`withNotDeleted` skips a where-clause that already mentions the key).
   */
  async findAnyByEmail(tenantId: string, email: string): Promise<{ id: string; deletedAt: Date | null } | null> {
    return this.prisma.client.user.findFirst({
      where: { tenantId, email, deletedAt: undefined },
      select: { id: true, deletedAt: true },
    });
  }

  /**
   * Bring a soft-deleted user back as a fresh staff account: undelete, overwrite the
   * identity/credential fields with what the admin just typed, and full-replace roles.
   *
   * Deliberately a REPLACE, not a merge — the admin filled in a create form and expects the
   * account they described, not a half-resurrection carrying an old job title's permissions.
   */
  async restore(args: {
    userId: string;
    name: string;
    phone: string | null;
    passwordHash: string;
    roleIds: string[];
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: args.userId },
        data: {
          deletedAt: null,
          name: args.name,
          phone: args.phone,
          passwordHash: args.passwordHash,
          status: "active",
          mustChangePassword: false,
        },
      });
      // eslint-disable-next-line no-restricted-syntax -- sanctioned join-table purge; see update()'s doc comment
      await tx.$executeRaw`DELETE FROM user_roles WHERE user_id = ${args.userId}::uuid`;
      await tx.userRole.createMany({ data: args.roleIds.map((roleId) => ({ userId: args.userId, roleId })) });
    });
  }

  /** Soft-deactivates: status=deactivated (blocks login — auth requires status=active). */
  async deactivate(userId: string): Promise<void> {
    await this.prisma.client.user.update({ where: { id: userId }, data: { status: "deactivated" } });
  }

  /**
   * Removes the account from the CRM: `.delete()` is rewritten to `deleted_at = now()` by
   * the soft-delete extension, so every foreign key pointing at this user — audit rows, lead
   * ownership, onboarding reviews — stays intact while the account disappears from every
   * read. A hard delete would either orphan or cascade away that history.
   */
  async softDelete(userId: string): Promise<void> {
    await this.prisma.client.user.delete({ where: { id: userId } }); // rewritten to soft-delete.
  }

  /**
   * How many OTHER live users hold `roleKey` — the last-super-admin guard's input.
   * Counts only accounts that could actually sign in and use the permission.
   */
  async countOtherActiveUsersWithRole(tenantId: string, roleKey: string, excludeUserId: string): Promise<number> {
    return this.prisma.client.user.count({
      where: {
        tenantId,
        id: { not: excludeUserId },
        status: "active",
        userRoles: { some: { deletedAt: null, role: { key: roleKey, deletedAt: null } } },
      },
    });
  }

  /** Roles by id — service validates every requested roleId exists and is not `student`. */
  async findRolesByIds(tenantId: string, ids: string[]): Promise<Array<{ id: string; key: string; name: string }>> {
    return this.prisma.client.role.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, key: true, name: true },
    });
  }

  /** Creates the user + role assignments in one transaction. */
  async create(args: {
    tenantId: string;
    name: string;
    email: string;
    phone: string | null;
    passwordHash: string;
    roleIds: string[];
  }): Promise<string> {
    return this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: args.tenantId,
          name: args.name,
          email: args.email,
          phone: args.phone,
          passwordHash: args.passwordHash,
          status: "active",
        },
        select: { id: true },
      });
      await tx.userRole.createMany({ data: args.roleIds.map((roleId) => ({ userId: user.id, roleId })) });
      return user.id;
    });
  }

  /**
   * Partial update; `roleIds` (when present) full-replaces the user's role assignments.
   * Role rows are pure join rows superseded on replace — mirrored on
   * `RolesRepository.replaceGrants`'s sanctioned hard-delete rationale (the explicit
   * audit row the service writes captures before/after roles).
   */
  async update(args: {
    userId: string;
    name?: string;
    phone?: string | null;
    status?: UserStatus;
    passwordHash?: string;
    roleIds?: string[];
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: args.userId },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.phone !== undefined ? { phone: args.phone } : {}),
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.passwordHash !== undefined ? { passwordHash: args.passwordHash } : {}),
        },
      });
      if (args.roleIds) {
        // eslint-disable-next-line no-restricted-syntax -- sanctioned join-table purge; see doc comment above
        await tx.$executeRaw`DELETE FROM user_roles WHERE user_id = ${args.userId}::uuid`;
        await tx.userRole.createMany({ data: args.roleIds.map((roleId) => ({ userId: args.userId, roleId })) });
      }
    });
  }

  /**
   * Credential rotation for UsersAdminService.resetPassword.
   *
   * Separate from `update()` above because that method cannot express the two fields that
   * make a reset a reset: `mustChangePassword` (the admin-chosen password is one-time, and
   * the holder must replace it on first use) and the `invited` → `active` promotion (an
   * invited account has an EMPTY passwordHash and cannot sign in; giving it a real
   * credential is exactly what makes it usable). Callers that merely edit a profile must
   * keep using `update()`.
   *
   * Deliberately does NOT touch a `deactivated` account — the service refuses those before
   * reaching here, so a password reset can never quietly undo a deactivation.
   */
  async setPassword(args: {
    userId: string;
    passwordHash: string;
    tenantId: string;
    actorId: string;
    before: Prisma.InputJsonValue;
    ip?: string;
  }): Promise<void> {
    // ONE transaction for the rotation AND its audit row, deliberately.
    //
    // The sibling `remove()` path does these as separate awaits, and that is exactly how a
    // staff account got deleted with no audit record when the audit insert failed: the
    // mutation had already committed. Here the stakes are higher still — a rotation that
    // commits while its audit write fails leaves the holder locked out of an account whose
    // new password was never emailed to anyone. Rolling both back means a failure is simply
    // "nothing happened, try again", which is always a recoverable state.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: args.userId },
        data: { passwordHash: args.passwordHash, mustChangePassword: true, status: "active" },
      });
      await tx.auditLog.create({
        data: {
          tenantId: args.tenantId,
          actorId: args.actorId,
          entity: "User",
          entityId: args.userId,
          action: "update",
          before: args.before,
          after: { passwordReset: true },
          ip: args.ip ?? null,
        },
      });
    });
  }

  /** One explicit audit row per admin user-management action (create/update/deactivate). */
  async recordAudit(args: {
    tenantId: string;
    actorId: string;
    userId: string;
    action: "create" | "update" | "delete" | "restore";
    before: Prisma.InputJsonValue | undefined;
    after: Prisma.InputJsonValue | undefined;
    ip?: string;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: args.tenantId,
        actorId: args.actorId,
        entity: "User",
        entityId: args.userId,
        action: args.action,
        before: args.before,
        after: args.after,
        ip: args.ip ?? null,
      },
    });
  }
}
