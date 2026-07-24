// apps/api/src/modules/platform/settings.service.spec.ts
//
// Unit tests for SettingsService: reads resolve at all|branch scope (no branch_id
// column); writes require scope=all (system-scope admin-only business rule, naturally
// enforced since settings.edit is never granted below scope=all).

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Setting as SettingRow } from "@prisma/client";
import { SettingsService } from "./settings.service";
import { SettingsRepository } from "./settings.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<SettingsRepository> {
  return {
    list: jest.fn(),
    findByScopeAndKey: jest.fn(),
    upsert: jest.fn(),
  } as unknown as Mocked<SettingsRepository>;
}

const ROW: SettingRow = {
  id: "setting-1",
  tenantId: "tenant-1",
  scope: "company",
  key: "branding.primary_color",
  value: { hex: "#123456" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], permissionKey: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey, scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("SettingsService", () => {
  let service: SettingsService;
  let repo: Mocked<SettingsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new SettingsService(repo as unknown as SettingsRepository);
  });

  it("list() allows scope=branch (read-only, no branch_id column -> no restriction)", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("branch", "settings.view", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);
  });

  it("get() 404s when the row does not exist", async () => {
    repo.findByScopeAndKey.mockResolvedValue(null);
    await expect(
      runWithScope("all", "settings.view", () => service.get("tenant-1", "company", "missing.key")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("set() succeeds at scope=all", async () => {
    repo.upsert.mockResolvedValue(ROW);
    const result = await runWithScope("all", "settings.edit", () =>
      service.set("tenant-1", "company", "branding.primary_color", { value: { hex: "#123456" } }),
    );
    expect(result.key).toBe("branding.primary_color");
  });

  it("set() rejects scope=branch — writes require scope=all even for system-scope-adjacent business rule", async () => {
    await expect(
      runWithScope("branch", "settings.edit", () =>
        service.set("tenant-1", "system", "site.maintenance_mode", { value: true }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
