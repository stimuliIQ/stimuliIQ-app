// apps/api/src/modules/careers/careers.permission-catalog.spec.ts
//
// Regression test for the P6 `forum.read`/`notification_prefs.edit` 403 bug class (mirrors
// content/mentors/live-classes/tickets `.permission-catalog.spec.ts`): every
// `@RequirePermission("x")` this module's CRM controllers declare MUST both
//   (a) exist in the seed permission catalog, and
//   (b) be granted to at least one role.
// A key with zero grants is a 403 for every non-admin caller, and it fails silently until
// somebody with the wrong role tries to use the screen.
//
// It also guards the thing that makes this module's permissions worth having at all:
// `careers.*` must NOT collapse back into `content.*`. An application carries a stranger's
// resume and phone number; whoever may edit the marketing site must not thereby be able to
// read it. The "no content.* key appears in this module" assertion below is what stops that
// boundary being quietly undone by a copy-paste from colleges.controller.ts next door.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CONTROLLER_FILE = "./careers.controller.ts";

/** The three keys this module declares. See careers.controller.ts's header for the split. */
const ALL_EXPECTED_KEYS = ["careers.view", "careers.review", "careers.openings.manage"] as const;

/**
 * Roles that must hold every key. `branch_manager` is asserted separately: it holds
 * view + review but deliberately NOT openings.manage.
 */
const FULL_ACCESS_ROLES = ["admin", "super_admin"] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");
const CAREERS_SEED_PATH = resolve(__dirname, "../../../../../prisma/seed-careers.ts");

function controllerSource(): string {
  return readFileSync(resolve(__dirname, CONTROLLER_FILE), "utf8");
}

function requiredPermissionKeys(): string[] {
  const matches = [...controllerSource().matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Careers module permission catalog (regression: P6 forum.read 403 bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const careersSeedSource = readFileSync(CAREERS_SEED_PATH, "utf8");

  it("every @RequirePermission key in this module is one of the three careers.* keys", () => {
    const referenced = new Set(requiredPermissionKeys());
    expect(referenced.size).toBeGreaterThan(0);
    for (const key of referenced) {
      expect(ALL_EXPECTED_KEYS).toContain(key);
    }
    // And every declared key is actually used, catches a controller drifting off a key
    // that the seed still grants, which reads as "someone has this access" but grants none.
    for (const key of ALL_EXPECTED_KEYS) {
      expect(referenced.has(key)).toBe(true);
    }
  });

  it("declares NO content.* key, candidate PII is not gated behind 'may edit the website'", () => {
    expect(controllerSource()).not.toMatch(/@RequirePermission\("content\./);
  });

  it("PublicCareersController declares NO @RequirePermission (anonymous, captcha-gated)", () => {
    const source = controllerSource();
    const publicSection = source.slice(
      source.indexOf("class PublicCareersController"),
      source.indexOf("class JobOpeningsController"),
    );
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
  });

  /**
   * Every write path on an application must sit behind `careers.review`, never merely
   * `careers.view`. Reading the queue and emailing a candidate are different privileges,
   * and this is the assertion that keeps them different as endpoints get added.
   */
  it("every application MUTATION requires careers.review, not careers.view", () => {
    const source = controllerSource();
    const section = source.slice(source.indexOf("class CareerApplicationsController"));
    // Pair each @Post/@Delete with the @RequirePermission that immediately precedes it.
    const decorators = [...section.matchAll(/@RequirePermission\("([^"]+)"\)\s*\n\s*async\s+\w+/g)];
    const mutationBlocks = [...section.matchAll(/@(Post|Delete|Patch)\([^)]*\)[\s\S]*?@RequirePermission\("([^"]+)"\)/g)];
    expect(mutationBlocks.length).toBeGreaterThan(0);
    for (const [, , key] of mutationBlocks) {
      expect(key).toBe("careers.review");
    }
    expect(decorators.length).toBeGreaterThan(0);
  });

  describe.each(ALL_EXPECTED_KEYS)('permission "%s"', (key) => {
    const literal = key.replace(/\./g, "\\.");

    it("is registered in the full seed catalog (prisma/seed.ts)", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    it("is registered in the standalone live-DB seed (prisma/seed-careers.ts)", () => {
      expect(careersSeedSource).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    /**
     * Every catalog key is granted to admin + super_admin by the catch-all loop that
     * iterates `permissionCatalog`, so "registered in the catalog" IS "has at least one
     * grant", this is what rules out the P6 zero-grants bug for all three keys.
     *
     * It deliberately does NOT demand a second, explicit grant reference. Two of these keys
     * have one (branch_manager, asserted below); `careers.openings.manage` intentionally has
     * none, because authoring public job adverts is meant to stop at admin.
     */
    it("reaches at least one role, it is inside the catalog the admin catch-all grants", () => {
      const catalogBlock = seedSource.match(/const CAREERS_PERMISSIONS[\s\S]*?\];/);
      expect(catalogBlock).not.toBeNull();
      expect(catalogBlock![0]).toMatch(new RegExp(`key:\\s*"${literal}"`));
      expect(seedSource).toContain("...buildCareersPermissionCatalog(),");
    });
  });

  it("careers.view and careers.review reach a NON-admin role (branch_manager) in both seeds", () => {
    for (const source of [seedSource, careersSeedSource]) {
      expect(source).toMatch(/branch_manager|branchManagerRole/);
    }
    // The standalone seed grants by role key, so the pairing is checkable directly.
    // Terminated on the closing "]," of the ROLE's array rather than a lazy "]", the inner
    // grant tuples each contain one, and a lazy match stops at the first of those.
    const branchBlock = careersSeedSource.match(/branch_manager:\s*\[([\s\S]*?)\n  \],/);
    expect(branchBlock).not.toBeNull();
    expect(branchBlock![1]).toContain('"careers.view"');
    expect(branchBlock![1]).toContain('"careers.review"');
    // ...and deliberately does NOT grant the openings key. See seed-careers.ts.
    expect(branchBlock![1]).not.toContain('"careers.openings.manage"');
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Careers module permission catalog, live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(ALL_EXPECTED_KEYS)('"%s" exists in `permissions` and has >= 1 grant', async (key) => {
    const permission = await prisma.permission.findUnique({ where: { key } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it.each(FULL_ACCESS_ROLES)("`%s` holds all three careers.* keys at scope=all", async (roleKey) => {
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
  });

  it("`branch_manager` holds careers.view + careers.review but NOT careers.openings.manage", async () => {
    const role = await prisma.role.findFirst({ where: { key: "branch_manager" } });
    expect(role).not.toBeNull();

    for (const key of ["careers.view", "careers.review"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.deletedAt).toBeNull();
      // scope=all, not branch: an anonymous application has no branch to be partitioned by.
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }

    const openingsPerm = await prisma.permission.findUnique({ where: { key: "careers.openings.manage" } });
    const openingsGrant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role!.id, permissionId: openingsPerm!.id } },
    });
    expect(openingsGrant === null || openingsGrant.deletedAt !== null).toBe(true);
  });

  /**
   * The boundary this module exists for. `content_editor` and `marketing` may rewrite the
   * public site; neither may read a candidate's resume.
   */
  it.each(["content_editor", "marketing"] as const)(
    "`%s` holds NO careers.* permission (site editors do not read CVs)",
    async (roleKey) => {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      for (const key of ALL_EXPECTED_KEYS) {
        const permission = await prisma.permission.findUnique({ where: { key } });
        if (!permission) continue;
        const grant = await prisma.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role!.id, permissionId: permission.id } },
        });
        expect(grant === null || grant.deletedAt !== null).toBe(true);
      }
    },
  );
});
