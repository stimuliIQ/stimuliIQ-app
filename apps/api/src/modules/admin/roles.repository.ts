// apps/api/src/modules/admin/roles.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). RolesService is the only
// caller. Roles/permissions are tenant-scoped except `permissions` itself (the catalog is
// global — docs/05 §3, confirmed in prisma/schema.prisma: `Permission` has no tenantId).

import { Injectable } from "@nestjs/common";
import type { RolePermissionScope } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  createdAt: Date;
}

export interface PermissionCatalogRow {
  id: string;
  key: string;
  label: string;
}

export interface RolePermissionGrantRow {
  permissionKey: string;
  scope: RolePermissionScope;
}

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: RoleRow[]; total: number }> {
    const where = { tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.client.role.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.role.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<RoleRow | null> {
    return this.prisma.client.role.findFirst({ where: { id, tenantId } });
  }

  async findByKey(tenantId: string, key: string): Promise<RoleRow | null> {
    return this.prisma.client.role.findFirst({ where: { tenantId, key } });
  }

  async create(tenantId: string, key: string, name: string): Promise<RoleRow> {
    return this.prisma.client.role.create({ data: { tenantId, key, name, isSystem: false } });
  }

  async updateName(id: string, name: string): Promise<RoleRow> {
    return this.prisma.client.role.update({ where: { id }, data: { name } });
  }

  /**
   * How many users currently hold this role (live assignments only). `deletedAt: null`
   * is passed explicitly so the count is correct regardless of whether `count` is one of
   * the operations the soft-delete extension auto-filters. A non-zero count blocks
   * deletion in the service — referential-integrity guard, mirrors the CRM's
   * delete-coverage convention for resources other rows still reference.
   */
  async countAssignedUsers(roleId: string): Promise<number> {
    return this.prisma.client.userRole.count({ where: { roleId, deletedAt: null } });
  }

  /**
   * Soft-deletes a role (sets `deleted_at`). `Role` is registered in the soft-delete
   * extension, so `.delete()` is rewritten to `deletedAt = now()` and every subsequent
   * read (list/findById/findByKey) auto-excludes it — freeing the `key` for re-use.
   */
  async softDelete(id: string): Promise<void> {
    await this.prisma.client.role.delete({ where: { id } });
  }

  /** Global permission catalog (no tenant scope — see file header). */
  async listPermissionCatalog(): Promise<PermissionCatalogRow[]> {
    return this.prisma.client.permission.findMany({
      where: { deletedAt: null },
      orderBy: { key: "asc" },
      select: { id: true, key: true, label: true },
    });
  }

  async findPermissionByKey(key: string): Promise<{ id: string; key: string } | null> {
    return this.prisma.client.permission.findFirst({ where: { key, deletedAt: null }, select: { id: true, key: true } });
  }

  /** A role's current grants, joined to the permission key. */
  async getRoleGrants(roleId: string): Promise<RolePermissionGrantRow[]> {
    const rows = await this.prisma.client.rolePermission.findMany({
      where: { roleId },
      include: { permission: { select: { key: true } } },
    });
    return rows.map((row) => ({ permissionKey: row.permission.key, scope: row.scope }));
  }

  /**
   * Full-replace a role's permission grants in one transaction: deletes every existing
   * `role_permissions` row for this role, then inserts the desired grant list. The
   * privilege-escalation guard and "permission keys must exist in the catalog" validation
   * are the SERVICE's responsibility — this method trusts its input.
   *
   * Uses a genuine HARD delete (`$executeRaw`, the documented opt-out — see
   * soft-delete.extension.ts file header) rather than `tx.rolePermission.deleteMany()`.
   * `RolePermission` IS in the soft-delete extension's model list, so a normal
   * `deleteMany` is silently rewritten into `updateMany({ deletedAt: now() })` — the row
   * physically still exists, still holds the `@@unique([roleId, permissionId])` slot, and
   * the immediately-following `createMany()` for the SAME (roleId, permissionId) pair (a
   * grant being re-affirmed at a new scope, the common case) then throws a unique-
   * constraint violation. Grants are pure superseded join-table rows with no
   * restore/audit value once replaced (the audit trail is captured explicitly via
   * `recordPermissionMatrixAudit` below), so a true hard delete is the correct semantics
   * here, not a soft-delete.
   */
  async replaceGrants(roleId: string, grants: Array<{ permissionId: string; scope: RolePermissionScope }>): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      // Sanctioned hard-delete purge, see ADR-0010: role_permissions is a pure join table
      // with no independent lifecycle/audit value once superseded; replaceGrants writes
      // its own explicit audit_logs row via recordPermissionMatrixAudit below, so the
      // audit trail is not lost by this hard delete.
      // eslint-disable-next-line no-restricted-syntax -- see ADR-0010, comment above
      await tx.$executeRaw`DELETE FROM role_permissions WHERE role_id = ${roleId}::uuid`;
      if (grants.length > 0) {
        await tx.rolePermission.createMany({
          data: grants.map((grant) => ({ roleId, permissionId: grant.permissionId, scope: grant.scope })),
        });
      }
    });
  }

  /**
   * Writes ONE explicit `audit_logs` row for a permission-matrix full-replace (entity =
   * "role", entityId = roleId), capturing the full before/after grant list as a single
   * diff. Done manually (not via the audit Prisma extension's automatic per-row capture)
   * because `replaceGrants()` above is a delete-many + create-many bulk operation on
   * `RolePermission` (not itself in `AUDITED_MODELS`), and the product requirement
   * (docs/03 §20 / @repo/types crm/admin.schemas.ts file header) is "one row per
   * matrix-update call with the full grant list", not N automatic per-row rows.
   */
  async recordPermissionMatrixAudit(args: {
    tenantId: string;
    actorId: string;
    roleId: string;
    before: Array<{ permissionKey: string; scope: RolePermissionScope }>;
    after: Array<{ permissionKey: string; scope: RolePermissionScope }>;
    ip?: string;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: args.tenantId,
        actorId: args.actorId,
        entity: "Role",
        entityId: args.roleId,
        action: "update",
        before: { grants: args.before },
        after: { grants: args.after },
        ip: args.ip ?? null,
      },
    });
  }
}
