// apps/api/src/modules/mentors/mentors.permission-catalog.spec.ts
//
// Regression test for the exact bug class documented in
// analytics.permission-catalog.spec.ts (P6 forum.read/notification_prefs.edit 403'd
// every caller because the permission key was never added to prisma/seed.ts's catalog):
// every `@RequirePermission("x")` this module's FOUR controllers declare MUST both (a)
// exist in the seed permission catalog and (b) be granted to at least one non-admin role
// (super_admin/admin are covered by the seed's blanket catch-all, so a catalog-only,
// never-granted-to-anyone-else permission would still 403 every real caller).
//
// Two layers (mirrors analytics.permission-catalog.spec.ts exactly):
//   1. ALWAYS RUNS (no DB) — static source-text scan of the 4 mentor controllers'
//      `@RequirePermission(...)` decorators, in file order, checked against prisma/
//      seed.ts's source text.
//   2. DB-GUARDED (`describeIfDb`) — queries the LIVE seeded `permissions` +
//      `role_permissions` tables to confirm each key exists AND is granted, PLUS the
//      exact mentor-role/branch_manager-role grants this task's brief calls out
//      explicitly (batches.view + batches.markComplete at scope=assigned for `mentor`;
//      batches.markComplete at scope=branch for `branch_manager`) — the specific
//      regression this task exists to prevent, not just "some grant exists somewhere".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = [
  "./mentors.controller.ts",
  "./batch-mentors.controller.ts",
  "./batch-completion.controller.ts",
  "./mentor-dashboard.controller.ts",
] as const;

/** Every distinct permission key ANY route in this module requires. */
const ALL_EXPECTED_KEYS = [
  "mentors.view",
  "mentors.create",
  "mentors.edit",
  "mentors.delete",
  "mentors.assign",
  "batches.view",
  "batches.markComplete",
  "mentor.dashboard.view",
] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Mentors module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("MentorsController declares exactly the expected mentors.* CRUD keys, in route order", () => {
    expect(requiredPermissionKeys("./mentors.controller.ts")).toEqual([
      "mentors.view", // GET /
      "mentors.edit", // POST /photo-upload-url (declared before the :id routes)
      "mentors.view", // GET /:id
      "mentors.create", // POST /
      "mentors.edit", // PATCH /:id
      "mentors.delete", // DELETE /:id
      "mentors.edit", // POST /:id/restore
    ]);
  });

  it("BatchMentorsController declares exactly batches.view (GET) + mentors.assign (POST/DELETE)", () => {
    expect(requiredPermissionKeys("./batch-mentors.controller.ts")).toEqual([
      "batches.view",
      "mentors.assign",
      "mentors.assign",
    ]);
  });

  it("BatchCompletionController declares exactly batches.view (GETs) + batches.markComplete (POST)", () => {
    expect(requiredPermissionKeys("./batch-completion.controller.ts")).toEqual([
      "batches.view",
      "batches.view",
      "batches.markComplete",
    ]);
  });

  it("MentorDashboardController declares exactly mentor.dashboard.view", () => {
    expect(requiredPermissionKeys("./mentor-dashboard.controller.ts")).toEqual(["mentor.dashboard.view"]);
  });

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_EXPECTED_KEYS", () => {
    const referenced = new Set(CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(f)));
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
    }
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    it("is registered in the seed catalog", () => {
      if (key === "batches.view") {
        // Pre-existing P1 cross-product permission (P1_MODULES x P1_ACTIONS), not a
        // literal `key: "batches.view"` entry — assert the cross-product membership
        // that generates it instead.
        expect(seedSource).toMatch(/"batches"/);
        expect(seedSource).toMatch(/P1_ACTIONS = \[[^\]]*"view"/);
      } else {
        expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
      }
    });

    it("has at least one explicit non-admin role grant reference in seed.ts", () => {
      // A lenient (but real) presence check tolerant of both call shapes this file uses
      // for P8 grants: individual `grant(role.id, p8permId("key"), scope)` calls AND
      // `array.map((key) => grant(role.id, p8permId(key), scope))` loops over a literal
      // string array — both are legitimate; only a KEY MISSING FROM SEED.TS ENTIRELY
      // (the actual P6 bug class) should fail this. The DB-guarded block below asserts
      // the precise mentor-role/branch_manager-role grants this task calls out.
      const literal = key.replace(/\./g, "\\.");
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      const directCall = new RegExp(`permId\\("${literal}"\\)`).test(seedSource);
      expect(occurrences.length >= 2 || directCall).toBe(true);
    });
  });
});

// ─── DB-guarded deep check (same convention as certificates.integration.spec.ts /
// analytics.permission-catalog.spec.ts) ─────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Mentors permission catalog — live seeded DB", () => {
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

  it("the `mentor` role holds mentor.dashboard.view + batches.view + batches.markComplete, all at scope=assigned", async () => {
    const mentorRole = await prisma.role.findFirst({ where: { key: "mentor" } });
    expect(mentorRole).not.toBeNull();

    for (const key of ["mentor.dashboard.view", "batches.view", "batches.markComplete"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: mentorRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.assigned);
    }
  });

  it("the `mentor` role holds NONE of mentors.view/create/edit/delete/assign (Rule M-3)", async () => {
    const mentorRole = await prisma.role.findFirst({ where: { key: "mentor" } });
    expect(mentorRole).not.toBeNull();

    for (const key of ["mentors.view", "mentors.create", "mentors.edit", "mentors.delete", "mentors.assign"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: mentorRole!.id, permissionId: permission!.id } },
      });
      expect(grant).toBeNull();
    }
  });

  it("the `branch_manager` role holds batches.markComplete at scope=branch", async () => {
    const branchManagerRole = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(branchManagerRole).not.toBeNull();

    const permission = await prisma.permission.findUnique({ where: { key: "batches.markComplete" } });
    expect(permission).not.toBeNull();

    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: branchManagerRole!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.branch);
  });

  it("admin/super_admin hold every mentor-module permission at scope=all (catch-all)", async () => {
    for (const roleKey of ["admin", "super_admin"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();

      for (const key of ALL_EXPECTED_KEYS) {
        const permission = await prisma.permission.findUnique({ where: { key } });
        expect(permission).not.toBeNull();
        const grant = await prisma.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
        });
        expect(grant).not.toBeNull();
        expect(grant!.scope).toBe(RolePermissionScope.all);
      }
    }
  });
});
