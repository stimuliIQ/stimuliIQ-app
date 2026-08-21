// apps/api/src/modules/emi/emi.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors/content/platform/referrals .permission-catalog.spec.ts exactly): every
// `@RequirePermission("x")` declared by this module's controllers MUST exist in the
// seed catalog AND be granted to at least one non-admin role.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = ["./emi.controller.ts"] as const;

const ALL_EXPECTED_KEYS = ["emi.view", "emi.create", "emi.edit", "emi.charge"] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(source: string): string[] {
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("EMI module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const controllerSource = readFileSync(resolve(__dirname, "./emi.controller.ts"), "utf8");

  it("CrmEmiController declares exactly emi.view/create/view/charge/edit in route order", () => {
    const section = controllerSource.slice(controllerSource.indexOf("class CrmEmiController"), controllerSource.indexOf("class MyEmiController"));
    expect(requiredPermissionKeys(section)).toEqual(["emi.view", "emi.create", "emi.view", "emi.charge", "emi.edit"]);
  });

  it("MyEmiController declares exactly emi.view (GET)", () => {
    const section = controllerSource.slice(controllerSource.indexOf("class MyEmiController"));
    expect(requiredPermissionKeys(section)).toEqual(["emi.view"]);
  });

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_EXPECTED_KEYS", () => {
    const referenced = new Set(CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(readFileSync(resolve(__dirname, f), "utf8"))));
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
    }
    for (const key of ALL_EXPECTED_KEYS) {
      expect(referenced.has(key)).toBe(true);
    }
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

describeIfDb("EMI module permission catalog, live seeded DB", () => {
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

  it("the `finance` role holds every emi.* key at scope=all", async () => {
    const role = await prisma.role.findFirst({ where: { key: "finance" } });
    expect(role).not.toBeNull();
    for (const key of ALL_EXPECTED_KEYS) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }
  });

  it("both `counsellor` and `student` hold emi.view at scope=own (student for GET /me/emi-plans)", async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "emi.view" } });
    for (const roleKey of ["counsellor", "student"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.own);
    }
  });

  it("admin/super_admin hold every emi.* permission at scope=all (catch-all)", async () => {
    for (const roleKey of ["admin", "super_admin"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      for (const key of ALL_EXPECTED_KEYS) {
        const permission = await prisma.permission.findUnique({ where: { key } });
        const grant = await prisma.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
        });
        expect(grant).not.toBeNull();
        expect(grant!.scope).toBe(RolePermissionScope.all);
      }
    }
  });
});
