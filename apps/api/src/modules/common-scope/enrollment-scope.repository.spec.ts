// apps/api/src/modules/common-scope/enrollment-scope.repository.spec.ts
//
// Unit tests for `EnrollmentScopeRepository.resolveBatchIdsForMentor` (docs/specs/
// phase-8-mentor.md LOCK-2/Rule M-1), the M:N analogue of `resolveBatchIdsForFaculty`.
// Fail-closed contract: no `mentors` row for the caller's userId, or zero active
// `batch_mentors` rows, both resolve to `[]` (never "all").

import { EnrollmentScopeRepository } from "./enrollment-scope.repository";
import { PrismaService } from "../../prisma/prisma.service";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockPrisma(): { mentor: { findFirst: jest.Mock }; batchMentor: { findMany: jest.Mock } } {
  return {
    mentor: { findFirst: jest.fn() },
    batchMentor: { findMany: jest.fn() },
  };
}

describe("EnrollmentScopeRepository.resolveBatchIdsForMentor", () => {
  let client: ReturnType<typeof mockPrisma>;
  let prisma: Mocked<PrismaService>;
  let repo: EnrollmentScopeRepository;

  beforeEach(() => {
    client = mockPrisma();
    prisma = { client } as unknown as Mocked<PrismaService>;
    repo = new EnrollmentScopeRepository(prisma as unknown as PrismaService);
  });

  it("fail-closed: returns [] when the caller has no `mentors` row for this tenant/userId", async () => {
    client.mentor.findFirst.mockResolvedValue(null);

    const result = await repo.resolveBatchIdsForMentor("tenant-1", "user-no-mentor-profile");

    expect(result).toEqual([]);
    expect(client.batchMentor.findMany).not.toHaveBeenCalled();
  });

  it("fail-closed: returns [] when the mentor exists but has zero active batch_mentors rows", async () => {
    client.mentor.findFirst.mockResolvedValue({ id: "mentor-1" });
    client.batchMentor.findMany.mockResolvedValue([]);

    const result = await repo.resolveBatchIdsForMentor("tenant-1", "user-1");

    expect(result).toEqual([]);
    expect(client.batchMentor.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", mentorId: "mentor-1", deletedAt: null },
      select: { batchId: true },
    });
  });

  it("resolves the active batch ids for the caller's mentor profile", async () => {
    client.mentor.findFirst.mockResolvedValue({ id: "mentor-1" });
    client.batchMentor.findMany.mockResolvedValue([{ batchId: "batch-a" }, { batchId: "batch-b" }]);

    const result = await repo.resolveBatchIdsForMentor("tenant-1", "user-1");

    expect(result).toEqual(["batch-a", "batch-b"]);
    expect(client.mentor.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", userId: "user-1", deletedAt: null },
      select: { id: true },
    });
  });

  it("never widens to another tenant's mentor row (tenantId is part of the lookup filter)", async () => {
    client.mentor.findFirst.mockResolvedValue(null);

    await repo.resolveBatchIdsForMentor("tenant-2", "user-1");

    expect(client.mentor.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-2", userId: "user-1", deletedAt: null },
      select: { id: true },
    });
  });
});
