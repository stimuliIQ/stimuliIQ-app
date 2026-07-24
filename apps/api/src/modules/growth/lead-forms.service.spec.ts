// apps/api/src/modules/growth/lead-forms.service.spec.ts
//
// Unit tests for LeadFormsService — closes Phase-9-completion gap #1 (CRM lead-form
// manager CRUD). Covers: scope=all gate, key-conflict -> 409, and the public
// active-only read (config-only; no lead capture here).

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { LeadFormsService } from "./lead-forms.service";
import { LeadFormsRepository, type LeadFormRow } from "./lead-forms.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<LeadFormsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByKey: jest.fn().mockResolvedValue(null),
    findActiveByKey: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<LeadFormsRepository>;
}

const ROW: LeadFormRow = {
  id: "lf-1",
  key: "homepage-hero",
  name: "Homepage hero form",
  fields: [{ key: "email", label: "Email", type: "email", required: true }],
  targetProgramId: null,
  active: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "lead_forms.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("LeadFormsService", () => {
  let service: LeadFormsService;
  let repo: Mocked<LeadFormsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new LeadFormsService(repo as unknown as LeadFormsRepository);
  });

  it("scope=all succeeds; non-all scope fails closed (403)", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);

    await expect(runWithScope("own", () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("create() rejects a duplicate key with 409", async () => {
    repo.findByKey.mockResolvedValue(ROW);
    await expect(
      runWithScope("all", () =>
        service.create("tenant-1", { key: "homepage-hero", name: "Dup", fields: [{ key: "email", label: "Email", type: "email", required: true }], active: true }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("create() succeeds for a fresh key", async () => {
    repo.create.mockResolvedValue({ id: "lf-new" });
    repo.findById.mockResolvedValue({ ...ROW, id: "lf-new" });
    const result = await runWithScope("all", () =>
      service.create("tenant-1", { key: "new-form", name: "New form", fields: [{ key: "email", label: "Email", type: "email", required: true }], active: true }),
    );
    expect(result.id).toBe("lf-new");
  });

  it("softDelete() 404s for an unknown id", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(runWithScope("all", () => service.softDelete("tenant-1", "missing"))).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getPublicByKey() returns the config-only projection for an active form", async () => {
    repo.findActiveByKey.mockResolvedValue(ROW);
    const result = await service.getPublicByKey("homepage-hero");
    expect(result).toEqual({ key: "homepage-hero", name: "Homepage hero form", fields: ROW.fields, targetProgramId: null });
  });

  it("getPublicByKey() 404s for an inactive/missing form (no existence leakage)", async () => {
    repo.findActiveByKey.mockResolvedValue(null);
    await expect(service.getPublicByKey("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
