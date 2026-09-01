// apps/api/src/modules/leave/leave.permission-catalog.spec.ts
//
// Regression test for the "`@RequirePermission("x")` whose key is granted to nobody" bug
// class (mirrors onboarding/content/mentors/tickets `.permission-catalog.spec.ts`): such a
// route 403s for every caller, and it does so silently at runtime rather than loudly at
// build time. This spec is what makes it fail here instead.
//
// It also pins the two deliberate SPLITS this feature depends on, and both are load-bearing:
//
//   1. `leave.approve` / `leave.manage` are seeded OUTSIDE the permission catalog, in the
//      dedicated super_admin-only block, so `admin` does not inherit them from the catch-all.
//      "Only the super admin approves leave" is a product decision; if a later tidy-up moves
//      these two keys into LEAVE_PERMISSIONS, every operational admin silently gains the
//      power to approve their own leave. The assertions below break first.
//
//   2. `leave.calendar.view` is a different key from `leave.view`. The calendar is
//      company-wide; `leave.view` at scope=all is not. Collapsing them would mean choosing
//      between "you cannot see when your colleagues are out" and "everyone can read
//      everyone's reason for being off".
//
// Static source-scanning only, no live-DB half: the sibling specs' `describeIfDb` block runs
// against whatever `DATABASE_URL` points at, and in this repo that is the PRODUCTION
// Supabase instance. The seed-source assertions below cover the same invariant without a test
// suite reaching for the production database.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER_FILE = "./leave.controller.ts";

/** Held by every staff role. In the catalog, so admin/super_admin inherit them too. */
const CATALOG_KEYS = ["leave.view", "leave.request", "leave.calendar.view"] as const;

/** super_admin ALONE. Seeded outside the catalog precisely so admin does not inherit them. */
const AUTHORITY_KEYS = ["leave.approve", "leave.manage"] as const;

const ALL_KNOWN_KEYS = [...CATALOG_KEYS, ...AUTHORITY_KEYS] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const SEED_LEAVE_PATH = resolve(__dirname, "../../../../../prisma/seed-leave.ts");

function requiredPermissionKeys(relativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, relativePath), "utf8");
  return [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
}

/**
 * Index of a class's `@Controller(...)` decorator, matched at the START of a line so the
 * file-header comment, which documents the very same routes, cannot be mistaken for the
 * code and produce empty sections that pass by vacuity.
 */
function controllerDecoratorIndex(source: string, path: string): number {
  const match = new RegExp(`^@Controller\\("${path.replace(/\//g, "\\/")}"\\)`, "m").exec(source);
  if (!match) throw new Error(`No @Controller("${path}") declaration found`);
  return match.index;
}

describe("Leave module permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const seedLeaveSource = readFileSync(SEED_LEAVE_PATH, "utf8");
  const controllerSource = readFileSync(resolve(__dirname, CONTROLLER_FILE), "utf8");

  it("every @RequirePermission key the module declares is a known key", () => {
    const referenced = new Set(requiredPermissionKeys(CONTROLLER_FILE));
    expect(referenced.size).toBeGreaterThan(0);
    for (const key of referenced) expect(ALL_KNOWN_KEYS).toContain(key);
    // ...and every known key is actually used, so a controller drifting off one is caught.
    for (const key of ALL_KNOWN_KEYS) expect(referenced.has(key)).toBe(true);
  });

  it("every route is permission-gated, none slips through on JwtAuthGuard alone", () => {
    const handlerCount = (controllerSource.match(/^\s+@(Get|Post|Patch|Put|Delete)\(/gm) ?? []).length;
    const keyCount = (controllerSource.match(/@RequirePermission\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(keyCount).toBe(handlerCount);
  });

  it("every controller carries the guard stack + ScopeInterceptor", () => {
    const controllers = controllerSource.match(/^@Controller\(/gm) ?? [];
    const guards = controllerSource.match(/@UseGuards\(JwtAuthGuard, PermissionsGuard\)/g) ?? [];
    const interceptors = controllerSource.match(/@UseInterceptors\(ScopeInterceptor\)/g) ?? [];
    expect(controllers).toHaveLength(3);
    expect(guards).toHaveLength(controllers.length);
    expect(interceptors).toHaveLength(controllers.length);
  });

  // The approval controller exists as its own class precisely so this assertion can be made.
  it("every approvals route requires leave.approve and nothing weaker", () => {
    const section = controllerSource.slice(
      controllerDecoratorIndex(controllerSource, "crm/leave/approvals"),
      controllerDecoratorIndex(controllerSource, "crm/leave/setup"),
    );
    const keys = [...section.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toBe("leave.approve");
  });

  // Reads are open to staff (the apply form needs the types, the calendar needs the
  // holidays); only the writes are narrowed. This asserts the writes half.
  it("every mutating setup route requires leave.manage", () => {
    const section = controllerSource.slice(controllerDecoratorIndex(controllerSource, "crm/leave/setup"));
    const mutatingKeys = [
      ...section.matchAll(/@(?:Post|Patch|Put|Delete)\([^)]*\)\s*@RequirePermission\("([^"]+)"\)/g),
    ].map((m) => m[1]!);
    expect(mutatingKeys.length).toBeGreaterThan(0);
    for (const key of mutatingKeys) expect(key).toBe("leave.manage");
  });

  it("the calendar route uses leave.calendar.view, not leave.view", () => {
    expect(controllerSource).toMatch(/@Get\("calendar"\)\s*@RequirePermission\("leave\.calendar\.view"\)/);
  });

  describe.each(CATALOG_KEYS)('staff permission "%s"', (key) => {
    const literal = key.replace(/\./g, "\\.");

    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    it("reaches the catalog through LEAVE_PERMISSIONS (so admin/super_admin inherit it)", () => {
      const block = seedSource.match(/const LEAVE_PERMISSIONS[\s\S]*?\];/);
      expect(block).not.toBeNull();
      expect(block![0]).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    it("has an explicit non-admin role grant, so it is not admin-only by accident", () => {
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      // Once in the catalog definition, at least once more in the staff-role grant block.
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe.each(AUTHORITY_KEYS)('authority permission "%s"', (key) => {
    const literal = key.replace(/\./g, "\\.");

    it("is seeded via the dedicated LEAVE_ADMIN_PERMISSIONS block", () => {
      const block = seedSource.match(/const LEAVE_ADMIN_PERMISSIONS[\s\S]*?\];/);
      expect(block).not.toBeNull();
      expect(block![0]).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    // The regression guard. If somebody moves these into the catalog "for consistency",
    // `admin` starts inheriting them from the catch-all loop and can approve its own leave.
    it("is NOT in LEAVE_PERMISSIONS, so admin cannot inherit it from the catch-all", () => {
      const block = seedSource.match(/const LEAVE_PERMISSIONS[\s\S]*?\];/);
      expect(block).not.toBeNull();
      expect(block![0]).not.toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    it("is granted to superAdminRole, and never to anyone the catch-all would reach", () => {
      // WIDENED when the org hierarchy landed (ADR-0069/0070): `hr` now holds both keys as
      // well, because HR is the company-wide fallback approver — whoever a request reaches
      // when the applicant is not on the org chart yet, or their team has no lead. HR is
      // granted in its own block further down, not in this one.
      //
      // What has NOT changed, and is the entire point of this assertion, is the exclusion of
      // `adminRole`. These keys stay OUT of the catalog so the admin+super_admin catch-all
      // cannot reach them. If somebody adds adminRole here, or moves the keys into the
      // catalog "for consistency", every operational admin silently gains authority over
      // everyone's leave.
      const block = seedSource.match(
        /const LEAVE_ADMIN_PERMISSIONS[\s\S]*?leaveAdminPermissions\.map\([\s\S]*?\);\s*\)?;?/,
      );
      expect(block).not.toBeNull();
      expect(block![0]).toMatch(/grant\(superAdminRole\.id/);
      expect(block![0]).not.toMatch(/adminRole/);
    });

    it("reaches hr through its own explicit block, never through the catalog", () => {
      // Asserted so that removing HR's approval authority — which is what stops a request
      // from a teamless person landing nowhere — is a deliberate act with a failing test
      // behind it, rather than a silent edit.
      // Anchored on the SECTION HEADER (the box-drawing rule), not on the phrase alone —
      // the same words appear in a comment several hundred lines earlier, and matching that
      // one made this assertion inspect the wrong block entirely.
      const hrBlock = seedSource.match(/── HR's grant set[\s\S]*?\n {2}\}/);
      expect(hrBlock).not.toBeNull();
      expect(hrBlock![0]).toMatch(/leaveAdminPermissions\[0\]/);
      expect(hrBlock![0]).toMatch(/leaveAdminPermissions\[1\]/);
      expect(hrBlock![0]).not.toMatch(/adminRole/);
    });
  });

  describe("prisma/seed-leave.ts (the live-database seed)", () => {
    /**
     * One role's grant list out of ROLE_GRANTS. The closing bracket has to be anchored to
     * its own two-space-indented line: the entries are themselves arrays, so a lazy
     * `[\s\S]*?\],` stops at the FIRST inner `],` and every assertion against the result
     * passes by only ever seeing the first grant.
     */
    function roleGrantBlock(roleKey: string): string {
      const match = new RegExp(`^ {2}${roleKey}:\\s*\\[[\\s\\S]*?\\n {2}\\],`, "m").exec(seedLeaveSource);
      if (!match) throw new Error(`No ROLE_GRANTS entry for "${roleKey}" in seed-leave.ts`);
      return match[0];
    }

    it("declares every key the controller uses", () => {
      for (const key of ALL_KNOWN_KEYS) {
        expect(seedLeaveSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
      }
    });

    // Same narrowing as the main seed, asserted separately: the two files are edited at
    // different times and drifting apart is exactly how a live database ends up with a
    // grant surface the tests never see.
    it("does not grant the authority keys to admin", () => {
      const block = roleGrantBlock("admin");
      // Guard against the assertion passing because the block was mis-parsed down to nothing.
      expect(block).toContain("leave.view");
      for (const key of AUTHORITY_KEYS) expect(block).not.toContain(key);
    });

    it("grants the authority keys to super_admin", () => {
      const block = roleGrantBlock("super_admin");
      for (const key of AUTHORITY_KEYS) expect(block).toContain(key);
    });

    it.each(["branch_manager", "counsellor", "faculty", "finance", "marketing", "support", "content_editor"])(
      "gives %s all three read/apply keys at OWN scope, calendar included",
      (roleKey) => {
        const block = roleGrantBlock(roleKey);
        expect(block).toMatch(/\["leave\.view", RolePermissionScope\.own\]/);
        expect(block).toMatch(/\["leave\.request", RolePermissionScope\.own\]/);
        // CHANGED 2026-09-01. The calendar was `all` for every staff role, on the reasoning
        // that its projection carries no `reason`, so company-wide visibility was harmless.
        // That answered "can you read WHY somebody is off" but never "whose absences can you
        // see at all" — and the answer to the second was everybody's.
        //
        // At `own` the service resolves visibility from the org chart: a rank-and-file member
        // sees strictly their own leave, a team lead or manager sees the people they approve
        // for. If this ever returns to `all`, every member can read the whole company's
        // absence pattern again — which is exactly what this line exists to prevent.
        expect(block).toMatch(/\["leave\.calendar\.view", RolePermissionScope\.own\]/);
        for (const key of AUTHORITY_KEYS) expect(block).not.toContain(key);
      },
    );

    it.each(["super_admin", "admin"])("keeps the company-wide calendar for %s", (roleKey) => {
      // The counterpart to the assertion above. Somebody has to see the whole picture, or the
      // calendar stops answering "who is out this week" for the business at all.
      const block = roleGrantBlock(roleKey);
      expect(block).toMatch(/\["leave\.calendar\.view", RolePermissionScope\.all\]/);
    });

    it("grants nothing to student or mentor", () => {
      expect(seedLeaveSource).not.toMatch(/^ {2}student:/m);
      expect(seedLeaveSource).not.toMatch(/^ {2}mentor:/m);
    });
  });
});
