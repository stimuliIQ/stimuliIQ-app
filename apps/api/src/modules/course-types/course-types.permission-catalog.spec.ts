// apps/api/src/modules/course-types/course-types.permission-catalog.spec.ts
//
// Regression test for the "`@RequirePermission(\"x\")` whose key is granted to nobody" bug
// class (mirrors the leave/onboarding/careers/marketing-targets catalog specs): such a route
// 403s for every caller, silently at runtime rather than loudly at build time.
//
// It also pins the ONE asymmetry this feature's RBAC rests on, which is quiet enough that a
// later tidy-up could undo it without anyone noticing:
//
//   READ is gated on `students.view`, not on a `course_types.view` of its own. Every role
//   that can open the student directory needs the option list for its dropdown to render.
//   Minting a second key for that would mean granting it to every counsellor role too — the
//   sort of grant that gets forgotten and shows up later as an empty dropdown nobody can
//   explain. If somebody adds `course_types.view`, this suite fails and they have to decide
//   deliberately, plus seed the grants.
//
//   WRITE is gated on `course_types.manage`, which IS in the catalog on purpose (unlike
//   `leave.approve` / `marketing_targets.manage`, which are narrowed to super_admin) so the
//   catch-all grants it to admin as well: maintaining the list of qualifications is
//   configuration, not authority over a person.
//
// Static source-scanning only, no live-DB half: `DATABASE_URL` in this repo points at the
// PRODUCTION Supabase instance and a test suite must not reach for it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER_FILE = "./course-types.controller.ts";

const MANAGE_KEY = "course_types.manage";
/** Reading the list rides on the student directory's own permission. */
const READ_KEY = "students.view";

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const SEED_COURSE_TYPES_PATH = resolve(__dirname, "../../../../../prisma/seed-course-types.ts");

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

function requiredPermissionKeys(relativePath: string): string[] {
  const source = readSource(relativePath);
  return [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
}

describe("course types, permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const seedCourseTypesSource = readFileSync(SEED_COURSE_TYPES_PATH, "utf8");

  it("guards every route with either the manage key or the student-directory read key", () => {
    const used = requiredPermissionKeys(CONTROLLER_FILE);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect([MANAGE_KEY, READ_KEY]).toContain(key);
    }
  });

  it("gates the list endpoint on students.view, so every picker in the CRM can read it", () => {
    expect(requiredPermissionKeys(CONTROLLER_FILE)).toContain(READ_KEY);
  });

  it("gates every write on course_types.manage", () => {
    const source = readSource(CONTROLLER_FILE);
    // Three writes: create, update, delete.
    const manageCount = [...source.matchAll(new RegExp(`@RequirePermission\\("${MANAGE_KEY}"\\)`, "g"))].length;
    expect(manageCount).toBe(3);
  });

  it("never invents a course_types.view key without seeding it", () => {
    // If this fails, a read key was added to the controller: seed it and grant it to every
    // role that can open the student directory, or go back to students.view.
    const used = requiredPermissionKeys(CONTROLLER_FILE);
    expect(used).not.toContain("course_types.view");
  });

  it("seeds course_types.manage in both the full seed and the live-database script", () => {
    expect(seedSource.includes(`"${MANAGE_KEY}"`)).toBe(true);
    expect(seedCourseTypesSource.includes(`"${MANAGE_KEY}"`)).toBe(true);
  });

  it("keeps course_types.manage IN the catalog, so admin gets it alongside super_admin", () => {
    // The mirror image of the marketing-targets/leave assertion, and deliberately so: this
    // key is meant to reach admin via the catch-all. Removing it from the catalog would
    // leave admins unable to add a course type with nothing on screen to explain why.
    const catalogStart = seedSource.indexOf("const permissionCatalog");
    expect(catalogStart).toBeGreaterThan(-1);
    const catalogEnd = seedSource.indexOf("];", catalogStart);
    expect(catalogEnd).toBeGreaterThan(catalogStart);
    const catalog = seedSource.slice(catalogStart, catalogEnd);
    expect(catalog).toContain("buildCourseTypePermissionCatalog()");
  });

  it("grants the manage key to admin and super_admin in the live-database script", () => {
    expect(seedCourseTypesSource).toMatch(/ROLE_KEYS_WITH_MANAGE\s*=\s*\[\s*"super_admin",\s*"admin"\s*\]/);
  });
});
