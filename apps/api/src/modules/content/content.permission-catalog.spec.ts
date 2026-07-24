// apps/api/src/modules/content/content.permission-catalog.spec.ts
//
// Regression test for the P6 forum.read/notification_prefs.edit 403 bug class (mirrors
// mentors/live-classes/tickets .permission-catalog.spec.ts exactly): every
// `@RequirePermission("x")` declared by this module's CRM controllers MUST both
// (a) exist in the seed permission catalog and (b) be granted to at least one role.
// Public controllers must declare NO @RequirePermission at all.
//
// Phase-10 page builder (docs/specs/phase-10-page-builder.md) adds THREE keys —
// `content.builder`, `site_settings.view`, `site_settings.edit` — that are deliberately
// narrower than every other key in this module: they are seeded in a DEDICATED block
// OUTSIDE the admin/super_admin catch-all loop (prisma/seed.ts "Phase-10 Page Builder
// permissions — super_admin ONLY" comment) and granted to `super_admin` alone — not even
// `admin`, and never `content_editor`/`marketing` despite those roles already holding
// `content.edit`/`content.publish`. These three are tracked in `PAGE_BUILDER_ONLY_KEYS`,
// separate from `ALL_EXPECTED_KEYS`, because the generic "non-admin role grant" /
// "admin+super_admin catch-all" assertions below do not apply to them — dedicated checks
// exist further down instead.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const CRM_CONTROLLER_FILES = [
  "./blog.controller.ts",
  "./testimonials.controller.ts",
  "./partners.controller.ts",
  // Colleges (Phase-11 locked templates) deliberately reuses the SAME content.* keys as
  // partners.controller.ts (crm/colleges.schemas.ts "PERMISSIONS" comment) — no new keys.
  "./colleges.controller.ts",
  "./faculty-bios.controller.ts",
  "./content-pages.controller.ts",
  "./content-intake.controller.ts",
  "./content-pages-builder.controller.ts",
  "./site-settings.controller.ts",
] as const;

const ALL_EXPECTED_KEYS = ["content.view", "content.create", "content.edit", "content.delete", "content.publish"] as const;

/** Phase-10 page builder — super_admin-ONLY (see file header). */
const PAGE_BUILDER_ONLY_KEYS = ["content.builder", "site_settings.view", "site_settings.edit"] as const;

const ALL_KNOWN_KEYS = [...ALL_EXPECTED_KEYS, ...PAGE_BUILDER_ONLY_KEYS] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(controllerRelativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, controllerRelativePath), "utf8");
  const matches = [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)];
  return matches.map((m) => m[1]!);
}

describe("Content module CRM controllers permission catalog (regression: P6 forum.read/notification_prefs.edit bug class)", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");

  it("every @RequirePermission key referenced anywhere in this module is accounted for in ALL_KNOWN_KEYS", () => {
    const referenced = new Set(CRM_CONTROLLER_FILES.flatMap((f) => requiredPermissionKeys(f)));
    for (const key of referenced) {
      expect(ALL_KNOWN_KEYS).toContain(key);
    }
    // Every key IS used somewhere (sanity — catches a controller drifting away from a key).
    for (const key of ALL_KNOWN_KEYS) {
      expect(referenced.has(key)).toBe(true);
    }
  });

  it.each([
    ["blog.controller.ts", "class BlogController", "class PublicBlogController"],
    ["testimonials.controller.ts", "class TestimonialsController", "class PublicTestimonialsController"],
    ["partners.controller.ts", "class PartnersController", "class PublicPartnersController"],
    ["faculty-bios.controller.ts", "class FacultyBiosController", "class PublicFacultyBiosController"],
    ["content-pages.controller.ts", "class ContentPagesController", "class PublicContentPagesController"],
    ["site-settings.controller.ts", "class SiteSettingsController", "class PublicSiteSettingsController"],
  ])("%s's public controller declares NO @RequirePermission (anonymous, no guards)", (file, _crmClass, publicClass) => {
    const source = readFileSync(resolve(__dirname, `./${file}`), "utf8");
    const publicSection = source.slice(source.indexOf(publicClass));
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
  });

  it("PublicContentIntakeController declares NO @RequirePermission (anonymous, captcha-gated)", () => {
    const source = readFileSync(resolve(__dirname, "./content-intake.controller.ts"), "utf8");
    const publicSection = source.slice(source.indexOf("class PublicContentIntakeController"), source.indexOf("class ContentIntakeController"));
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
  });

  it("ContentPagesBuilderController's every route requires content.builder (no bare-JwtAuthGuard-only builder mutation exists)", () => {
    const source = readFileSync(resolve(__dirname, "./content-pages-builder.controller.ts"), "utf8");
    const keys = requiredPermissionKeys("./content-pages-builder.controller.ts");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toBe("content.builder");
    }
    // Sanity: every @Post/@Put/@Get handler in the file is preceded by a RequirePermission
    // (i.e. the file has no route that slips through with only JwtAuthGuard).
    const handlerCount = (source.match(/@(Post|Put|Get)\(/g) ?? []).length;
    expect(keys.length).toBe(handlerCount);
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

  describe.each(PAGE_BUILDER_ONLY_KEYS)('permission "%s" (Phase-10 page builder, super_admin-only)', (key) => {
    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });

    it("is granted via the dedicated PAGE_BUILDER_PERMISSIONS block (NOT the generic admin/super_admin catch-all loop)", () => {
      const arrayMatch = seedSource.match(/const PAGE_BUILDER_PERMISSIONS[\s\S]*?\];/);
      expect(arrayMatch).not.toBeNull();
      expect(arrayMatch![0]).toMatch(new RegExp(`key:\\s*"${key.replace(/\./g, "\\.")}"`));
    });
  });
});

// ─── DB-guarded deep check ──────────────────────────────────────────────────

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("Content module permission catalog — live seeded DB", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(ALL_KNOWN_KEYS)('"%s" exists in `permissions` and has >= 1 grant in `role_permissions`', async (key) => {
    const permission = await prisma.permission.findUnique({ where: { key } });
    expect(permission).not.toBeNull();
    const grantCount = await prisma.rolePermission.count({ where: { permissionId: permission!.id } });
    expect(grantCount).toBeGreaterThan(0);
  });

  it("the `content_editor` role holds every content.* key at scope=all", async () => {
    const role = await prisma.role.findFirst({ where: { key: "content_editor" } });
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

  it("the `marketing` role holds content.view + content.edit at scope=all", async () => {
    const role = await prisma.role.findFirst({ where: { key: "marketing" } });
    expect(role).not.toBeNull();
    for (const key of ["content.view", "content.edit"] as const) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      const grant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
      });
      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe(RolePermissionScope.all);
    }
  });

  it("admin/super_admin hold every content.* permission at scope=all (catch-all)", async () => {
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

  it("super_admin holds content.builder + site_settings.view/.edit at scope=all; admin does NOT (deliberate narrowing, docs/specs/phase-10-page-builder.md)", async () => {
    const superAdminRole = await prisma.role.findFirst({ where: { key: "super_admin" } });
    const adminRole = await prisma.role.findFirst({ where: { key: "admin" } });
    expect(superAdminRole).not.toBeNull();
    expect(adminRole).not.toBeNull();

    for (const key of PAGE_BUILDER_ONLY_KEYS) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      expect(permission).not.toBeNull();

      const superAdminGrant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: superAdminRole!.id, permissionId: permission!.id } },
      });
      expect(superAdminGrant).not.toBeNull();
      expect(superAdminGrant!.scope).toBe(RolePermissionScope.all);

      const adminGrant = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: adminRole!.id, permissionId: permission!.id } },
      });
      expect(adminGrant).toBeNull();
    }
  });

  it("content_editor and marketing do NOT hold content.builder/site_settings.* despite holding content.edit/content.publish (H1-class narrowing regression guard)", async () => {
    for (const roleKey of ["content_editor", "marketing"] as const) {
      const role = await prisma.role.findFirst({ where: { key: roleKey } });
      expect(role).not.toBeNull();
      for (const key of PAGE_BUILDER_ONLY_KEYS) {
        const permission = await prisma.permission.findUnique({ where: { key } });
        expect(permission).not.toBeNull();
        const grant = await prisma.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role!.id, permissionId: permission!.id } },
        });
        expect(grant).toBeNull();
      }
    }
  });
});
