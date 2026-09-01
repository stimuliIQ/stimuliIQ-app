// apps/api/src/modules/org/org.permission-catalog.spec.ts
//
// Regression test for the "`@RequirePermission(\"x\")` whose key is granted to nobody" bug
// class (mirrors the leave/careers/marketing-targets catalog specs): such a route 403s for
// every caller, silently at runtime rather than loudly at build time.
//
// It also pins the NARROWING this whole phase rests on, which is quiet enough that a later
// tidy-up could undo it without anyone noticing:
//
//   `org.teams.manage` is upserted OUTSIDE `permissionCatalog` in prisma/seed.ts — the array
//   the admin+super_admin catch-all loop iterates. That physical placement IS the entire
//   implementation of "admin cannot rewrite the org chart". And it matters far more than it
//   looks: because the hierarchy is DATA and the leave-approval rule is uniform, whoever can
//   edit teams can make themselves somebody's approver. Editing the chart is therefore
//   authority equivalent to `leave.approve`, and is narrowed by the same device.
//
//   `org.teams.view` IS in the catalog, deliberately. Reading who your lead is is
//   information, not authority, and a key held outside the catalog would have to be
//   remembered for every role that ever needs a team picker.
//
// Static source-scanning only, no live-DB half: `DATABASE_URL` in this repo points at the
// PRODUCTION Supabase instance and a test suite must not reach for it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER_FILE = "./org.controller.ts";

const VIEW_KEY = "org.teams.view";
const MANAGE_KEY = "org.teams.manage";
const ALL_KNOWN_KEYS = [VIEW_KEY, MANAGE_KEY];

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const SEED_ORG_PATH = resolve(__dirname, "../../../../../prisma/seed-org.ts");

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

function requiredPermissionKeys(relativePath: string): string[] {
  const source = readSource(relativePath);
  return [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
}

describe("org hierarchy, permission catalog", () => {
  const controllerSource = readSource(CONTROLLER_FILE);
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const seedOrgSource = readFileSync(SEED_ORG_PATH, "utf8");

  it("guards every permissioned route with a key the seed actually grants", () => {
    const used = requiredPermissionKeys(CONTROLLER_FILE);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(ALL_KNOWN_KEYS).toContain(key);
    }
  });

  it("uses every key it declares — an ungranted key is a route nobody can reach", () => {
    const used = new Set(requiredPermissionKeys(CONTROLLER_FILE));
    for (const key of ALL_KNOWN_KEYS) {
      expect(used.has(key)).toBe(true);
    }
  });

  it("gates every mutating route on the manage key, never on the read key", () => {
    // Whoever can edit a team can decide who approves whose leave. A write that slipped onto
    // `org.teams.view` would hand that to every role holding the read.
    const mutatingBlocks = [...controllerSource.matchAll(/@(Post|Patch|Put|Delete)\([^)]*\)([\s\S]{0,400}?)async /g)];
    expect(mutatingBlocks.length).toBeGreaterThan(0);
    // Collected as a list of the offending verbs rather than asserted one at a time, so a
    // break names WHICH route slipped its guard instead of failing bare.
    const unguarded = mutatingBlocks
      .filter(([, , block]) => !block!.includes(`@RequirePermission("${MANAGE_KEY}")`))
      .map(([, verb]) => verb);
    expect(unguarded).toEqual([]);
  });

  it("leaves /me/position unpermissioned — it takes no user id, so there is nothing to gate", () => {
    // Structural own-scope, the same shape as /crm/marketing-targets/me: the subject is
    // always the session user, so there is no id to tamper with and no IDOR surface.
    const positionBlock = controllerSource.slice(controllerSource.indexOf('@Get("me/position")'));
    const untilNextDecorator = positionBlock.slice(0, positionBlock.indexOf("async"));
    expect(untilNextDecorator).not.toContain("@RequirePermission");
  });

  it("mounts the guards and the scope interceptor", () => {
    expect(controllerSource).toContain("@UseGuards(JwtAuthGuard, PermissionsGuard)");
    expect(controllerSource).toContain("@UseInterceptors(ScopeInterceptor)");
  });

  // ── The narrowing ────────────────────────────────────────────────────────────

  it("keeps org.teams.manage OUT of the seed catalog, so admin never inherits it", () => {
    // ORG_PERMISSIONS is the array folded into `permissionCatalog`, which the
    // admin+super_admin catch-all iterates. `manage` must not appear in it.
    const catalogBlock = seedSource.slice(
      seedSource.indexOf("const ORG_PERMISSIONS"),
      seedSource.indexOf("function buildOrgPermissionCatalog"),
    );
    expect(catalogBlock).toContain(VIEW_KEY);
    expect(catalogBlock).not.toContain(MANAGE_KEY);
  });

  it("grants org.teams.manage to super_admin and hr in seed.ts, and never to adminRole", () => {
    const block = seedSource.slice(
      seedSource.indexOf("const orgManagePermission"),
      seedSource.indexOf("// ── HR's grant set"),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/grant\(superAdminRole\.id, orgManagePermission\.id/);
    expect(block).toMatch(/grant\(hrRole\.id, orgManagePermission\.id/);
    // The load-bearing assertion. If somebody adds adminRole here, this fails.
    expect(block).not.toMatch(/adminRole/);
  });

  it("grants org.teams.manage to nobody but hr and super_admin in seed-org.ts", () => {
    const manageGrants = [...seedOrgSource.matchAll(
      /\{\s*roleKey:\s*"([a-z_]+)",\s*permissionKey:\s*"org\.teams\.manage"/g,
    )].map((m) => m[1]!);
    // Anti-vacuity: if the parser stops matching, the test must fail rather than pass empty.
    expect(manageGrants.length).toBeGreaterThan(0);
    expect(new Set(manageGrants)).toEqual(new Set(["hr", "super_admin"]));
  });

  it("seeds no teams and assigns nobody the hr role", () => {
    // A seeded team is not placeholder data — it is a live approval route for real people's
    // absence, and a wrong one fails silently in the direction nobody checks. Same call
    // seed-leave.ts makes on holidays and seed-careers.ts on job openings.
    expect(seedOrgSource).not.toMatch(/prisma\.team\.(create|upsert)/);
    expect(seedOrgSource).not.toMatch(/prisma\.userRole\.(create|upsert)/);
  });

  it("creates the hr role as a non-system role, so its matrix stays editable", () => {
    // `isSystem: true` would make roles.service.ts refuse to edit the matrix outright, and
    // HR's grant set is business policy that will change.
    expect(seedOrgSource).toMatch(/key: HR_ROLE\.key[\s\S]{0,80}isSystem: false/);
  });

  // ── The uniform grant, pinned across BOTH seeds ──────────────────────────────
  //
  // ADR-0070's "the permission is uniform; the org chart decides" only holds if every staff
  // role actually HOLDS `leave.approve`. Two separate files have to say so — prisma/seed.ts
  // for a fresh database, prisma/seed-org.ts for an existing one — and for a while only the
  // second did. The effect was invisible and total: on any environment seeded from scratch
  // (CI, a new deployment, this repo's own integration suite) appointing a team lead did
  // nothing at all, because the lead 403'd at the guard before the org chart was ever
  // consulted. Nothing failed; leave simply kept routing to the owner exactly as it had in
  // P13, which is precisely what a working two-step rollout looks like on day one.
  //
  // Read as source text rather than against a live database on purpose: `DATABASE_URL` in
  // this repo points at the PRODUCTION Supabase instance, and a unit test must not reach for
  // it. The integration counterpart is org-teams.integration-spec.ts.

  /** `branchManagerRole` -> `branch_manager`, so the two seeds' lists can be compared. */
  function roleVarToKey(varName: string): string {
    return varName
      .replace(/Role$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
  }

  /**
   * The role list + grants of seed.ts's "Leave grants (staff HR)" block, with comment lines
   * stripped. Stripping matters: this block is heavily annotated, and the annotations name
   * the very identifiers the exclusion assertions below search for ("this loop does not
   * include adminRole"). Matching raw text would fail on the comment explaining why the code
   * is correct, which trains the next person to delete the comment rather than read it.
   */
  function staffLeaveGrantBlock(): string {
    const start = seedSource.indexOf("── Leave grants (staff HR)");
    expect(start).toBeGreaterThan(-1);
    const block = seedSource.slice(start);
    const end = block.indexOf("\n  );");
    expect(end).toBeGreaterThan(-1);
    return block
      .slice(0, end)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  }

  it("grants leave.approve to every staff role in seed.ts, not just in seed-org.ts", () => {
    const block = staffLeaveGrantBlock();
    // `leaveAdminPermissions[0]` is `leave.approve` — reached by index because the key is
    // upserted outside the catalog and so is deliberately absent from `permId`'s map.
    expect(block).toMatch(/grant\(role\.id, leaveAdminPermissions\[0\]!\.id, RolePermissionScope\.own\)/);
  });

  it("grants it to exactly the roles seed-org.ts does, so the two seeds cannot drift", () => {
    const freshSeedRoles = [...staffLeaveGrantBlock().matchAll(/^\s{6}([a-zA-Z]+Role),$/gm)].map(
      (m) => roleVarToKey(m[1]!),
    );
    const orgSeedBlock = seedOrgSource.match(/const STAFF_APPROVER_ROLES = \[[\s\S]*?\]/);
    expect(orgSeedBlock).not.toBeNull();
    const liveSeedRoles = [...orgSeedBlock![0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);

    // Anti-vacuity: a parser that stops matching must fail, not pass on two empty sets.
    expect(freshSeedRoles.length).toBeGreaterThan(0);
    expect(new Set(freshSeedRoles)).toEqual(new Set(liveSeedRoles));
  });

  it("never grants it to admin, student or mentor through that loop", () => {
    // admin's exclusion is the invariant the whole narrowing rests on. `student` and `mentor`
    // are not staff on the payroll this runs for — a mentor is an external hire with no
    // annual allowance, so an approvals queue is meaningless to them.
    const block = staffLeaveGrantBlock();
    expect(block).not.toMatch(/adminRole/);
    expect(block).not.toMatch(/studentRole/);
    expect(block).not.toMatch(/mentorRole/);
  });

  it("narrows leave.calendar.view to own for staff in BOTH seeds", () => {
    // The other half of ADR-0069's calendar change, and the one that takes something away.
    // A database seeded before P17 holds scope=all here, which lets any member of staff read
    // every colleague's absences — and nothing on screen looks wrong, the calendar just shows
    // more people than it should. seed.ts covers a fresh database; seed-org.ts has to narrow
    // a live one, or the tightening only ever reaches new deployments.
    expect(staffLeaveGrantBlock()).toMatch(
      /grant\(role\.id, permId\("leave\.calendar\.view"\), RolePermissionScope\.own\)/,
    );
    expect(seedOrgSource).toMatch(/leave\.calendar\.view/);
    expect(seedOrgSource).toMatch(/scope: RolePermissionScope\.own/);
  });

  it("keeps the staff grant at scope=own, so nobody reads the whole company's leave", () => {
    // scope=all here would hand every counsellor every colleague's request WITH the reason
    // field — exactly what `leave.calendar.view` was split out to prevent. The widening a
    // lead needs comes from listSubordinateUserIds, not from the grant.
    const block = staffLeaveGrantBlock();
    const approveGrants = [...block.matchAll(/leaveAdminPermissions\[0\]!\.id, RolePermissionScope\.(\w+)/g)];
    expect(approveGrants.length).toBeGreaterThan(0);
    for (const [, scope] of approveGrants) expect(scope).toBe("own");
  });
});
