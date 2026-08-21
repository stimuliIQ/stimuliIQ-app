// apps/api/src/modules/live-classes/live-classes.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class
// (mirrors mentors.permission-catalog.spec.ts exactly): every `@RequirePermission("x")`
// declared by this module's controllers MUST both (a) exist in the seed permission
// catalog and (b) be granted to at least one non-admin role (super_admin/admin are
// covered by the seed's blanket catch-all).
//
// Two layers:
//   1. ALWAYS RUNS (no DB), static source-text scan of the controllers'
//      `@RequirePermission(...)` decorators, checked against prisma/seed.ts's source text.
//   2. DB-GUARDED (`describeIfDb`), queries the LIVE seeded `permissions` +
//      `role_permissions` tables to confirm each key exists AND is granted, PLUS the
//      exact role/scope grants this task's brief calls out (faculty=assigned for all 5
//      keys; mentor=assigned for view/join; student=own for view/join; branch_manager=
//      branch for view).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = ["./live-classes.controller.ts", "./my-live-classes.controller.ts"] as const;

const ALL_EXPECTED_KEYS = [
  "liveclass.view",
  "liveclass.create",
  "liveclass.edit",
  "liveclass.cancel",
  "liveclass.join",
] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Live-classes module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("LiveClassesController declares exactly the expected liveclass.* keys, in route order", () => {
    expect(requiredPermissionKeys("./live-classes.controller.ts")).toEqual([
      "liveclass.view", // GET /
      "liveclass.view", // GET /:id
      "liveclass.create", // POST /
      "liveclass.edit", // PATCH /:id
      "liveclass.cancel", // POST /:id/cancel
      "liveclass.join", // POST /:id/join
    ]);
  });

  it("MyLiveClassesController declares exactly liveclass.view (GET) + liveclass.join (POST)", () => {
    expect(requiredPermissionKeys("./my-live-classes.controller.ts")).toEqual(["liveclass.view", "liveclass.join"]);
  });

  it("LiveClassWebhookController declares NO @RequirePermission (HMAC-authenticated, no guards)", () => {
    const source = readFileSync(resolve(__dirname, "./live-class-webhook.controller.ts"), "utf8");
    expect(source).not.toMatch(/@RequirePermission\(/);
    // The class itself must not carry a `@UseGuards(...)` decorator immediately above the
    // class declaration, matched narrowly (not the doc-comment prose "No @UseGuards()"
    // above, which legitimately contains the substring as explanatory text).
    expect(source).not.toMatch(/@UseGuards\([^)]*\)\s*\n\s*export class/);
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

describeIfDb("Live-classes permission catalog, live seeded DB", () => {
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

  it("the `faculty` role holds all 5 liveclass.* keys at scope=assigned", async () => {
    const facultyRole = await prisma.role.findFirst({ where: { key: "faculty" } });
    expect(facultyRole).not.toBeNull();

    for (const key of ALL_EXPECTED_KEYS) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: facultyRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.assigned);
    }
  });

  it("the `mentor` role holds liveclass.view + liveclass.join at scope=assigned", async () => {
    const mentorRole = await prisma.role.findFirst({ where: { key: "mentor" } });
    expect(mentorRole).not.toBeNull();

    for (const key of ["liveclass.view", "liveclass.join"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: mentorRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.assigned);
    }
  });

  it("the `student` role holds liveclass.view + liveclass.join at scope=own", async () => {
    const studentRole = await prisma.role.findFirst({ where: { key: "student" } });
    expect(studentRole).not.toBeNull();

    for (const key of ["liveclass.view", "liveclass.join"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: studentRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.own);
    }
  });

  it("the `branch_manager` role holds liveclass.view at scope=branch", async () => {
    const branchManagerRole = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(branchManagerRole).not.toBeNull();

    const permission = await prisma.permission.findUnique({ where: { key: "liveclass.view" } });
    expect(permission).not.toBeNull();
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: branchManagerRole!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.branch);
  });

  it("admin/super_admin hold every liveclass.* permission at scope=all (catch-all)", async () => {
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
