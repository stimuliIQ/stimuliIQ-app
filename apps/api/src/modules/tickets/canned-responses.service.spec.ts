// apps/api/src/modules/tickets/canned-responses.service.spec.ts
//
// Unit tests for CannedResponsesService (docs/plans/phase-9-completion.md T21). Covers:
// scope=all is the only resolvable scope (fails closed otherwise), and CRUD delegates
// correctly to the repository.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CannedResponsesService } from "./canned-responses.service";
import { CannedResponsesRepository, type CannedResponseRow } from "./canned-responses.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<CannedResponsesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<CannedResponsesRepository>;
}

const ROW: CannedResponseRow = {
  id: "cr-1",
  title: "Password reset",
  body: "Click here to reset your password: ...",
  category: "account",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "canned_responses.manage", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("CannedResponsesService", () => {
  let service: CannedResponsesService;
  let repo: Mocked<CannedResponsesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new CannedResponsesService(repo as unknown as CannedResponsesRepository);
  });

  it("scope=all succeeds", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);
  });

  it.each(["branch", "assigned", "own"] as const)("scope=%s fails closed (403)", async (scope) => {
    await expect(runWithScope(scope, () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("create() delegates to the repository and returns the created row", async () => {
    repo.create.mockResolvedValue({ id: "cr-new" });
    repo.findById.mockResolvedValue({ ...ROW, id: "cr-new" });
    const result = await runWithScope("all", () =>
      service.create("tenant-1", { title: "Password reset", body: "...", category: "account" }),
    );
    expect(result.id).toBe("cr-new");
  });

  it("update() on a non-existent row -> 404", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      runWithScope("all", () => service.update("tenant-1", "missing", { title: "x" })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("softDelete() delegates to the repository", async () => {
    repo.findById.mockResolvedValue(ROW);
    await runWithScope("all", () => service.softDelete("tenant-1", "cr-1"));
    expect(repo.softDelete).toHaveBeenCalledWith("cr-1");
  });
});
