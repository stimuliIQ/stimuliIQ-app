// apps/api/src/modules/admin/roles.service.spec.ts
//
// Unit tests for RolesService, focused on the security-critical privilege-escalation
// guard (docs/03 §20 acceptance criteria): an editor cannot grant a permission they do
// not hold, nor a scope broader than their own resolved grant for that permission key,
// including when editing their own role.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { RolesRepository, type RoleRow } from "./roles.repository";
import { AuthRepository } from "../auth/auth.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<RolesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByKey: jest.fn(),
    create: jest.fn(),
    updateName: jest.fn(),
    listPermissionCatalog: jest.fn(),
    findPermissionByKey: jest.fn(),
    getRoleGrants: jest.fn(),
    replaceGrants: jest.fn(),
    recordPermissionMatrixAudit: jest.fn(),
    countAssignedUsers: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<RolesRepository>;
}

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    getRbacProfile: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
}

const TARGET_ROLE: RoleRow = {
  id: "role-branch-manager",
  key: "branch_manager",
  name: "Branch Manager",
  isSystem: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("RolesService", () => {
  let service: RolesService;
  let repo: Mocked<RolesRepository>;
  let authRepo: Mocked<AuthRepository>;

  beforeEach(() => {
    repo = mockRepository();
    authRepo = mockAuthRepository();
    service = new RolesService(repo as unknown as RolesRepository, authRepo as unknown as AuthRepository);
  });

  describe("update, system role immutability", () => {
    it("rejects renaming a system role", async () => {
      repo.findById.mockResolvedValue({ ...TARGET_ROLE, isSystem: true });

      await expect(service.update("tenant-1", TARGET_ROLE.id, { name: "New Name" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.updateName).not.toHaveBeenCalled();
    });
  });

  describe("remove, delete a custom role", () => {
    it("404s when the role does not exist in the tenant", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove("tenant-1", "missing")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("rejects deleting a system role (403)", async () => {
      repo.findById.mockResolvedValue({ ...TARGET_ROLE, key: "admin", isSystem: true });
      await expect(service.remove("tenant-1", TARGET_ROLE.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.countAssignedUsers).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    // Regression: the "student" role was soft-deleted in production on 2026-07-29 and
    // broke every lead -> student conversion with a bare 500. It slipped past BOTH
    // existing guards, `isSystem` is false for it (prisma/seed.ts), and the catalog reset
    // had left it with zero assigned users, so the in-use check passed too. Roles that
    // application code resolves by key need their own guard.
    it.each(["student", "faculty", "counsellor"])(
      "rejects deleting the platform-required '%s' role (403) even though isSystem is false",
      async (key) => {
        repo.findById.mockResolvedValue({ ...TARGET_ROLE, key, isSystem: false });

        await expect(service.remove("tenant-1", TARGET_ROLE.id)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        // Rejected before the in-use check, zero assigned users must not make it deletable.
        expect(repo.countAssignedUsers).not.toHaveBeenCalled();
        expect(repo.softDelete).not.toHaveBeenCalled();
      },
    );

    it("rejects deleting a role still assigned to users (409), without soft-deleting", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      repo.countAssignedUsers.mockResolvedValue(3);
      await expect(service.remove("tenant-1", TARGET_ROLE.id)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("soft-deletes an unused custom role and returns it", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      repo.countAssignedUsers.mockResolvedValue(0);
      repo.softDelete.mockResolvedValue(undefined);

      const result = await service.remove("tenant-1", TARGET_ROLE.id);

      expect(repo.softDelete).toHaveBeenCalledWith(TARGET_ROLE.id);
      expect(result.id).toBe(TARGET_ROLE.id);
    });
  });

  describe("updatePermissions, system-role immutability (S1-1, Phase-7 Wave 2 batch B)", () => {
    it("rejects a permission-matrix edit on a system role (super_admin/admin), even from an all-scope admin", async () => {
      repo.findById.mockResolvedValue({ ...TARGET_ROLE, key: "super_admin", isSystem: true });
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["admin"],
        permissions: [{ key: "roles.edit", scope: "all" }, { key: "students.view", scope: "all" }],
      });

      await expect(
        service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
          grants: [{ permissionKey: "students.view", scope: "all" }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Rejected BEFORE the privilege-escalation check even runs, no RBAC profile lookup.
      expect(authRepo.getRbacProfile).not.toHaveBeenCalled();
      expect(repo.replaceGrants).not.toHaveBeenCalled();
    });
  });

  describe("updatePermissions, privilege-escalation guard", () => {
    it("rejects granting a permission the editor does not hold at all", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [{ key: "students.view", scope: "branch" }],
      });

      await expect(
        service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
          grants: [{ permissionKey: "roles.edit", scope: "all" }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.replaceGrants).not.toHaveBeenCalled();
    });

    it("rejects granting a scope broader than the editor's own resolved scope for that key", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [{ key: "students.view", scope: "branch" }],
      });

      await expect(
        service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
          grants: [{ permissionKey: "students.view", scope: "all" }], // "all" > "branch"
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.replaceGrants).not.toHaveBeenCalled();
    });

    it("allows granting a scope equal to or narrower than the editor's own resolved scope", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["admin"],
        permissions: [{ key: "students.view", scope: "all" }],
      });
      repo.findPermissionByKey.mockResolvedValue({ id: "perm-1", key: "students.view" });
      repo.getRoleGrants.mockResolvedValue([]);

      const result = await service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
        grants: [{ permissionKey: "students.view", scope: "branch" }], // "branch" <= "all", allowed
      });

      expect(repo.replaceGrants).toHaveBeenCalledWith(TARGET_ROLE.id, [{ permissionId: "perm-1", scope: "branch" }]);
      expect(repo.recordPermissionMatrixAudit).toHaveBeenCalledTimes(1);
      expect(result.roleId).toBe(TARGET_ROLE.id);
    });

    it("rejects an editor escalating their OWN role beyond their current grants (self-escalation is the same rule)", async () => {
      // The editor is themselves a member of the role being edited, holding only
      // students.view at scope=branch, attempting to grant scope=all to their own role
      // is rejected by the exact same ceiling check, no separate "is this my own role"
      // branch needed.
      repo.findById.mockResolvedValue(TARGET_ROLE);
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["branch_manager"],
        permissions: [{ key: "students.view", scope: "branch" }],
      });

      await expect(
        service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
          grants: [{ permissionKey: "students.view", scope: "all" }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects an unknown permission key after passing the escalation check", async () => {
      repo.findById.mockResolvedValue(TARGET_ROLE);
      authRepo.getRbacProfile.mockResolvedValue({
        roleKeys: ["admin"],
        permissions: [{ key: "students.view", scope: "all" }],
      });
      repo.findPermissionByKey.mockResolvedValue(null);

      await expect(
        service.updatePermissions("tenant-1", "editor-1", TARGET_ROLE.id, {
          grants: [{ permissionKey: "students.view", scope: "branch" }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.replaceGrants).not.toHaveBeenCalled();
    });
  });
});
