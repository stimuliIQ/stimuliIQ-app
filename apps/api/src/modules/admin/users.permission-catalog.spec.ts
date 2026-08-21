// apps/api/src/modules/admin/users.permission-catalog.spec.ts
//
// Guards the permission split that makes staff-account DELETION safe, in the same shape as
// two-factor.permission-catalog.spec.ts.
//
// Admin ▸ Users exposes two destructive routes that read almost identically:
//   DELETE /crm/admin/users/:id            → DEACTIVATE  (users.delete, super_admin + admin)
//   DELETE /crm/admin/users/:id/permanent  → REMOVE      (users.remove, super_admin ONLY)
//
// The whole value of the second key is that `admin` does not hold it. If `users.remove` ever
// gets folded into the USERS_ADMIN_PERMISSIONS loop in seed.ts, which grants to super_admin
// AND admin, every admin silently gains the ability to delete colleagues' accounts, and
// nothing else in the codebase would notice. These tests notice.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const CONTROLLER_PATH = resolve(__dirname, "./users.controller.ts");

describe("Admin ▸ Users permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const controllerSource = readFileSync(CONTROLLER_PATH, "utf8");

  it('"users.remove" is registered in the seed catalog', () => {
    expect(seedSource).toMatch(/key:\s*"users\.remove"/);
  });

  it('"users.remove" is granted to super_admin only, NOT via the super_admin+admin loop', () => {
    // The shared loop iterates `[superAdminRole, adminRole]` over USERS_ADMIN_PERMISSIONS.
    // `users.remove` must be granted outside it, against superAdminRole by name.
    const catalogBlock = seedSource.slice(
      seedSource.indexOf("const USERS_ADMIN_PERMISSIONS"),
      seedSource.indexOf("const USERS_ADMIN_PERMISSIONS") + 900,
    );
    expect(catalogBlock).not.toMatch(/key:\s*"users\.remove"/);
    expect(seedSource).toMatch(/grant\(\s*superAdminRole\.id,\s*usersRemovePermission\.id/);
    expect(seedSource).not.toMatch(/grant\(\s*adminRole\.id,\s*usersRemovePermission\.id/);
  });

  it("the permanent-delete route requires users.remove, NOT users.delete", () => {
    // If this flips back, every `admin` can delete accounts, the exact hole the separate
    // key exists to prevent, and one that fails open rather than closed.
    const removeSection = controllerSource.slice(controllerSource.indexOf('@Delete(":id/permanent")'));
    expect(removeSection).toMatch(/@RequirePermission\("users\.remove"\)/);
    expect(removeSection).not.toMatch(/@RequirePermission\("users\.delete"\)/);
  });

  it("the deactivate route still requires users.delete (unchanged for admin)", () => {
    const deactivateSection = controllerSource.slice(
      controllerSource.indexOf('@Delete(":id")'),
      controllerSource.indexOf('@Delete(":id/permanent")'),
    );
    expect(deactivateSection).toMatch(/@RequirePermission\("users\.delete"\)/);
  });

  // ── users.reset_password, same shape of guard, same failure mode if folded in ──
  //
  // POST /crm/admin/users/:id/reset-password mints a one-time credential for the target.
  // If it ever rides `users.edit` (super_admin + admin), every admin gains the ability to
  // reset a SUPER admin's password and take that account over through its inbox. That is a
  // privilege-escalation path, and nothing else in the codebase would notice it opening.

  it('"users.reset_password" is registered in the seed catalog', () => {
    expect(seedSource).toMatch(/key:\s*"users\.reset_password"/);
  });

  it('"users.reset_password" is granted to super_admin only, NOT via the super_admin+admin loop', () => {
    const catalogBlock = seedSource.slice(
      seedSource.indexOf("const USERS_ADMIN_PERMISSIONS"),
      seedSource.indexOf("const USERS_ADMIN_PERMISSIONS") + 900,
    );
    expect(catalogBlock).not.toMatch(/key:\s*"users\.reset_password"/);
    expect(seedSource).toMatch(/grant\(\s*superAdminRole\.id,\s*usersResetPasswordPermission\.id/);
    expect(seedSource).not.toMatch(/grant\(\s*adminRole\.id,\s*usersResetPasswordPermission\.id/);
  });

  it("the reset-password route requires users.reset_password, NOT users.edit", () => {
    const resetSection = controllerSource.slice(controllerSource.indexOf('@Post(":id/reset-password")'));
    expect(resetSection).toMatch(/@RequirePermission\("users\.reset_password"\)/);
    expect(resetSection).not.toMatch(/@RequirePermission\("users\.edit"\)/);
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Admin ▸ Users permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('"users.remove" exists and is held by super_admin alone', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "users.remove" } });
    // A FAILURE HERE ON AN ESTABLISHED DATABASE IS EXPECTED AND ACTIONABLE, not a code bug:
    // `users.remove` is new, and a permission missing from this table can be granted to
    // nobody, so DELETE /crm/admin/users/:id/permanent 403s for everyone (fail-closed, a
    // functional gap, not a hole) and the Delete action never renders. To fix a live
    // database WITHOUT injecting demo fixtures, run: pnpm db:seed:user-delete
    expect(permission).not.toBeNull();

    const grants = await prisma.rolePermission.findMany({
      where: { permissionId: permission!.id },
      include: { role: { select: { key: true } } },
    });
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.map((g) => g.role.key).sort()).toEqual(["super_admin"]);
  });
});
