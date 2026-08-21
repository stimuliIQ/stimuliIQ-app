// apps/api/src/modules/exports/exports.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit bug class (see
// apps/api/src/modules/analytics/analytics.permission-catalog.spec.ts's file header for
// the full history): a controller route decorated with `@RequirePermission('x')` whose
// permission key was never added to `prisma/seed.ts`'s permission catalog 403s EVERY
// role, including admin/super_admin. This spec pins the same class of bug shut for
// `reports.export` (ExportsController, docs/plans/phase-7.md task #8).
//
// Same two-layer strategy as analytics.permission-catalog.spec.ts:
//   1. ALWAYS RUNS (no DB), static source-text scan of ExportsController for every
//      `@RequirePermission("...")` decorator, cross-checked against prisma/seed.ts's
//      P7_PERMISSIONS catalog array + at least one explicit non-admin grant call.
//   2. DB-GUARDED, when DATABASE_URL is set, additionally queries the live seeded
//      `permissions` + `role_permissions` tables.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const EXPECTED_KEYS = ["reports.export"] as const;

const CONTROLLER_PATH = resolve(__dirname, "./exports.controller.ts");
const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(): string[] {
  const source = readFileSync(CONTROLLER_PATH, "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("ExportsController permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("every route declares exactly the expected @RequirePermission key", () => {
    // All three routes (create/list/getById) require the SAME single permission.
    const keys = requiredPermissionKeys();
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(EXPECTED_KEYS as readonly string[]).toContain(key);
    }
  });

  it.each(EXPECTED_KEYS)('"%s" is registered in the seed.ts permission catalog', (key) => {
    expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
  });

  it.each(EXPECTED_KEYS)('"%s" has at least one explicit non-admin role grant in seed.ts', (key) => {
    expect(seedSource).toMatch(new RegExp(`p7permId\\("${key.replace(/\./g, "\\.")}"\\)`));
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("ExportsController permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(EXPECTED_KEYS)('"%s" exists in `permissions` and has >= 1 grant in `role_permissions`', async (key) => {
    const permission = await prisma.permission.findUnique({ where: { key } });
    expect(permission).not.toBeNull();

    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });
});
