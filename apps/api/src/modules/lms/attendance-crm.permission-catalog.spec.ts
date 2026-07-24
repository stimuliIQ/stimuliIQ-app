// apps/api/src/modules/lms/attendance-crm.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// video-library.permission-catalog.spec.ts exactly): every `@RequirePermission("x")`
// declared by AttendanceCrmController MUST exist in the seed catalog AND be granted to
// at least one non-admin role.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const ALL_EXPECTED_KEYS = ["attendance.edit"] as const;
const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(source: string): string[] {
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Attendance-editor controller permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const controllerSource = readFileSync(resolve(__dirname, "./attendance-crm.controller.ts"), "utf8");

  it("declares exactly attendance.edit", () => {
    expect(requiredPermissionKeys(controllerSource)).toEqual(["attendance.edit"]);
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });

    it("has at least one explicit non-admin role grant reference in seed.ts", () => {
      const literal = key.replace(/\./g, "\\.");
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      const directCall = new RegExp(`permId\\("${literal}"\\)`).test(seedSource);
      expect(occurrences.length >= 2 || directCall).toBe(true);
    });
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Attendance-editor permission catalog — live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('"attendance.edit" exists in `permissions` and has >= 1 grant in `role_permissions`', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "attendance.edit" } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it("the `faculty` role holds attendance.edit at scope=assigned", async () => {
    const role = await prisma.role.findFirst({ where: { key: "faculty" } });
    expect(role).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "attendance.edit" } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.assigned);
  });

  it("admin/super_admin hold attendance.edit at scope=all (catch-all)", async () => {
    for (const roleKey of ["admin", "super_admin"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      const permission = await prisma.permission.findUnique({ where: { key: "attendance.edit" } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }
  });
});
