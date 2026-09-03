// apps/api/src/modules/admin/users.service.spec.ts
//
// Unit tests for UsersAdminService (Admin ▸ Users, staff-account credential
// management), focused on the safety guards: duplicate-email 409, student-role
// rejection, self-disable 403, and session revocation on password reset /
// deactivation. Mirrors roles.service.spec.ts's mock harness.

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UsersAdminService } from "./users.service";
import { UsersAdminRepository, type StaffUserRow } from "./users.repository";
import { RolesRepository } from "./roles.repository";
import { AuthRepository } from "../auth/auth.repository";
import { TwoFactorStore } from "../auth/lib/two-factor-store";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

/** What a super admin's resolved profile looks like to the privilege-escalation guard. */
const SUPER_ADMIN_GRANTS = [
  { key: "users.edit", scope: "all" as const },
  { key: "users.reset_password", scope: "all" as const },
  { key: "leads.view", scope: "all" as const },
];

function mockRepository(): Mocked<UsersAdminRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    emailTaken: jest.fn(),
    findRolesByIds: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setPassword: jest.fn(),
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
    // The default actor is a super admin: holds every key the fixtures' roles hold,
    // at the widest scope, so the privilege-escalation guard in resolveStaffRoleIds
    // passes and these cases keep testing what they were written to test. The guard
    // itself has its own describe block below.
    getRbacProfile: jest.fn().mockResolvedValue({ roleKeys: ["super_admin"], permissions: SUPER_ADMIN_GRANTS }),
  } as unknown as Mocked<AuthRepository>;
}

function mockRolesRepository(): Mocked<RolesRepository> {
  return {
    // No grants on the assigned role → nothing for the escalation guard to object to.
    getRoleGrantsWithIds: jest.fn().mockResolvedValue([]),
  } as unknown as Mocked<RolesRepository>;
}

function mockTwoFactorStore(): Mocked<TwoFactorStore> {
  return {
    deactivate: jest.fn(),
  } as unknown as Mocked<TwoFactorStore>;
}

function mockMailProvider(): { send: jest.Mock } {
  return { send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }) };
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
  // Not on the org chart and not posted to a branch — the state every existing staff row
  // was in on the day P17 shipped.
  teamId: null,
  team: null,
  userRoles: [{ role: COUNSELLOR_ROLE, branchId: null }],
};

const TENANT = "tenant-1";
const ACTOR = "actor-1";

describe("UsersAdminService", () => {
  let service: UsersAdminService;
  let repo: Mocked<UsersAdminRepository>;
  let rolesRepo: Mocked<RolesRepository>;
  let authRepo: Mocked<AuthRepository>;
  let twoFactorStore: Mocked<TwoFactorStore>;
  let mail: { send: jest.Mock };

  beforeEach(() => {
    repo = mockRepository();
    authRepo = mockAuthRepository();
    twoFactorStore = mockTwoFactorStore();
    mail = mockMailProvider();
    rolesRepo = mockRolesRepository();
    service = new UsersAdminService(
      repo as unknown as UsersAdminRepository,
      rolesRepo as unknown as RolesRepository,
      authRepo as unknown as AuthRepository,
      twoFactorStore as unknown as TwoFactorStore,
      mail as never,
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

    it("rejects the student role, student accounts belong to the enrollment flow", async () => {
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
      userRoles: [{ branchId: null, role: { id: "role-sa", key: "super_admin", name: "Super Admin" } }],
    };

    it("404s an unknown user", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove(TENANT, ACTOR, "ghost")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("403s on removing YOURSELF, the classic one-click lockout", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });
      await expect(service.remove(TENANT, ACTOR, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    // With no super_admin left, nobody can grant the role back, and `users.remove` itself
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
      // record of who the account belonged to, it has to carry the identity.
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
  describe("create, re-adding a removed user", () => {
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
      // `restore`, not `create`, the audit log should read as the resurrection it is.
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
    const REASON = "Verified over a video call, lost phone, no inbox access.";

    it("403s on clearing your OWN 2FA, an admin whose session is hijacked must not be able to silently drop their own second factor", async () => {
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
      // A factor just disappeared, pre-existing sessions must not outlive it.
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
      expect(authRepo.recordTwoFactorAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "two_factor.admin_clear", userId: "user-1", actorId: ACTOR, reason: REASON }),
      );
    });

    it("is idempotent when the target has no 2FA, reports cleared:false and touches nothing", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      authRepo.findUserById.mockResolvedValue({ id: "user-1", twoFaEnabled: false });

      const result = await service.clearTwoFactor(TENANT, ACTOR, "user-1", REASON);

      expect(result).toEqual({ cleared: false });
      expect(twoFactorStore.deactivate).not.toHaveBeenCalled();
      expect(authRepo.revokeAllSessionsForUser).not.toHaveBeenCalled();
      expect(authRepo.recordTwoFactorAudit).not.toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("rotates the credential, forces a change, revokes sessions and emails the holder", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);

      const result = await service.resetPassword(TENANT, ACTOR, "user-1", "1.2.3.4");

      expect(result).toEqual({ email: "priya@stimuliiq.com" });
      expect(repo.setPassword).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", passwordHash: expect.stringContaining("$argon2") }),
      );
      // A rotated credential that leaves old refresh tokens alive has revoked nothing.
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "priya@stimuliiq.com" }),
      );
    });

    it("never returns the temporary password to the caller", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);

      const result = await service.resetPassword(TENANT, ACTOR, "user-1");

      // The whole security model rests on this: an actor who can trigger a reset must still
      // need the target's inbox to actually sign in as them.
      expect(Object.keys(result)).toEqual(["email"]);
      expect(JSON.stringify(result)).not.toContain("password");
    });

    it("keeps the temporary password out of the audit snapshot", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);

      await service.resetPassword(TENANT, ACTOR, "user-1");

      const arg = repo.setPassword.mock.calls[0][0] as { before: unknown; passwordHash: string };
      // The hash is the credential material; it must reach the user row and nothing else.
      expect(JSON.stringify(arg.before)).not.toContain("$argon2");
      expect(JSON.stringify(arg.before)).not.toContain("password");
    });

    it("rolls the rotation back with its audit row, a half-applied reset locks the holder out", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      // Exactly the live failure this guards: audit_logs missing a column the client expects.
      repo.setPassword.mockRejectedValue(new Error("column audit_logs.redacted_at does not exist"));

      await expect(service.resetPassword(TENANT, ACTOR, "user-1")).rejects.toThrow();
      // No sessions killed and no mail sent for a rotation that never committed.
      expect(authRepo.revokeAllSessionsForUser).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("refuses to reset your own password", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, id: ACTOR });

      await expect(service.resetPassword(TENANT, ACTOR, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.setPassword).not.toHaveBeenCalled();
    });

    it("refuses a deactivated account rather than silently reactivating it", async () => {
      repo.findById.mockResolvedValue({ ...STAFF_ROW, status: "deactivated" });

      await expect(service.resetPassword(TENANT, ACTOR, "user-1")).rejects.toBeInstanceOf(ConflictException);
      expect(repo.setPassword).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("404s an unknown id", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.resetPassword(TENANT, ACTOR, "nope")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("still succeeds when the email bounces, the credential was already rotated", async () => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      mail.send.mockRejectedValue(new Error("mailbox unavailable"));

      // Reporting failure here would invite a retry, minting a SECOND password and
      // invalidating the one already in flight.
      await expect(service.resetPassword(TENANT, ACTOR, "user-1")).resolves.toEqual({
        email: "priya@stimuliiq.com",
      });
      expect(repo.setPassword).toHaveBeenCalled();
    });
  });

  // The staff-user editor is the second door into the same room as the role editor, and
  // it was unlocked: `users.edit` is seeded for admin as well as super_admin, so an admin
  // could hand themselves the `super_admin` role, or simply overwrite a super admin's
  // password with one they chose. Both are one PATCH. These pin them shut.
  describe("update — privilege escalation", () => {
    /** An admin: holds users.edit, but NOT users.reset_password (super_admin only). */
    const ADMIN_GRANTS = [{ key: "users.edit", scope: "all" as const }];

    beforeEach(() => {
      repo.findById.mockResolvedValue(STAFF_ROW);
      authRepo.getRbacProfile.mockResolvedValue({ roleKeys: ["admin"], permissions: ADMIN_GRANTS });
    });

    it("refuses to assign a role holding a permission the actor does not hold", async () => {
      const superAdminRole = { id: "role-super", key: "super_admin", name: "Super Admin" };
      repo.findRolesByIds.mockResolvedValue([superAdminRole]);
      rolesRepo.getRoleGrantsWithIds.mockResolvedValue([
        { permissionId: "p1", permissionKey: "users.reset_password", scope: "all" },
      ]);

      await expect(
        service.update(TENANT, ACTOR, "user-1", { roleIds: [superAdminRole.id] }),
      ).rejects.toMatchObject({ response: { code: "users.privilege_escalation" } });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("refuses to assign a role holding a WIDER scope of a permission the actor has", async () => {
      const wideRole = { id: "role-wide", key: "regional", name: "Regional" };
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["counsellor"],
        permissions: [{ key: "leads.view", scope: "own" }],
      });
      repo.findRolesByIds.mockResolvedValue([wideRole]);
      rolesRepo.getRoleGrantsWithIds.mockResolvedValue([
        { permissionId: "p2", permissionKey: "leads.view", scope: "all" },
      ]);

      await expect(
        service.update(TENANT, ACTOR, "user-1", { roleIds: [wideRole.id] }),
      ).rejects.toMatchObject({ response: { code: "users.privilege_escalation" } });
    });

    it("allows a role whose grants the actor already holds at the same or a wider scope", async () => {
      repo.findRolesByIds.mockResolvedValue([COUNSELLOR_ROLE]);
      rolesRepo.getRoleGrantsWithIds.mockResolvedValue([
        { permissionId: "p3", permissionKey: "users.edit", scope: "all" },
      ]);

      await expect(
        service.update(TENANT, ACTOR, "user-1", { roleIds: [COUNSELLOR_ROLE.id] }),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ roleIds: [COUNSELLOR_ROLE.id] }),
      );
    });

    it("refuses to set a password without users.reset_password", async () => {
      await expect(
        service.update(TENANT, ACTOR, "user-1", { password: "Att4ckerChosen!" }),
      ).rejects.toMatchObject({ response: { code: "users.password_change_not_permitted" } });
      expect(repo.update).not.toHaveBeenCalled();
      expect(authRepo.revokeAllSessionsForUser).not.toHaveBeenCalled();
    });

    it("allows a password change for an actor who holds users.reset_password", async () => {
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["super_admin"],
        permissions: SUPER_ADMIN_GRANTS,
      });

      await expect(
        service.update(TENANT, ACTOR, "user-1", { password: "Sup3rSecret!x" }),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: expect.any(String) }),
      );
      expect(authRepo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
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
