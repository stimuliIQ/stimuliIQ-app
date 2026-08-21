// apps/api/src/modules/marketing-targets/marketing-targets.permission-catalog.spec.ts
//
// Regression test for the "`@RequirePermission(\"x\")` whose key is granted to nobody" bug
// class (mirrors leave/onboarding/careers `.permission-catalog.spec.ts`): such a route 403s
// for every caller, and it does so silently at runtime rather than loudly at build time.
//
// It also pins the three decisions this feature's RBAC rests on, all of which are quiet
// enough that a later tidy-up could undo them without anyone noticing:
//
//   1. NEITHER key is in the permission catalog. The catalog is the array the
//      admin+super_admin catch-all loop iterates, so moving either key into it would hand
//      BOTH to every operational admin. For `manage` that means any admin could set the
//      number their own team is judged against; for `view` it means every admin gets a
//      permanently-empty "My target" card on their dashboard.
//
//   2. `marketing_targets.view` is granted to the MARKETING role, and to nothing else.
//      "Only visible for the marketing role" is the product requirement.
//
//   3. `marketing_targets.manage` is granted to super_admin, and to nothing else, the same
//      narrowing as `leave.approve`.
//
// Static source-scanning only, no live-DB half: `DATABASE_URL` in this repo points at the
// PRODUCTION Supabase instance, and a test suite must not reach for it. These assertions
// cover the same invariant by reading the seed source.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER_FILE = "./marketing-targets.controller.ts";

/** The person measured reads their own card. MARKETING role only, scope=own. */
const MARKETING_ONLY_KEYS = ["marketing_targets.view"] as const;
/** Setting numbers + the team report. super_admin alone. */
const SUPER_ADMIN_ONLY_KEYS = ["marketing_targets.manage"] as const;

const ALL_KNOWN_KEYS = [...MARKETING_ONLY_KEYS, ...SUPER_ADMIN_ONLY_KEYS] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const SEED_TARGETS_PATH = resolve(__dirname, "../../../../../prisma/seed-marketing-targets.ts");

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

function requiredPermissionKeys(relativePath: string): string[] {
  const source = readSource(relativePath);
  return [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
}

describe("marketing targets, permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const seedTargetsSource = readFileSync(SEED_TARGETS_PATH, "utf8");

  it("guards every route with a key this feature actually defines", () => {
    const used = requiredPermissionKeys(CONTROLLER_FILE);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(ALL_KNOWN_KEYS).toContain(key);
    }
  });

  it("uses both keys, an unused key is a permission nobody can exercise", () => {
    const used = new Set(requiredPermissionKeys(CONTROLLER_FILE));
    for (const key of ALL_KNOWN_KEYS) {
      expect(used.has(key)).toBe(true);
    }
  });

  it("seeds both keys somewhere", () => {
    for (const key of ALL_KNOWN_KEYS) {
      expect(seedSource.includes(`"${key}"`)).toBe(true);
      expect(seedTargetsSource.includes(`"${key}"`)).toBe(true);
    }
  });

  // ── The three narrowings ────────────────────────────────────────────────

  it("keeps BOTH keys out of the permission catalog, so the admin catch-all cannot grant them", () => {
    // The catch-all loop grants every entry of `permissionCatalog` to admin + super_admin at
    // scope=all. Membership is what this test forbids: both keys must be upserted in the
    // dedicated block instead. If somebody "tidies" them into the catalog, this fails.
    const catalogStart = seedSource.indexOf("const permissionCatalog");
    expect(catalogStart).toBeGreaterThan(-1);
    // The catalog literal ends at the first `];` after its declaration.
    const catalogEnd = seedSource.indexOf("];", catalogStart);
    expect(catalogEnd).toBeGreaterThan(catalogStart);
    const catalog = seedSource.slice(catalogStart, catalogEnd);

    for (const key of ALL_KNOWN_KEYS) {
      expect(catalog).not.toContain(key);
    }
  });

  it("grants marketing_targets.view to the marketing role at scope=own", () => {
    expect(seedSource).toMatch(
      /grant\(\s*marketingRole\.id,\s*marketingTargetViewPermission!?\.id,\s*RolePermissionScope\.own\s*\)/,
    );
    // And the standalone seed script agrees, so a live DB set up with it lands identically.
    expect(seedTargetsSource).toMatch(
      /roleKey:\s*"marketing",\s*permissionKey:\s*"marketing_targets\.view",\s*scope:\s*RolePermissionScope\.own/,
    );
  });

  it("grants marketing_targets.manage to super_admin at scope=all", () => {
    expect(seedSource).toMatch(
      /grant\(\s*superAdminRole\.id,\s*marketingTargetManagePermission!?\.id,\s*RolePermissionScope\.all\s*\)/,
    );
    expect(seedTargetsSource).toMatch(
      /roleKey:\s*"super_admin",\s*permissionKey:\s*"marketing_targets\.manage",\s*scope:\s*RolePermissionScope\.all/,
    );
  });

  it("never grants `manage` to any role other than super_admin", () => {
    // Catches the specific accident this whole block exists to prevent: someone adding
    // `marketing_targets.manage` to a staff-role loop, which `grant()` (an upsert that
    // UPDATES scope) would apply silently.
    for (const source of [seedSource, seedTargetsSource]) {
      const lines = source.split("\n").filter((line) => line.includes("marketing_targets.manage"));
      for (const line of lines) {
        // Every mention must be a comment, the permission declaration, or a super_admin grant.
        const isComment = /^\s*(\/\/|\*)/.test(line);
        const isDeclaration = line.includes("label:") || line.includes("permissionKey:");
        const isSuperAdmin = line.includes("super_admin");
        expect(isComment || isDeclaration || isSuperAdmin).toBe(true);
      }
    }
  });

  it("never grants `view` to a role other than marketing", () => {
    for (const source of [seedSource, seedTargetsSource]) {
      const lines = source.split("\n").filter((line) => line.includes("marketing_targets.view"));
      for (const line of lines) {
        const isComment = /^\s*(\/\/|\*)/.test(line);
        const isDeclaration = line.includes("label:") || line.includes("permissionKey:");
        const isMarketing = line.includes("marketing");
        expect(isComment || isDeclaration || isMarketing).toBe(true);
      }
    }
  });

  it("puts the own-card route on a controller that takes no user id", () => {
    // The own-scope endpoint's safety rests entirely on the subject being implicit. A
    // `:userId` param on this route would turn scope=own into an IDOR surface.
    const source = readSource(CONTROLLER_FILE);
    // Anchored on the CLASS DECLARATION, not a bare name: the file-header comment documents
    // both controllers by name, so slicing to the first textual mention produced an EMPTY
    // string, which passed `not.toMatch` by vacuity. Same trap leave.permission-catalog.spec
    // calls out for `@Controller`.
    const adminClassAt = source.indexOf("export class MarketingTargetsAdminController");
    const meRouteAt = source.indexOf('@Get("me")');
    expect(meRouteAt).toBeGreaterThan(-1);
    expect(adminClassAt).toBeGreaterThan(meRouteAt);

    const meRoute = source.slice(meRouteAt, adminClassAt);
    expect(meRoute).toContain('@RequirePermission("marketing_targets.view")');
    expect(meRoute).not.toMatch(/@Param\(/);
  });
});
