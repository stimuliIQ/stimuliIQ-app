// apps/api/src/modules/platform/platform.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors/content/live-classes .permission-catalog.spec.ts exactly): every
// `@RequirePermission("x")` declared by this module's controllers MUST exist in the seed
// permission catalog AND be granted to at least one role (admin/super_admin catch-all
// counts, see NOTE below).
//
// The feature-flags controller was removed along with the rest of that seam (nothing ever
// evaluated a flag), so this module is now Settings alone.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = ["./settings.controller.ts"] as const;

const ALL_EXPECTED_KEYS = ["settings.view", "settings.edit"] as const;

/**
 * Keys granted ONLY via the admin/super_admin catch-all (no non-admin role grant).
 * `settings.edit` is intentionally admin-only (seed comment: "settings.*: branch_manager
 * may VIEW branch-level config (edit stays admin-only)"), branch_manager holds
 * settings.view but never settings.edit.
 */
const ADMIN_ONLY_KEYS = new Set(["settings.edit"]);

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Platform module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("SettingsController declares exactly settings.view (GETs) + settings.edit (PUT)", () => {
    expect(requiredPermissionKeys("./settings.controller.ts")).toEqual(["settings.view", "settings.view", "settings.edit"]);
  });

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_EXPECTED_KEYS", () => {
    const referenced = new Set(CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(f)));
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
    }
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });

    it("has at least one explicit non-admin role grant reference in seed.ts (skipped for admin-only-by-design keys)", () => {
      if (ADMIN_ONLY_KEYS.has(key)) return; // see file header NOTE.
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

describeIfDb("Platform module permission catalog, live seeded DB", () => {
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

  it("the `branch_manager` role holds settings.view at scope=branch (and NOT settings.edit)", async () => {
    const role = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(role).not.toBeNull();

    const viewPerm = await prisma.permission.findUnique({ where: { key: "settings.view" } });
    const viewGrant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: viewPerm!.id } },
    });
    expect(viewGrant).not.toBeNull();
    expect(viewGrant!.scope).toBe(RolePermissionScope.branch);

    const editPerm = await prisma.permission.findUnique({ where: { key: "settings.edit" } });
    const editGrant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: editPerm!.id } },
    });
    expect(editGrant).toBeNull();
  });

  it("admin/super_admin hold every platform permission at scope=all (catch-all)", async () => {
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
