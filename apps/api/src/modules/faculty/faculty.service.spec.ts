// apps/api/src/modules/faculty/faculty.service.spec.ts
//
// Unit tests for FacultyService scope-resolution + RBAC allow/deny, per CLAUDE.md §3 DoD
// rule 10. Unlike students, faculty's "branch" and "own" scopes ARE resolvable in P1 — these
// tests prove both the positive (branch/own correctly filter) and negative (assigned fails
// closed) paths, plus the 404-for-IDOR pattern on cross-branch access.
//
// resetPassword's email uses validateEnv().CRM_APP_URL — mocked so this spec is
// self-contained (mirrors lms-account-provisioning.service.spec.ts's LMS_APP_URL mock).
jest.mock("../../config/env", () => ({
  validateEnv: jest.fn(() => ({ CRM_APP_URL: "https://crm.stimuliiq.test" })),
}));

import * as argon2 from "argon2";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { FacultyService } from "./faculty.service";
import { FacultyRepository, type FacultyRow } from "./faculty.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<FacultyRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findUserByEmail: jest.fn(),
    findOwnFacultyId: jest.fn(),
    listCallerBranchIds: jest.fn(),
    listAssignedBatches: jest.fn().mockResolvedValue([]),
    createFacultyWithUser: jest.fn(),
    updateFaculty: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as Mocked<FacultyRepository>;
}

const ROW: FacultyRow = {
  id: "faculty-1",
  userId: "user-1",
  name: "Dr. Mehta",
  email: "mehta@example.com",
  phone: null,
  expertise: ["DSA"],
  bio: null,
  rating: null,
  branchId: "branch-hyderabad",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "faculty.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

function makePrisma() {
  const update = jest.fn().mockResolvedValue({});
  return { prisma: { client: { user: { update } } }, update };
}

function makeMail(): { send: jest.Mock; verifyWebhookSignature: jest.Mock } {
  return { send: jest.fn().mockResolvedValue({ providerMessageId: "m1" }), verifyWebhookSignature: jest.fn() };
}

function makeAuthRepository() {
  return { revokeAllSessionsForUser: jest.fn().mockResolvedValue(undefined) };
}

describe("FacultyService", () => {
  let service: FacultyService;
  let repo: Mocked<FacultyRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new FacultyService(
      repo as unknown as FacultyRepository,
      makePrisma().prisma as never,
      makeMail() as unknown as MailProvider,
      makeAuthRepository() as never,
    );
  });

  describe("scope resolution", () => {
    it("allows scope=all with no extra restriction", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("all", "actor-1", () =>
        service.list("tenant-1", "actor-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
      expect(repo.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ restrictToBranchIds: expect.anything() }),
      );
    });

    it("resolves scope=branch by filtering to the caller's managed branch ids", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", "manager-1", () =>
        service.list("tenant-1", "manager-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(repo.listCallerBranchIds).toHaveBeenCalledWith("manager-1");
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ restrictToBranchIds: ["branch-hyderabad"] }),
      );
    });

    it("resolves scope=own by filtering to the caller's own userId", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("own", "user-1", () =>
        service.list("tenant-1", "user-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToOwnUserId: "user-1" }));
    });

    it("rejects scope=assigned with 403 (not seeded/resolvable for faculty.* in P1)", async () => {
      await expect(
        runWithScope("assigned", "actor-1", () =>
          service.list("tenant-1", "actor-1", { page: 1, pageSize: 20, includeDeleted: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.list).not.toHaveBeenCalled();
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 when the row exists but is outside the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-bengaluru"]); // different branch than ROW

      await expect(
        runWithScope("branch", "manager-1", () => service.getById("tenant-1", "manager-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the detail DTO when the row is within the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);

      const detail = await runWithScope("branch", "manager-1", () =>
        service.getById("tenant-1", "manager-1", ROW.id),
      );

      expect(detail.id).toBe(ROW.id);
    });

    it("returns 404 when the id does not exist in the tenant at all", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("all", "actor-1", () => service.getById("tenant-1", "actor-1", "missing-id")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create — branch-scoped creators restricted to their own branch", () => {
    it("rejects creating faculty in a branch the caller does not manage", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.findUserByEmail.mockResolvedValue(null);

      await expect(
        runWithScope("branch", "manager-1", () =>
          service.create("tenant-1", {
            name: "New Faculty",
            email: "new@example.com",
            expertise: [],
            branchId: "branch-pune",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.createFacultyWithUser).not.toHaveBeenCalled();
    });
  });

  describe("resetPassword (admin 'reset password' action — mirrors students' resend-credentials)", () => {
    it("rotates the password, re-raises mustChangePassword, revokes sessions, emails the faculty member, and returns { email }", async () => {
      repo.findById.mockResolvedValue(ROW);
      const { prisma, update } = makePrisma();
      const mail = makeMail();
      const authRepository = makeAuthRepository();
      const svc = new FacultyService(
        repo as unknown as FacultyRepository,
        prisma as never,
        mail as unknown as MailProvider,
        authRepository as never,
      );

      const result = await runWithScope("all", "actor-1", () => svc.resetPassword("tenant-1", "actor-1", ROW.id));

      expect(result).toEqual({ email: "mehta@example.com" });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROW.userId },
          data: expect.objectContaining({ mustChangePassword: true, status: "active" }),
        }),
      );
      const hash = update.mock.calls[0][0].data.passwordHash as string;
      expect(hash).toMatch(/^\$argon2/);

      // SECURITY: an admin password reset must kill any live session using the old password.
      expect(authRepository.revokeAllSessionsForUser).toHaveBeenCalledWith(ROW.userId);

      expect(mail.send).toHaveBeenCalledTimes(1);
      const sent = mail.send.mock.calls[0][0];
      expect(sent.to).toBe("mehta@example.com");
      expect(sent.html).toContain("https://crm.stimuliiq.test/login");

      // The emailed temp password must be the one that was actually hashed onto the account.
      const emailedPw = /Temporary password:<\/strong> ([^<]+)</.exec(sent.html)?.[1];
      expect(emailedPw).toBeTruthy();
      await expect(argon2.verify(hash, emailedPw as string)).resolves.toBe(true);
    });

    it("returns 404 when the row exists but is outside the caller's branch scope (IDOR)", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-bengaluru"]); // different branch than ROW

      await expect(
        runWithScope("branch", "manager-1", () => service.resetPassword("tenant-1", "manager-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns 404 when the id does not exist in the tenant at all", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("all", "actor-1", () => service.resetPassword("tenant-1", "actor-1", "missing-id")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("still returns { email } (never throws) and still revokes sessions, even if the email fails to send", async () => {
      repo.findById.mockResolvedValue(ROW);
      const { prisma } = makePrisma();
      const mail = makeMail();
      mail.send.mockRejectedValueOnce(new Error("Resend down"));
      const authRepository = makeAuthRepository();
      const svc = new FacultyService(
        repo as unknown as FacultyRepository,
        prisma as never,
        mail as unknown as MailProvider,
        authRepository as never,
      );

      await expect(
        runWithScope("all", "actor-1", () => svc.resetPassword("tenant-1", "actor-1", ROW.id)),
      ).resolves.toEqual({ email: "mehta@example.com" });
      expect(authRepository.revokeAllSessionsForUser).toHaveBeenCalledWith(ROW.userId);
    });
  });
});
