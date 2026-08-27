// apps/api/src/modules/course-types/course-types.service.spec.ts
//
// Covers the rules the feature would quietly lose if somebody simplified the service:
// the key is derived and immutable, hidden options cannot be written to new records but
// still read back, and an in-use option cannot be deleted.

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { CourseTypesService } from "./course-types.service";
import { CourseTypesRepository, type CourseTypeRow } from "./course-types.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => Promise<T>): Promise<T> {
  return scopeContextStorage.run({ scope } as ScopeContext, fn);
}

function row(overrides: Partial<CourseTypeRow> = {}): CourseTypeRow {
  return {
    id: "ct-1",
    key: "b_sc_nursing",
    label: "B.Sc Nursing",
    sortOrder: 1,
    active: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockRepository(): Mocked<CourseTypesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByKey: jest.fn(),
    listAll: jest.fn(),
    countStudentsByKey: jest.fn().mockResolvedValue(new Map()),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    maxSortOrder: jest.fn().mockResolvedValue(0),
  } as unknown as Mocked<CourseTypesRepository>;
}

describe("CourseTypesService", () => {
  let repo: Mocked<CourseTypesRepository>;
  let service: CourseTypesService;

  beforeEach(() => {
    repo = mockRepository();
    service = new CourseTypesService(repo as unknown as CourseTypesRepository);
  });

  describe("create", () => {
    it("derives the stored key from the label, so nobody can set a second name for it", async () => {
      repo.findByKey.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "ct-1" });
      repo.findById.mockResolvedValue(row());

      await runWithScope("all", () => service.create(TENANT, { label: "B.Sc Nursing", active: true }));

      expect(repo.create).toHaveBeenCalledWith(TENANT, expect.objectContaining({ key: "b_sc_nursing", label: "B.Sc Nursing" }));
    });

    it("puts a new option at the bottom rather than the top", async () => {
      repo.findByKey.mockResolvedValue(null);
      repo.maxSortOrder.mockResolvedValue(7);
      repo.create.mockResolvedValue({ id: "ct-1" });
      repo.findById.mockResolvedValue(row());

      await runWithScope("all", () => service.create(TENANT, { label: "Paramedical", active: true }));

      expect(repo.create).toHaveBeenCalledWith(TENANT, expect.objectContaining({ sortOrder: 8 }));
    });

    it("rejects a label with no usable characters instead of writing an empty key", async () => {
      await expect(
        runWithScope("all", () => service.create(TENANT, { label: "!!!", active: true })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("refuses a duplicate and points at the hidden option when that is the clash", async () => {
      repo.findByKey.mockResolvedValue(row({ active: false, label: "Diploma" }));

      const error = await runWithScope("all", () =>
        service.create(TENANT, { label: "Diploma", active: true }).catch((e: unknown) => e),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(JSON.stringify((error as ConflictException).getResponse())).toContain("hidden");
    });

    it("fails closed for a branch-scoped caller — the option list is tenant-wide config", async () => {
      await expect(
        runWithScope("branch", () => service.create(TENANT, { label: "Nursing", active: true })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("update", () => {
    it("renames without touching the key, so existing students keep their recorded value", async () => {
      repo.findById.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ label: "Nursing (B.Sc)" }));

      await runWithScope("all", () => service.update(TENANT, "ct-1", { label: "Nursing (B.Sc)" }));

      expect(repo.update).toHaveBeenCalledWith("ct-1", { label: "Nursing (B.Sc)" });
      expect(repo.update).not.toHaveBeenCalledWith("ct-1", expect.objectContaining({ key: expect.anything() }));
    });

    it("404s for an id from another tenant", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.update(TENANT, "ct-x", { label: "Nope" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("remove", () => {
    it("refuses while students hold the key, and says how many and what to do instead", async () => {
      repo.findById.mockResolvedValue(row());
      repo.countStudentsByKey.mockResolvedValue(new Map([["b_sc_nursing", 3]]));

      const error = await runWithScope("all", () => service.remove(TENANT, "ct-1").catch((e: unknown) => e));

      expect(error).toBeInstanceOf(ConflictException);
      const body = JSON.stringify((error as ConflictException).getResponse());
      expect(body).toContain("3 students");
      expect(body).toContain("Hide it instead");
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("deletes an option nobody holds", async () => {
      repo.findById.mockResolvedValue(row());
      repo.countStudentsByKey.mockResolvedValue(new Map());

      await runWithScope("all", () => service.remove(TENANT, "ct-1"));

      expect(repo.softDelete).toHaveBeenCalledWith("ct-1");
    });
  });

  describe("assertKnownKey — the write-path gate other modules use", () => {
    it("accepts an active option", async () => {
      repo.findByKey.mockResolvedValue(row());
      await expect(service.assertKnownKey(TENANT, "b_sc_nursing")).resolves.toBeUndefined();
    });

    it("rejects a HIDDEN option: hiding means stop offering this on new records", async () => {
      repo.findByKey.mockResolvedValue(row({ active: false }));
      await expect(service.assertKnownKey(TENANT, "b_sc_nursing")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a key that does not exist at all", async () => {
      repo.findByKey.mockResolvedValue(null);
      await expect(service.assertKnownKey(TENANT, "mbbs")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("labelMap — the read path", () => {
    it("includes hidden options, so a student recorded with one still renders a label", async () => {
      repo.listAll.mockResolvedValue([row(), row({ id: "ct-2", key: "mbbs", label: "MBBS", active: false })]);

      const map = await service.labelMap(TENANT);

      expect(map.get("b_sc_nursing")).toBe("B.Sc Nursing");
      expect(map.get("mbbs")).toBe("MBBS");
    });
  });
});
