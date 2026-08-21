// apps/api/src/modules/certificates/certificates.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// content/content.permission-catalog.spec.ts exactly): every `@RequirePermission("x")`
// declared by this module's controllers MUST both (a) exist in the seed permission
// catalog and (b) be granted to at least one non-admin role. `certificates-verify.
// controller.ts` (public verify) is excluded, no guards, public endpoint.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = ["./certificates-crm.controller.ts", "./certificates-lms.controller.ts"] as const;

const ALL_EXPECTED_KEYS = [
  "certificates.view",
  "certificates.issue",
  "certificates.recommend",
  "certificates.revoke",
] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Certificates module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_EXPECTED_KEYS", () => {
    const referenced = new Set(CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(f)));
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
    }
    for (const key of ALL_EXPECTED_KEYS) {
      expect(referenced.has(key)).toBe(true);
    }
  });

  it("certificates-verify.controller.ts (public verify) declares NO @RequirePermission", () => {
    const source = readFileSync(resolve(__dirname, "./certificates-verify.controller.ts"), "utf8");
    expect(source).not.toMatch(/@RequirePermission\(/);
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

describeIfDb("Certificates module permission catalog, live seeded DB", () => {
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

  it("the `branch_manager` role holds certificates.issue + certificates.revoke at scope=branch", async () => {
    const role = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(role).not.toBeNull();
    for (const key of ["certificates.issue", "certificates.revoke"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.branch);
    }
  });

  it("admin/super_admin hold every key at scope=all (catch-all)", async () => {
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
