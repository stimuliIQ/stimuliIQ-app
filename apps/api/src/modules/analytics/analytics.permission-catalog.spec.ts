// apps/api/src/modules/analytics/analytics.permission-catalog.spec.ts
//
// Regression test for the exact bug class that just 403'd all of P6
// (docs/plans/phase-7.md task #7 CRITICAL note): a controller route decorated with
// `@RequirePermission('x')` whose permission key was never added to `prisma/seed.ts`'s
// permission catalog 403s EVERY role, including admin/super_admin — the "grant every
// catalog permission to admin/super_admin" catch-all loop in seed.ts can only grant
// permissions that exist in the catalog in the first place (`forum.read` and
// `notification_prefs.edit` shipped referenced-but-unseeded in P6; this spec pins the
// same class of bug shut for every P7 `reports.*` permission).
//
// Two layers:
//   1. ALWAYS RUNS (no DB) — statically scans AnalyticsController's OWN source text for
//      every `@RequirePermission("...")` decorator (in file order) — deliberately a
//      source-text scan, not a runtime import of the controller class: the controller
//      does a REAL (non-type-only) value import of zod schemas from `@repo/types` for
//      `ZodValidationPipe`, and `@repo/types` builds as pure ESM, which this project's
//      FAST unit jest.config.js (unlike jest.integration.config.js) does not map back to
//      source — importing the controller class here would break the whole fast suite's
//      module resolution for an ESM/CJS reason unrelated to what this spec verifies.
//      Each extracted key is then checked against prisma/seed.ts's source for presence in
//      the P7 permission catalog array AND at least one explicit non-admin grant call. A
//      key referenced by the controller but missing from either fails immediately, with
//      no DB required (importing prisma/seed.ts directly is ALSO unsafe for a different
//      reason — it unconditionally executes `main()` against a live database at
//      module-load time).
//   2. DB-GUARDED (`describeIfDb`, same convention as certificates.integration.spec.ts)
//      — when `DATABASE_URL` is set, additionally queries the live seeded `permissions`
//      + `role_permissions` tables to confirm each key exists AND has >= 1 grant.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const EXPECTED_KEYS = [
  "reports.revenue.view",
  "reports.enrollment.view",
  "reports.funnel.view",
  "reports.attendance.view",
  "reports.engagement.view",
  "reports.campaigns.view",
  "reports.gamification.view",
  "reports.forum.view",
] as const;

const CONTROLLER_PATH = resolve(__dirname, "./analytics.controller.ts");
const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

/** Extracts every `@RequirePermission("key")` literal from the controller's source, in
 * file order — a plain text scan (see file header for why this cannot be a runtime
 * import/Reflect-metadata read in this project's fast unit suite). */
function requiredPermissionKeys(): string[] {
  const source = readFileSync(CONTROLLER_PATH, "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("AnalyticsController permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("every route declares exactly the expected @RequirePermission key", () => {
    expect(requiredPermissionKeys()).toEqual([...EXPECTED_KEYS]);
  });

  it.each(EXPECTED_KEYS)('"%s" is registered in the seed.ts permission catalog', (key) => {
    // Registered as a catalog entry (P7_PERMISSIONS array) — this is what makes the key
    // creatable at all, and therefore grantable to admin/super_admin via the catch-all.
    expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
  });

  it.each(EXPECTED_KEYS)('"%s" has at least one explicit non-admin role grant in seed.ts', (key) => {
    // super_admin/admin are covered by the catch-all (grant every catalog permission at
    // scope=all) — this assertion targets the Part 8 RBAC table's non-admin grants
    // (branch_manager/counsellor/faculty/finance/marketing), so a permission that is
    // merely catalogued but never actually usable by its intended role still fails here.
    expect(seedSource).toMatch(new RegExp(`p7permId\\("${key.replace(/\./g, "\\.")}"\\)`));
  });
});

// ─── DB-guarded deep check (same convention as certificates.integration.spec.ts) ──────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("AnalyticsController permission catalog — live seeded DB", () => {
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
