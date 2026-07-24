// apps/api/src/modules/referrals/referrals.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors/content/platform .permission-catalog.spec.ts exactly): every
// `@RequirePermission("x")` declared by this module's guarded controllers MUST exist in
// the seed catalog AND be granted to at least one non-admin role. The public redeem
// controller must declare NO @RequirePermission at all.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const GUARDED_CONTROLLER_FILES = ["./referrals.controller.ts"] as const;

const ALL_EXPECTED_KEYS = ["referrals.view", "referrals.create", "referrals.approve"] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(source: string): string[] {
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Referrals module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const controllerSource = readFileSync(resolve(__dirname, "./referrals.controller.ts"), "utf8");

  it("PublicReferralsController declares NO @RequirePermission (anonymous redeem)", () => {
    const publicSection = controllerSource.slice(
      controllerSource.indexOf("class PublicReferralsController"),
      controllerSource.indexOf("class CrmReferralsController"),
    );
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
  });

  it("MyReferralsController declares exactly referrals.view (GET) + referrals.create (POST)", () => {
    const section = controllerSource.slice(
      controllerSource.indexOf("class MyReferralsController"),
      controllerSource.indexOf("class PublicReferralsController"),
    );
    expect(requiredPermissionKeys(section)).toEqual(["referrals.view", "referrals.create"]);
  });

  it("CrmReferralsController declares exactly referrals.view (GET) + referrals.approve (PATCH)", () => {
    const section = controllerSource.slice(controllerSource.indexOf("class CrmReferralsController"));
    expect(requiredPermissionKeys(section)).toEqual(["referrals.view", "referrals.approve"]);
  });

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_EXPECTED_KEYS", () => {
    const referenced = new Set(GUARDED_CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(readFileSync(resolve(__dirname, f), "utf8"))));
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
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

describeIfDb("Referrals module permission catalog — live seeded DB", () => {
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

  it("the `student` role holds referrals.view + referrals.create at scope=own", async () => {
    const role = await prisma.role.findFirst({ where: { key: "student" } });
    expect(role).not.toBeNull();
    for (const key of ["referrals.view", "referrals.create"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.own);
    }
  });

  it("the `marketing` role holds referrals.approve at scope=all", async () => {
    const role = await prisma.role.findFirst({ where: { key: "marketing" } });
    expect(role).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "referrals.approve" } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.all);
  });

  it("admin/super_admin hold every referrals.* permission at scope=all (catch-all)", async () => {
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
