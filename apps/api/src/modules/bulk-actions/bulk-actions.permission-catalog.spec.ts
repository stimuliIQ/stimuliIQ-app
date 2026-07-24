// apps/api/src/modules/bulk-actions/bulk-actions.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class.
// Mirrors apps/api/src/modules/mentors/mentors.permission-catalog.spec.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const ALL_EXPECTED_KEYS = ["bulk.leads", "bulk.students"] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("BulkActions module controller permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("BulkActionsController declares exactly bulk.leads (x2) + bulk.students, in route order", () => {
    expect(requiredPermissionKeys("./bulk-actions.controller.ts")).toEqual([
      "bulk.leads", // POST leads/assign
      "bulk.leads", // POST leads/stage
      "bulk.students", // POST students/status
    ]);
  });

  it("SavedViewsController declares NO @RequirePermission (JwtAuthGuard-only — see file header)", () => {
    expect(requiredPermissionKeys("./saved-views.controller.ts")).toEqual([]);
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });

    it("has at least one explicit role grant reference in seed.ts", () => {
      const literal = key.replace(/\./g, "\\.");
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });
});

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("BulkActions permission catalog — live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(ALL_EXPECTED_KEYS)('"%s" exists in `permissions` and has >= 1 grant in `role_permissions`', async (key) => {
    const permission = await prisma.permission.findUnique({ where: { key } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it("the `counsellor` role holds bulk.leads at scope=own", async () => {
    const role = await prisma.role.findFirst({ where: { key: "counsellor" } });
    expect(role).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "bulk.leads" } });
    expect(permission).not.toBeNull();
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.own);
  });

  it("the `branch_manager` role holds bulk.students at scope=branch", async () => {
    const role = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(role).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "bulk.students" } });
    expect(permission).not.toBeNull();
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.branch);
  });
});
