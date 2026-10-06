// Pins the one thing about System Health that must not quietly change: only the super admin can
// open it. The screen shows infrastructure topology, versions, which integrations are switched
// off and student headcounts, so `system.health.view` is upserted OUTSIDE `permissionCatalog` in
// prisma/seed.ts (the array the admin+super_admin catch-all iterates), the same device as
// `leave.approve` and `org.teams.manage`. Static source scanning only: DATABASE_URL in this repo
// can point at production, and a test suite must not reach for it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY = "system.health.view";
const read = (relative: string): string => readFileSync(resolve(__dirname, relative), "utf8");

describe("system health, permission placement", () => {
  const controller = read("./system-health.controller.ts");
  const seed = read("../../../../../prisma/seed.ts");
  const seedScript = read("../../../../../prisma/seed-system-health.ts");

  it("guards the only route with the system.health.view key", () => {
    const keys = [...controller.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(keys).toEqual([KEY]);
    expect(controller).toContain("@UseGuards(JwtAuthGuard, PermissionsGuard)");
  });

  it("is read-only: no mutating route exists", () => {
    expect(controller).not.toMatch(/@(Post|Put|Patch|Delete)\(/);
  });

  it("keeps the key out of the permission catalog, so admin never inherits it", () => {
    const catalogStart = seed.indexOf("const permissionCatalog");
    const upsertStart = seed.indexOf("const systemHealthPermission");
    expect(catalogStart).toBeGreaterThan(-1);
    expect(upsertStart).toBeGreaterThan(catalogStart);
    // The catalog array is declared before the dedicated block, so the key must not appear
    // anywhere between the two (that stretch contains the whole catalog definition).
    expect(seed.slice(catalogStart, upsertStart)).not.toContain(`"${KEY}"`);
  });

  it("grants it to super_admin in seed.ts and never to adminRole", () => {
    const start = seed.indexOf("const systemHealthPermission");
    const block = seed.slice(start, start + 600);
    expect(block).toMatch(/grant\(superAdminRole\.id, systemHealthPermission\.id/);
    expect(block).not.toMatch(/adminRole/);
  });

  it("seeds a live database with the key for super_admin alone", () => {
    expect(seedScript).toContain('key: "super_admin"');
    expect(seedScript).not.toMatch(/key: "(admin|hr|branch_manager)"/);
  });
});
