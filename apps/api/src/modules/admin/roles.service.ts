// apps/api/src/modules/admin/roles.service.ts
//
// Business logic for roles + the permission matrix (docs/04-trd-architecture.md §2.1,
// docs/03 §7.16 + §9 + §20). All routes in this module are seeded at scope=all only
// (super_admin/admin) — no branch/assigned/own scope exists for roles.*/branches.*/
// audit_logs.* in P1 (confirmed against prisma/seed.ts), so there is no data-scope
// resolution here, only the PRIVILEGE-ESCALATION GUARD below.
//
// PRIVILEGE-ESCALATION GUARD (security-critical, docs/03 §20 acceptance criteria +
// security-reviewer task #9): `updatePermissions()` must reject (403) ANY grant in the
// requested matrix whose `(permissionKey, scope)` is broader than the EDITING user's OWN
// resolved grant for that permission key. "Broader" is defined by the same widest-scope-
// wins ordering already used in `AuthRepository.getRbacProfile()`
// (all=4 > branch=3 > assigned=2 > own=1):
//   - The editor cannot grant a permission key they do not themselves hold at all.
//   - The editor cannot grant a scope ranked higher than their own scope for that key.
// This intentionally also blocks an editor escalating THEIR OWN role's permissions
// beyond what they currently hold (self-escalation is just a special case of the same
// rule — no separate "is this my own role" check is needed, since the editor's own
// effective grants are exactly the ceiling being enforced either way).

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PermissionMatrix, Role, RolePermissions } from "@repo/types";
import type { RolePermissionScope } from "@prisma/client";
import { RolesRepository, type RoleRow } from "./roles.repository";
import { AuthRepository } from "../auth/auth.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { CreateRoleRequest, ListRolesQuery, UpdateRolePermissionsRequest, UpdateRoleRequest } from "./dto";

const SCOPE_RANK: Record<RolePermissionScope, number> = { all: 4, branch: 3, assigned: 2, own: 1 };

/**
 * Roles that application code resolves BY KEY at runtime, and therefore cannot be deleted
 * no matter what `is_system` says.
 *
 * `is_system` alone was not enough. It is true only for `super_admin`/`admin`
 * (prisma/seed.ts), but these three keys are looked up directly by `findUnique` on
 * `tenantId_key` in hot paths:
 *   - "student"    students.repository.ts + public.repository.ts — assigning the role to
 *                  every newly created student (lead conversion, website self-signup).
 *   - "faculty"    faculty.repository.ts — same, for faculty creation.
 *   - "counsellor" leads.repository.ts — resolving the round-robin assignment pool.
 *
 * This guard exists because deleting `student` really happened (2026-07-29, production)
 * and silently broke EVERY lead → student conversion with a bare 500: the role had no
 * users assigned to it at the time (the catalog reset had removed them all), so the
 * `assignedUsers > 0` guard below waved it through, and `is_system: false` meant the
 * system-role guard did too. Nothing surfaced the breakage until a counsellor tried to
 * convert a lead weeks later.
 *
 * Keep this in sync with the `findUnique({ where: { tenantId_key: ... } })` call sites —
 * adding a new by-key lookup without adding the key here re-opens exactly this hole.
 */
const UNDELETABLE_ROLE_KEYS = new Set(["student", "faculty", "counsellor"]);

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly authRepository: AuthRepository,
  ) {}

  async list(tenantId: string, query: ListRolesQuery): Promise<PaginatedResult<Role>> {
    const { rows, total } = await this.repository.list(tenantId, query.page, query.pageSize);
    return new PaginatedResult(rows.map(toRoleDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async create(tenantId: string, body: CreateRoleRequest): Promise<Role> {
    const existing = await this.repository.findByKey(tenantId, body.key);
    if (existing) {
      throw new ConflictException({
        code: "roles.key_taken",
        title: "Role key already exists",
        detail: `A role with key "${body.key}" already exists for this tenant.`,
      });
    }
    const created = await this.repository.create(tenantId, body.key, body.name);
    return toRoleDto(created);
  }

  async update(tenantId: string, id: string, body: UpdateRoleRequest): Promise<Role> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "roles.not_found", title: "Role not found" });
    }
    if (existing.isSystem) {
      throw new ForbiddenException({
        code: "roles.system_role_immutable",
        title: "System roles cannot be renamed",
        detail: "Seeded system roles (super_admin, admin) cannot be renamed.",
      });
    }
    const updated = await this.repository.updateName(id, body.name);
    return toRoleDto(updated);
  }

  /**
   * DELETE /admin/roles/:id — soft-deletes a CUSTOM role. Three guards:
   *   - System roles (`is_system` — super_admin, admin) can never be deleted; they are
   *     seed-defined and other code assumes they exist.
   *   - Roles resolved by key at runtime (`UNDELETABLE_ROLE_KEYS` — student, faculty,
   *     counsellor) can never be deleted either, regardless of `is_system`. See that
   *     constant for the production incident that made this necessary.
   *   - A role still assigned to any user is rejected (409) rather than silently orphaning
   *     those users' access — reassign them first. Mirrors the referential-integrity
   *     stance the rest of the CRM takes on delete (see the delete-coverage convention).
   */
  async remove(tenantId: string, id: string): Promise<Role> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "roles.not_found", title: "Role not found" });
    }
    if (existing.isSystem) {
      throw new ForbiddenException({
        code: "roles.system_role_immutable",
        title: "System roles cannot be deleted",
        detail: "Seeded system roles (super_admin, admin) cannot be deleted.",
      });
    }
    if (UNDELETABLE_ROLE_KEYS.has(existing.key)) {
      throw new ForbiddenException({
        code: "roles.required_role_immutable",
        title: "This role is required by the platform",
        detail: `The "${existing.key}" role is assigned automatically when records are created, so it cannot be deleted. Edit its permissions instead.`,
      });
    }
    const assignedUsers = await this.repository.countAssignedUsers(id);
    if (assignedUsers > 0) {
      throw new ConflictException({
        code: "roles.role_in_use",
        title: "Role is still assigned to users",
        detail: `${assignedUsers} user${assignedUsers === 1 ? "" : "s"} still ${
          assignedUsers === 1 ? "has" : "have"
        } this role. Reassign them to another role before deleting it.`,
      });
    }
    await this.repository.softDelete(id);
    return toRoleDto(existing);
  }

  /** GET /admin/permissions — full catalog grouped by module, for the matrix editor headers. */
  async getPermissionCatalog(): Promise<PermissionMatrix> {
    const rows = await this.repository.listPermissionCatalog();
    const byModule = new Map<string, PermissionMatrix["modules"][number]["permissions"]>();

    for (const row of rows) {
      const [module, action] = row.key.split(".");
      if (!module || !action) {
        continue; // defensive: every seeded key is `module.action` (validated by the zod regex on write).
      }
      const list = byModule.get(module) ?? [];
      list.push({
        key: row.key,
        module,
        action: action as PermissionMatrix["modules"][number]["permissions"][number]["action"],
        label: row.label,
      });
      byModule.set(module, list);
    }

    return {
      modules: [...byModule.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([module, permissions]) => ({ module, permissions })),
    };
  }

  /** GET /admin/roles/:id/permissions — one role's current grants. */
  async getRolePermissions(tenantId: string, roleId: string): Promise<RolePermissions> {
    const role = await this.repository.findById(tenantId, roleId);
    if (!role) {
      throw new NotFoundException({ code: "roles.not_found", title: "Role not found" });
    }
    const grants = await this.repository.getRoleGrants(roleId);
    return {
      roleId,
      grants: grants.map((grant) => ({ permissionKey: grant.permissionKey, scope: grant.scope })),
    };
  }

  /**
   * PUT /admin/roles/:id/permissions — full-replace, gated by the privilege-escalation
   * guard documented in the file header. `editorActorId` is the CALLER (the person making
   * this request), never the target role's own members — their resolved permissions are
   * the ceiling every requested grant is checked against.
   */
  async updatePermissions(
    tenantId: string,
    editorActorId: string,
    roleId: string,
    body: UpdateRolePermissionsRequest,
    ip?: string,
  ): Promise<RolePermissions> {
    const role = await this.repository.findById(tenantId, roleId);
    if (!role) {
      throw new NotFoundException({ code: "roles.not_found", title: "Role not found" });
    }

    // S1-1 fix (Phase-7 Wave 2 security hardening batch B, item 4 — carried since
    // docs/phase-1-followups.md S1-1 / ADR-0010's open follow-up): system roles
    // (`is_system = true` — super_admin, admin) have their permission matrix rejected
    // OUTRIGHT here, closing the gap where any `all`-scope admin holding `roles.edit`
    // could overwrite super_admin's (or admin's own) grants — the privilege-escalation
    // guard below only bounds a requested grant by the EDITOR's own resolved permissions,
    // which does not stop an admin from equalizing/downgrading super_admin to admin's own
    // level, or otherwise tampering with a system role's matrix. System-role grants are
    // fixed at seed time (prisma/seed.ts) and are not editable through this endpoint at
    // all — not even by another system-role holder — closing the finding entirely rather
    // than narrowing it to a "super_admin only" carve-out (simpler, and the ADR-0010
    // follow-up explicitly listed this as one of the two acceptable resolutions).
    if (role.isSystem) {
      throw new ForbiddenException({
        code: "roles.system_role_immutable",
        title: "System role permissions cannot be edited",
        detail: "Seeded system roles (super_admin, admin) have a fixed permission matrix set at seed time and cannot be edited through this endpoint.",
      });
    }

    const editorProfile = await this.authRepository.getRbacProfile(editorActorId);
    const editorGrantByKey = new Map(editorProfile.permissions.map((p) => [p.key, p.scope]));

    for (const requested of body.grants) {
      const editorScope = editorGrantByKey.get(requested.permissionKey);
      if (!editorScope) {
        throw new ForbiddenException({
          code: "roles.privilege_escalation",
          title: "Cannot grant a permission you do not hold",
          detail: `You cannot grant "${requested.permissionKey}" because you do not hold it yourself.`,
        });
      }
      if (SCOPE_RANK[requested.scope] > SCOPE_RANK[editorScope]) {
        throw new ForbiddenException({
          code: "roles.privilege_escalation",
          title: "Cannot grant a broader scope than your own",
          detail: `You hold "${requested.permissionKey}" at scope "${editorScope}", you cannot grant scope "${requested.scope}" (broader) to another role.`,
        });
      }
    }

    // Resolve every requested permission key against the catalog up front, rejecting
    // unknown keys before any write — `replaceGrants` trusts its input.
    const resolved: Array<{ permissionId: string; permissionKey: string; scope: RolePermissionScope }> = [];
    for (const requested of body.grants) {
      const permission = await this.repository.findPermissionByKey(requested.permissionKey);
      if (!permission) {
        throw new NotFoundException({
          code: "roles.permission_not_found",
          title: "Permission not found",
          detail: `Unknown permission key "${requested.permissionKey}".`,
        });
      }
      resolved.push({ permissionId: permission.id, permissionKey: permission.key, scope: requested.scope });
    }

    const before = await this.repository.getRoleGrants(roleId);
    await this.repository.replaceGrants(
      roleId,
      resolved.map((r) => ({ permissionId: r.permissionId, scope: r.scope })),
    );
    await this.repository.recordPermissionMatrixAudit({
      tenantId,
      actorId: editorActorId,
      roleId,
      before,
      after: resolved.map((r) => ({ permissionKey: r.permissionKey, scope: r.scope })),
      ip,
    });

    const grants = await this.repository.getRoleGrants(roleId);
    return { roleId, grants: grants.map((g) => ({ permissionKey: g.permissionKey, scope: g.scope })) };
  }
}

function toRoleDto(row: RoleRow): Role {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
  };
}
