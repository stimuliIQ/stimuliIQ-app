// apps/api/src/modules/dpdp/dpdp.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit bug class (see
// apps/api/src/modules/analytics/analytics.permission-catalog.spec.ts's file header for
// the full history): a controller route decorated with `@RequirePermission('x')` whose
// permission key was never added to `prisma/seed.ts`'s permission catalog 403s EVERY
// role, including admin/super_admin. This spec pins the same class of bug shut for
// `dpdp.erasure.execute` (DpdpController, docs/plans/phase-7.md Wave 2 task #13).
//
// UNLIKE every other P7 permission-catalog spec, this one ALSO asserts the opposite
// direction: `dpdp.erasure.execute` must NOT be explicitly granted to any non-admin role
// in seed.ts (it is intentionally covered ONLY by the super_admin/admin catch-all loop),
// a future edit that adds an explicit non-admin grant for this permission would silently
// widen who can trigger a PII-erasure action, which is exactly the kind of privilege
// creep AC-65 exists to prevent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const EXPECTED_KEYS = ["dpdp.erasure.execute"] as const;

const CONTROLLER_PATH = resolve(__dirname, "./dpdp.controller.ts");
const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(): string[] {
  const source = readFileSync(CONTROLLER_PATH, "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("DpdpController permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("the erasure route declares exactly the expected @RequirePermission key", () => {
    const keys = requiredPermissionKeys();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const key of keys) {
      expect(EXPECTED_KEYS as readonly string[]).toContain(key);
    }
  });

  it.each(EXPECTED_KEYS)('"%s" is registered in the seed.ts permission catalog', (key) => {
    expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
  });

  it.each(EXPECTED_KEYS)(
    '"%s" has NO explicit non-admin grant call in seed.ts (admin-only via the super_admin/admin catch-all)',
    (key) => {
      // Every OTHER P7 permission has an explicit `grant(<role>Role!.id, p7permId("key"), ...)`
      // call for at least one non-admin role. `dpdp.erasure.execute` deliberately has none,
      // if this regex ever matches, someone added a non-admin grant and widened who can
      // trigger PII erasure, which must be a conscious, reviewed decision, not a silent one.
      expect(seedSource).not.toMatch(new RegExp(`p7permId\\("${key.replace(/\./g, "\\.")}"\\)`));
    },
  );
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("DpdpController permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(EXPECTED_KEYS)('"%s" exists in `permissions` and is granted to super_admin/admin only', async (key) => {
    const permission = await prisma.permission.findUnique({ where: { key } });
    expect(permission).not.toBeNull();

    const grants = await prisma.rolePermission.findMany({
      where: { permissionId: permission!.id },
      include: { role: { select: { key: true } } },
    });
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(["super_admin", "admin"]).toContain(grant.role.key);
      expect(grant.scope).toBe("all");
    }
  });
});
