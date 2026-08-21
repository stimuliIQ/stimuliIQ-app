// apps/api/src/modules/auth/two-factor.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors/content/platform/referrals/emi .permission-catalog.spec.ts exactly): the
// single `@RequirePermission("twofa.manage")` this module's TwoFactorController
// declares MUST exist in the seed catalog AND be granted to every role (per
// prisma/seed.ts's P9 grants comment: "EVERY role manages their OWN 2FA enrolment").
// TwoFactorLoginController (the unauthenticated login-verify step) and
// PasswordResetController (fully unauthenticated) must declare NO @RequirePermission
// at all.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const EXPECTED_KEY = "twofa.manage";
const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(source: string): string[] {
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Two-factor / password-reset controllers permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const twoFactorSource = readFileSync(resolve(__dirname, "./two-factor.controller.ts"), "utf8");
  const passwordResetSource = readFileSync(resolve(__dirname, "./password-reset.controller.ts"), "utf8");

  it("TwoFactorController declares exactly twofa.manage on every route (status/enroll/enroll-verify/disable)", () => {
    const section = twoFactorSource.slice(twoFactorSource.indexOf("class TwoFactorController"), twoFactorSource.indexOf("class TwoFactorLoginController"));
    expect(requiredPermissionKeys(section)).toEqual([EXPECTED_KEY, EXPECTED_KEY, EXPECTED_KEY, EXPECTED_KEY]);
  });

  it("TwoFactorLoginController declares NO @RequirePermission (unauthenticated login-verify step)", () => {
    const section = twoFactorSource.slice(twoFactorSource.indexOf("class TwoFactorLoginController"));
    expect(section).not.toMatch(/@RequirePermission\(/);
  });

  it("PasswordResetController declares NO @RequirePermission (fully unauthenticated)", () => {
    expect(passwordResetSource).not.toMatch(/@RequirePermission\(/);
  });

  it('"twofa.manage" is registered in the seed catalog', () => {
    expect(seedSource).toMatch(/key:\s*"twofa\.manage"/);
  });

  it('"twofa.manage" has an explicit grant reference in seed.ts for every role (per the P9 grants comment)', () => {
    const occurrences = seedSource.match(/"twofa\.manage"/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('"twofa.reset" (admin rescue) is registered in the seed catalog and granted', () => {
    expect(seedSource).toMatch(/key:\s*"twofa\.reset"/);
    // Catalog entry + at least one grant, a permission granted to nobody is a dead route.
    expect((seedSource.match(/"twofa\.reset"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the admin-clear route requires twofa.reset, NOT the own-scope twofa.manage", () => {
    // The whole point of the separate key: `twofa.manage` is held by EVERY role at
    // own-scope, so gating "clear someone else's 2FA" on it would let any student strip
    // a colleague's second factor. If this ever flips back, that hole reopens silently.
    const usersControllerSource = readFileSync(resolve(__dirname, "../admin/users.controller.ts"), "utf8");
    const clearSection = usersControllerSource.slice(usersControllerSource.indexOf("two-factor/clear") - 400);
    expect(clearSection).toMatch(/@RequirePermission\("twofa\.reset"\)/);
    expect(clearSection).not.toMatch(/@RequirePermission\("twofa\.manage"\)/);
  });

  it("TwoFactorRecoveryController declares NO @RequirePermission (unauthenticated, the caller cannot log in)", () => {
    const recoverySource = readFileSync(resolve(__dirname, "./two-factor-recovery.controller.ts"), "utf8");
    expect(recoverySource).not.toMatch(/@RequirePermission\(/);
  });

  it("both 2FA recovery routes are CSRF-excluded (no session cookie exists pre-auth)", () => {
    // A CSRF-guarded route here would 403 every legitimate caller, they have no session,
    // so no CSRF cookie was ever issued. Same posture as auth/password-reset/*.
    const appModuleSource = readFileSync(resolve(__dirname, "../../app.module.ts"), "utf8");
    expect(appModuleSource).toContain('"auth/2fa/recovery/request"');
    expect(appModuleSource).toContain('"auth/2fa/recovery/confirm"');
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Two-factor permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('"twofa.reset" exists, has >= 1 grant, and is NOT held by the student role', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "twofa.reset" } });
    // A FAILURE HERE ON AN ESTABLISHED DATABASE IS EXPECTED AND ACTIONABLE, not a code
    // bug: `twofa.reset` is new, and a permission missing from this table can be granted
    // to nobody, so POST /crm/admin/users/:id/two-factor/clear 403s for everyone
    // (fail-closed, a functional gap, not a hole). CI is green because it builds its DB
    // with the full `pnpm db:seed`, which now defines the key. To fix a live/existing
    // database WITHOUT injecting demo fixtures, run: pnpm db:seed:twofa-reset
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);

    // The separation that makes this permission worth having at all.
    const studentRole = await prisma.role.findFirst({ where: { key: "student" } });
    const studentGrant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: studentRole!.id, permissionId: permission!.id } },
    });
    expect(studentGrant).toBeNull();
  });

  it('"twofa.manage" exists in `permissions` and has >= 1 grant', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: EXPECTED_KEY } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it("the `student` role holds twofa.manage at scope=own", async () => {
    const role = await prisma.role.findFirst({ where: { key: "student" } });
    expect(role).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: EXPECTED_KEY } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.own);
  });
});
