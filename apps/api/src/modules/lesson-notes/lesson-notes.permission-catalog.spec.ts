// apps/api/src/modules/lesson-notes/lesson-notes.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class.
// Mirrors apps/api/src/modules/mentors/mentors.permission-catalog.spec.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const ALL_EXPECTED_KEYS = ["notes.manage"] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("LessonNotes module controller permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("LessonNotesController declares exactly notes.manage on create/list/update/remove, in route order", () => {
    expect(requiredPermissionKeys("./lesson-notes.controller.ts")).toEqual([
      "notes.manage", // POST /
      "notes.manage", // GET /
      "notes.manage", // PATCH /:noteId
      "notes.manage", // DELETE /:noteId
    ]);
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });

    it("has at least one explicit role grant reference in seed.ts", () => {
      const literal = key.replace(/\./g, "\\.");
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });
});

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Lesson notes permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('"notes.manage" exists in `permissions` and has >= 1 grant in `role_permissions`', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: "notes.manage" } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it("the `student` role holds notes.manage at scope=own", async () => {
    const studentRole = await prisma.role.findFirst({ where: { key: "student" } });
    expect(studentRole).not.toBeNull();
    const permission = await prisma.permission.findUnique({ where: { key: "notes.manage" } });
    expect(permission).not.toBeNull();
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: studentRole!.id, permissionId: permission!.id } },
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe(RolePermissionScope.own);
  });
});
