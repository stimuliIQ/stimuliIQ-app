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
  } as unknown as Mocked<UsersAdminRepository>;
}

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    revokeAllSessionsForUser: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
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

  beforeEach(() => {
    repo = mockRepository();
    authRepo = mockAuthRepository();
    service = new UsersAdminService(repo as unknown as UsersAdminRepository, authRepo as unknown as AuthRepository);
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
