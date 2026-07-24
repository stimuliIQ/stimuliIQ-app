// apps/api/src/modules/auth/auth.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1: "repository never contains
// business logic"). AuthService is the only caller. Every query goes through
// `PrismaService.client` (soft-delete + audit extensions already applied there — see
// apps/api/src/prisma/prisma.service.ts) so this repository never needs to filter
// `deleted_at` itself.

import { Injectable } from "@nestjs/common";
import type { Prisma, RolePermissionScope, User } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface FlattenedPermission {
  key: string;
  scope: RolePermissionScope;
}

export interface UserWithRbac {
  user: User;
  roleKeys: string[];
  permissions: FlattenedPermission[];
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(tenantSlug: string, email: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({
      where: { email, tenant: { slug: tenantSlug } },
    });
  }

  findUserByPhone(tenantSlug: string, phone: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({
      where: { phone, tenant: { slug: tenantSlug } },
    });
  }

  findUserById(userId: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id: userId } });
  }

  async updateLastLoginAt(userId: string): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  /** T28 (2FA, docs/plans/phase-9-completion.md): flips `users.two_fa_enabled` — the ONLY 2FA-related DB column that exists (see two-factor-store.ts file header for where the secret/backup codes actually live). */
  async setTwoFaEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.prisma.client.user.update({ where: { id: userId }, data: { twoFaEnabled: enabled } });
  }

  /** T28 (password-reset, docs/plans/phase-9-completion.md): sets a new argon2 password hash. */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.client.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /**
   * lifecycle-redesign P3 (first-login flow): sets a new password hash AND clears the
   * `must_change_password` gate in one write, so a student who changes their temporary
   * password is immediately released into the LMS. Also flips a still-`invited` account
   * to `active` (the temp password IS a usable credential once rotated).
   */
  async setPasswordAndClearMustChange(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, status: "active" },
    });
  }


  /**
   * Resolves a user's role keys and flattened (deduped, widest-scope-wins) permission
   * grants. "Widest scope wins" ordering: all > branch > assigned > own, so a user with
   * the same `module.action` granted at two scopes (e.g. via two roles) gets the more
   * permissive one — the RBAC guard/ScopeInterceptor then narrows queries using that
   * resolved scope (docs/04 §2.4).
   */
  async getRbacProfile(userId: string): Promise<{ roleKeys: string[]; permissions: FlattenedPermission[] }> {
    const userRoles = await this.prisma.client.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    const roleKeys = [...new Set(userRoles.map((ur) => ur.role.key))];

    const scopeRank: Record<RolePermissionScope, number> = {
      all: 4,
      branch: 3,
      assigned: 2,
      own: 1,
    };

    const byKey = new Map<string, FlattenedPermission>();
    for (const userRole of userRoles) {
      for (const rp of userRole.role.rolePermissions) {
        const existing = byKey.get(rp.permission.key);
        if (!existing || scopeRank[rp.scope] > scopeRank[existing.scope]) {
          byKey.set(rp.permission.key, { key: rp.permission.key, scope: rp.scope });
        }
      }
    }

    return { roleKeys, permissions: [...byKey.values()] };
  }

  createSession(data: {
    tenantId: string;
    userId: string;
    refreshHash: string;
    expiresAt: Date;
    device?: string;
    ip?: string;
  }): Promise<{ id: string }> {
    return this.prisma.client.session.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        refreshHash: data.refreshHash,
        expiresAt: data.expiresAt,
        device: data.device,
        ip: data.ip,
      },
      select: { id: true },
    });
  }

  findSessionById(sessionId: string) {
    return this.prisma.client.session.findUnique({ where: { id: sessionId } });
  }

  async rotateSessionRefreshHash(sessionId: string, newRefreshHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { refreshHash: newRefreshHash, expiresAt },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /** T28 (password-reset, docs/plans/phase-9-completion.md): revokes every still-active session for a user — called on a successful password reset so a leaked/stolen session cannot survive the credential change. */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used only by integration tests / privileged tooling — not exposed via any controller. */
  countActiveSessionsForUser(userId: string): Promise<number> {
    return this.prisma.client.session.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  getTenantBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
    return this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true, slug: true } });
  }

  /**
   * Creates a new user (used by OTP-verify "find-or-create by phone" policy). Email is
   * required by the schema, so a deterministic placeholder is generated from the phone
   * number for phone-only signups — student/profile completion flows (P1+) are expected
   * to prompt the user to set a real email later.
   */
  createUserFromPhone(tenantId: string, phone: string): Promise<User> {
    return this.prisma.client.user.create({
      data: {
        tenantId,
        phone,
        email: `phone-${phone.replace(/[^0-9]/g, "")}@placeholder.stimuliiq.test`,
        name: phone,
        passwordHash: "", // no password set for OTP-only accounts; password login stays unavailable until set.
        status: "active",
      },
    });
  }

  assignDefaultRole(userId: string, tenantId: string, roleKey: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.userRole
      .findFirst({ where: { userId } })
      .then(async (existing) => {
        if (existing) return { count: 0 };
        const role = await this.prisma.client.role.findUnique({ where: { tenantId_key: { tenantId, key: roleKey } } });
        if (!role) return { count: 0 };
        await this.prisma.client.userRole.create({ data: { userId, roleId: role.id } });
        return { count: 1 };
      });
  }
}
