// apps/api/src/modules/tickets/tickets.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors.permission-catalog.spec.ts / live-classes.permission-catalog.spec.ts exactly):
// every `@RequirePermission("x")` declared by this module's controllers MUST both
// (a) exist in the seed permission catalog and (b) be granted to at least one non-admin
// role.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILES = [
  "./tickets.controller.ts",
  "./my-tickets.controller.ts",
  "./canned-responses.controller.ts",
  "./kb-articles.controller.ts",
] as const;

const ALL_EXPECTED_KEYS = [
  "tickets.view",
  "tickets.create",
  "tickets.edit",
  "tickets.assign",
  "tickets.close",
  "kb.view",
  "kb.edit",
  "canned_responses.manage",
] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Tickets module controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("TicketsController declares exactly the expected keys, in route order", () => {
    expect(requiredPermissionKeys("./tickets.controller.ts")).toEqual([
      "tickets.view", // GET /
      "tickets.view", // GET /:id
      "tickets.edit", // PATCH /:id
      "tickets.assign", // POST /:id/assign
      "tickets.close", // POST /:id/close
      "tickets.edit", // POST /:id/messages
    ]);
  });

  it("MyTicketsController declares exactly the expected keys, in route order", () => {
    expect(requiredPermissionKeys("./my-tickets.controller.ts")).toEqual([
      "tickets.view", // GET /
      "tickets.view", // GET /:id
      "tickets.create", // POST /
      "tickets.view", // POST /:id/messages
      "tickets.view", // POST /:id/rate
    ]);
  });

  it("CannedResponsesController declares canned_responses.manage for every action", () => {
    expect(requiredPermissionKeys("./canned-responses.controller.ts")).toEqual([
      "canned_responses.manage",
      "canned_responses.manage",
      "canned_responses.manage",
      "canned_responses.manage",
    ]);
  });

  it("KbArticlesController declares kb.view for reads, kb.edit for writes", () => {
    expect(requiredPermissionKeys("./kb-articles.controller.ts")).toEqual([
      "kb.view", // GET /
      "kb.view", // GET /:id
      "kb.edit", // POST /
      "kb.edit", // PATCH /:id
      "kb.edit", // DELETE /:id
    ]);
  });

  it("PublicKbArticlesController declares NO @RequirePermission (anonymous, no guards)", () => {
    const source = readFileSync(resolve(__dirname, "./kb-articles.controller.ts"), "utf8");
    const publicSection = source.slice(source.indexOf("class PublicKbArticlesController"));
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
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

describeIfDb("Tickets module permission catalog — live seeded DB", () => {
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

  it("the `student` role holds tickets.create + tickets.view at scope=own", async () => {
    const studentRole = await prisma.role.findFirst({ where: { key: "student" } });
    expect(studentRole).not.toBeNull();
    for (const key of ["tickets.create", "tickets.view"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: studentRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.own);
    }
  });

  it("the `support` role holds tickets.view/edit/assign/close + canned_responses.manage at scope=all", async () => {
    const supportRole = await prisma.role.findFirst({ where: { key: "support" } });
    expect(supportRole).not.toBeNull();
    for (const key of ["tickets.view", "tickets.edit", "tickets.assign", "tickets.close", "canned_responses.manage"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: supportRole!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }
  });

  it("the `branch_manager` role holds tickets.view at scope=branch", async () => {
    const branchManagerRole = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(branchManagerRole).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "tickets.view" } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: branchManagerRole!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.branch);
  });

  it("kb.view is granted to student/faculty/support/branch_manager/counsellor/mentor at scope=all", async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "kb.view" } });
    expect(permission).not.toBeNull();
    for (const roleKey of ["student", "faculty", "support", "branch_manager", "counsellor", "mentor"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }
  });

  it("admin/super_admin hold every ticket-module permission at scope=all (catch-all)", async () => {
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
