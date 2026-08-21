// apps/api/src/modules/audit/audit.service.spec.ts
//
// Unit tests for AuditService, read-only filter pass-through and DTO mapping (no scope
// resolution needed: audit_logs.view is seeded at scope=all only).

import { AuditService } from "./audit.service";
import { AuditRepository, type AuditLogRow } from "./audit.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<AuditRepository> {
  return { list: jest.fn() } as unknown as Mocked<AuditRepository>;
}

const ROW: AuditLogRow = {
  id: "audit-1",
  actorId: "user-1",
  actorName: "Admin User",
  entity: "Batch",
  entityId: "batch-1",
  action: "update",
  before: { status: "planned" },
  after: { status: "active" },
  ip: "127.0.0.1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("AuditService", () => {
  let service: AuditService;
  let repo: Mocked<AuditRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new AuditService(repo as unknown as AuditRepository);
  });

  it("passes filters through to the repository and maps rows to DTOs", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

    const result = await service.list("tenant-1", {
      entity: "Batch",
      entityId: "batch-1",
      page: 1,
      pageSize: 20,
    });

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", entity: "Batch", entityId: "batch-1" }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.actorName).toBe("Admin User");
    expect(result.items[0]?.before).toEqual({ status: "planned" });
  });

  it("never re-redacts before/after, passes them through exactly as written by the audit extension", async () => {
    repo.list.mockResolvedValue({ rows: [{ ...ROW, before: null, after: { secret: "should-not-happen" } }], total: 1 });

    const result = await service.list("tenant-1", { page: 1, pageSize: 20 });

    expect(result.items[0]?.after).toEqual({ secret: "should-not-happen" });
  });
});
