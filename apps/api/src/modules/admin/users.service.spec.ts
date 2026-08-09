// apps/api/src/modules/admin/users.service.spec.ts
//
// Unit tests for UsersAdminService (Admin ▸ Users — staff-account credential
// management), focused on the safety guards: duplicate-email 409, student-role
// rejection, self-disable 403, and session revocation on password reset /
// deactivation. Mirrors roles.service.spec.ts's mock harness.

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UsersAdminService } from "./users.service";
import { UsersAdminRepository, type StaffUserRow } from "./users.repository";
import { AuthRepository } from "../auth/auth.repository";
import { TwoFactorStore } from "../auth/lib/two-factor-store";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<UsersAdminRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    emailTaken: jest.fn(),
    findRolesByIds: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    recordAudit: jest.fn(),
    findAnyByEmail: jest.fn().mockResolvedValue(null),
    restore: jest.fn(),
    softDelete: jest.fn(),
    countOtherActiveUsersWithRole: jest.fn().mockResolvedValue(1),
  } as unknown as Mocked<UsersAdminRepository>;
}

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    revokeAllSessionsForUser: jest.fn(),
    findUserById: jest.fn(),
    setTwoFaEnabled: jest.fn(),
    recordTwoFactorAudit: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
}

function mockTwoFactorStore(): Mocked<TwoFactorStore> {
  return {
    deactivate: jest.fn(),
  } as unknown as Mocked<TwoFactorStore>;
}

const COUNSELLOR_ROLE = { id: "role-counsellor", key: "counsellor", name: "Counsellor" };

const STAFF_ROW: StaffUserRow = {
  id: "user-1",
  name: "Priya Sharma",
  email: "priya@stimuliiq.com",
  phone: null,
  status: "active",
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  userRoles: [{ role: COUNSELLOR_ROLE }],
};

const TENANT = "tenant-1";
const ACTOR = "actor-1";

describe("UsersAdminService", () => {
  let service: UsersAdminService;
  let repo: Mocked<UsersAdminRepository>;
  let authRepo: Mocked<AuthRepository>;
  let twoFactorStore: Mocked<TwoFactorStore>;

  beforeEach(() => {
    repo = mockRepository();
    authRepo = mockAuthRepository();
    twoFactorStore = mockTwoFactorStore();
    service = new UsersAdminService(
      repo as unknown as UsersAdminRepository,
      authRepo as unknown as AuthRepository,
      twoFactorStore as unknown as TwoFactorStore,
    );
  });

  describe("create", () => {
    const BODY = {
      name: "Priya Sharma",
      email: "priya@stimuliiq.com",
      password: "Sup3rSecret!x",
      roleIds: [COUNSELLOR_ROLE.id],
    };

    it("rejects a duplicate email with 409", async () => {
      repo.emailTaken.mockResolvedValue(true);
      await expect(service.create(TENANT, ACTOR, BODY)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("rejects unknown role ids with 404", async () => {
      repo.emailTaken.mockResolvedValue(false);
      repo.findRolesByIds.mockResolvedValue([]);
      await expect(service.create(TENANT, ACTOR, BODY)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects the student role — student accounts belong to the enrollment flow", async () => {
      repo.emailTaken.mockResolvedValue(false);
      repo.findRolesByIds.mockResolvedValue([{ id: COUNSELLOR_ROLE.id, key: "student", name: "Student" }]);
      await expect(service.create(TENANT, ACTOR, BODY)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("hashes the password (never stores plaintext), creates, and writes one audit row", async () => {
      repo.emailTaken.mockResolvedValue(false);
      repo.findRolesByIds.mockResolvedValue([COUNSELLOR_ROLE]);
      repo.create.mockResolvedValue("user-1");
      repo.findById.mockResolvedValue(STAFF_ROW);

      const result = await service.create(TENANT, ACTOR, BODY, "1.2.3.4");

      const createArgs = repo.create.mock.calls[0]![0] as { passwordHash: string };
      expect(createArgs.passwordHash).not.toBe(BODY.password);
      expect(createArgs.passwordHash).toMatch(/^\$argon2/);
      expect(repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "create", userId: "user-1", actorId: ACTOR }),
      );
      // The audit snapshot must never contain a password hash.
      const audit = repo.recordAudit.mock.calls[0]![0] as { after: Record<string, unknown> };
      expect(JSON.stringify(audit.after)).not.toContain("argon2");
      expect(result.email).toBe("priya@stimuliiq.com");
      expect(result.roles).toEqual([COUNSELLOR_ROLE]);
    });
  });

  describe("update", () => {
    it("403s when a user tries to suspend/deactivate THEMSELVES", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });
      await expect(service.update(TENANT, ACTOR, ACTOR, { status: "suspended" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("a password reset re-hashes and revokes every session for the user", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      repo.update.mockResolvedValue(undefined);

      await service.update(TENANT, ACTOR, "user-1", { password: "N3wSecret!!x" });

      const updateArgs = repo.update.mock.calls[0]![0] as { passwordHash?: string };
      expect(updateArgs.passwordHash).toMatch(/^\$argon2/);
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
    });

    it("a plain rename does NOT revoke sessions", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      repo.update.mockResolvedValue(undefined);

      await service.update(TENANT, ACTOR, "user-1", { name: "Priya S." });

      expect(authRepo.revokeAllSessionsForUser).not.toHaveBeenCalled();
    });

    it("404s for a user outside the tenant / non-staff", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update(TENANT, ACTOR, "ghost", { name: "X" })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("deactivate", () => {
    it("403s on self-deactivation", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });
      await expect(service.deactivate(TENANT, ACTOR, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.deactivate).not.toHaveBeenCalled();
    });

    it("deactivates, revokes sessions, and writes one audit row", async () => {
      repo.findById
        .mockResolvedValueOnce(STAFF_ROW)
        .mockResolvedValueOnce({ ...STAFF_ROW, status: "deactivated" });

      const result = await service.deactivate(TENANT, ACTOR, "user-1", "1.2.3.4");

      expect(repo.deactivate).toHaveBeenCalledWith("user-1");
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
      expect(repo.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", userId: "user-1" }));
      expect(result.status).toBe("deactivated");
    });
  });

  // Removal is a different act from deactivation: it takes the account out of the CRM
  // rather than blocking its login, and it is super_admin-only (`users.remove`). These
  // cover the two ways it could lock the company out of its own CRM, and the soft-delete
  // contract that keeps history attached to the removed id.
  describe("remove", () => {
    const SUPER_ADMIN_ROW: StaffUserRow = {
      ...STAFF_ROW,
      id: "user-super",
      userRoles: [{ role: { id: "role-sa", key: "super_admin", name: "Super Admin" } }],
    };

    it("404s an unknown user", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove(TENANT, ACTOR, "ghost")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("403s on removing YOURSELF — the classic one-click lockout", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });
      await expect(service.remove(TENANT, ACTOR, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    // With no super_admin left, nobody can grant the role back — and `users.remove` itself
    // becomes unreachable, so the mistake is not even self-correctable.
    it("403s on removing the LAST active super admin", async () => {
      repo.findById.mockResolvedValue(SUPER_ADMIN_ROW);
      repo.countOtherActiveUsersWithRole.mockResolvedValue(0);

      await expect(service.remove(TENANT, ACTOR, "user-super")).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("removes a super admin while another one remains", async () => {
      repo.findById.mockResolvedValue(SUPER_ADMIN_ROW);
      repo.countOtherActiveUsersWithRole.mockResolvedValue(1);

      await service.remove(TENANT, ACTOR, "user-super");

      expect(repo.countOtherActiveUsersWithRole).toHaveBeenCalledWith(TENANT, "super_admin", "user-super");
      expect(repo.softDelete).toHaveBeenCalledWith("user-super");
    });

    it("doesn't run the last-super-admin check for an ordinary staff user", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      await service.remove(TENANT, ACTOR, "user-1");
      expect(repo.countOtherActiveUsersWithRole).not.toHaveBeenCalled();
    });

    it("soft-deletes, revokes every session, and audits from the PRE-delete snapshot", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);

      await service.remove(TENANT, ACTOR, "user-1", "1.2.3.4");

      expect(repo.softDelete).toHaveBeenCalledWith("user-1");
      // A removed account must not keep riding an existing refresh token to expiry.
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
      // The row stops reading after the delete, so this audit entry is the only surviving
      // record of who the account belonged to — it has to carry the identity.
      expect(repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "delete",
          userId: "user-1",
          before: expect.objectContaining({ email: "priya@stimuliiq.com" }),
          after: { removed: true },
          ip: "1.2.3.4",
        }),
      );
    });
  });

  // `users` carries a FULL unique on (tenant, email), so a removed user keeps their address
  // reserved. Re-adding them must restore the row rather than hitting a raw P2002.
  describe("create — re-adding a removed user", () => {
    it("restores the soft-deleted row instead of inserting a duplicate", async () => {
      repo.emailTaken.mockResolvedValue(false);
      repo.findRolesByIds.mockResolvedValue([COUNSELLOR_ROLE]);
      repo.findAnyByEmail.mockResolvedValue({ id: "user-1", deletedAt: new Date("2026-08-01T00:00:00Z") });
      repo.findById.mockResolvedValue(STAFF_ROW);

      const result = await service.create(TENANT, ACTOR, {
        name: "Priya Sharma",
        email: "priya@stimuliiq.com",
        password: "correct horse battery",
        roleIds: [COUNSELLOR_ROLE.id],
      });

      expect(repo.restore).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", roleIds: [COUNSELLOR_ROLE.id] }),
      );
      expect(repo.create).not.toHaveBeenCalled();
      // `restore`, not `create` — the audit log should read as the resurrection it is.
      expect(repo.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "restore" }));
      expect(result.email).toBe("priya@stimuliiq.com");
    });

    it("still creates normally when the email was never used", async () => {
      repo.emailTaken.mockResolvedValue(false);
      repo.findRolesByIds.mockResolvedValue([COUNSELLOR_ROLE]);
      repo.findAnyByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue("user-new");
      repo.findById.mockResolvedValue(STAFF_ROW);

      await service.create(TENANT, ACTOR, {
        name: "New Person",
        email: "new@stimuliiq.com",
        password: "correct horse battery",
        roleIds: [COUNSELLOR_ROLE.id],
      });

      expect(repo.create).toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });

  describe("clearTwoFactor", () => {
    const REASON = "Verified over a video call — lost phone, no inbox access.";

    it("403s on clearing your OWN 2FA — an admin whose session is hijacked must not be able to silently drop their own second factor", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });
      await expect(service.clearTwoFactor(TENANT, ACTOR, ACTOR, REASON)).rejects.toBeInstanceOf(ForbiddenException);
      expect(twoFactorStore.deactivate).not.toHaveBeenCalled();
      expect(authRepo.setTwoFaEnabled).not.toHaveBeenCalled();
    });

    it("404s for a user outside the tenant", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.clearTwoFactor(TENANT, ACTOR, "ghost", REASON)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("clears the credential, flips the flag, revokes sessions, and audits with the reason", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      authRepo.findUserById.mockResolvedValue({ id: "user-1", twoFaEnabled: true });

      const result = await service.clearTwoFactor(TENANT, ACTOR, "user-1", REASON, "1.2.3.4");

      expect(result).toEqual({ cleared: true });
      expect(twoFactorStore.deactivate).toHaveBeenCalledWith("user-1");
      expect(authRepo.setTwoFaEnabled).toHaveBeenCalledWith("user-1", false);
      // A factor just disappeared — pre-existing sessions must not outlive it.
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
      expect(authRepo.recordTwoFactorAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "two_factor.admin_clear", userId: "user-1", actorId: ACTOR, reason: REASON }),
      );
    });

    it("is idempotent when the target has no 2FA — reports cleared:false and touches nothing", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      authRepo.findUserById.mockResolvedValue({ id: "user-1", twoFaEnabled: false });

      const result = await service.clearTwoFactor(TENANT, ACTOR, "user-1", REASON);

      expect(result).toEqual({ cleared: false });
      expect(twoFactorStore.deactivate).not.toHaveBeenCalled();
      expect(authRepo.revokeAllSessionsForUser).not.toHaveBeenCalled();
      expect(authRepo.recordTwoFactorAudit).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("maps rows to DTOs with pagination meta", async () => {
      repo.list.mockResolvedValue({ rows: [STAFF_ROW], total: 1 });
      const result = await service.list(TENANT, { page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: "user-1", email: "priya@stimuliiq.com", status: "active" });
      expect(result.meta).toMatchObject({ page: 1, pageSize: 20, total: 1, hasMore: false });
    });
  });
});
