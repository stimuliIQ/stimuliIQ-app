// apps/api/src/modules/content/site-settings.service.spec.ts
//
// Unit tests for SiteSettingsService (docs/specs/phase-10-page-builder.md). Covers:
// scope=all only, 404 for any `:key` outside the 7 seeded literals (both read and
// write), runtime per-key value-shape validation (`SiteSettingValueSchemaByKey[key]`)
// on PUT, and the public-read missing/corrupted-row -> hardcoded-default fallback
// (never 500).
//
// P10-2 (real-user defect promoted from follow-up): `stats.headline` was REMOVED
// entirely — see site-settings.schemas.ts / site-settings.constants.ts header
// comments. `not.a.real.key` is used in place of the old "stats.headline" fixture for
// the "unknown key" 404 assertions below.

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { SiteSettingsService } from "./site-settings.service";
import { SiteSettingsRepository, type SiteSettingRow } from "./site-settings.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import { DEFAULT_PUBLIC_SITE_SETTINGS } from "./site-settings.constants";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<SiteSettingsRepository> {
  return {
    findAll: jest.fn(),
    findByKey: jest.fn(),
    upsert: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<SiteSettingsRepository>;
}

const NAV_ROW: SiteSettingRow = {
  id: "setting-1",
  key: "nav.primary_links",
  group: "nav",
  value: [{ label: "Courses", href: "/programs" }],
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "site_settings.edit", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("SiteSettingsService", () => {
  let service: SiteSettingsService;
  let repo: Mocked<SiteSettingsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new SiteSettingsService(repo as unknown as SiteSettingsRepository);
  });

  it("scope=all succeeds; non-all scope fails closed (403)", async () => {
    repo.findAll.mockResolvedValue([NAV_ROW]);
    const result = await runWithScope("all", () => service.list("tenant-1", {}));
    expect(result).toHaveLength(1);

    await expect(runWithScope("branch", () => service.list("tenant-1", {}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("getByKey()", () => {
    it("returns the mapped DTO for a known, existing key", async () => {
      repo.findByKey.mockResolvedValue(NAV_ROW);
      const result = await runWithScope("all", () => service.getByKey("tenant-1", "nav.primary_links"));
      expect(result.key).toBe("nav.primary_links");
      expect(result.value).toEqual(NAV_ROW.value);
    });

    it("404s for a key outside the 7 seeded literals", async () => {
      await expect(runWithScope("all", () => service.getByKey("tenant-1", "not.a.real.key"))).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findByKey).not.toHaveBeenCalled();
    });

    it("404s for the REMOVED stats.headline key (P10-2 — no longer a recognized key)", async () => {
      await expect(runWithScope("all", () => service.getByKey("tenant-1", "stats.headline"))).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findByKey).not.toHaveBeenCalled();
    });

    it("404s when the key is valid but the row does not exist yet", async () => {
      repo.findByKey.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.getByKey("tenant-1", "contact.details"))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("upsert() — runtime keyed value validation", () => {
    it("404s for a key outside the 7 seeded literals (this endpoint never creates a new key)", async () => {
      await expect(
        runWithScope("all", () => service.upsert("tenant-1", "not.a.real.key", { value: {} })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("404s for the REMOVED stats.headline key (P10-2) — cannot be re-created via PUT", async () => {
      await expect(
        runWithScope("all", () => service.upsert("tenant-1", "stats.headline", { value: [] })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("400s when `value` fails the key's closed SiteSettingValueSchemaByKey shape", async () => {
      // nav.primary_links expects an array of {label,href} — an object is invalid.
      await expect(
        runWithScope("all", () => service.upsert("tenant-1", "nav.primary_links", { value: { not: "an array" } })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("400s footer.copyright_text when the template is missing the required {year} placeholder", async () => {
      await expect(
        runWithScope("all", () => service.upsert("tenant-1", "footer.copyright_text", { value: { template: "© StimuliiQ" } })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts a valid value, derives `group` from the key's leading dotted segment, and upserts", async () => {
      const value = [{ label: "Home", href: "/" }];
      repo.upsert.mockResolvedValue({ ...NAV_ROW, value });
      const result = await runWithScope("all", () => service.upsert("tenant-1", "nav.primary_links", { value }));
      expect(repo.upsert).toHaveBeenCalledWith("tenant-1", "nav.primary_links", "nav", value);
      expect(result.value).toEqual(value);
    });

    it("derives group=contact for contact.whatsapp", async () => {
      repo.upsert.mockResolvedValue({ ...NAV_ROW, key: "contact.whatsapp", group: "contact" });
      await runWithScope("all", () => service.upsert("tenant-1", "contact.whatsapp", { value: { number: "919999999999", message: "hi" } }));
      expect(repo.upsert).toHaveBeenCalledWith("tenant-1", "contact.whatsapp", "contact", { number: "919999999999", message: "hi" });
    });
  });

  describe("getPublic() — anonymous read, missing/corrupted-row fallback (never 500)", () => {
    it("returns all 8 seeded values keyed by their SiteSettingKey (and NEVER stats.headline — P10-2)", async () => {
      repo.findAll.mockResolvedValue([NAV_ROW]);
      const result = await service.getPublic();
      expect(result["nav.primary_links"]).toEqual(NAV_ROW.value);
      // Keys never seeded in this test fixture fall back to the hardcoded default —
      // never throw/500.
      expect(result["contact.whatsapp"]).toEqual(DEFAULT_PUBLIC_SITE_SETTINGS["contact.whatsapp"]);
      // announcement.bar defaults to disabled — the web strip renders nothing.
      expect(result["announcement.bar"]).toEqual(DEFAULT_PUBLIC_SITE_SETTINGS["announcement.bar"]);
      expect((result["announcement.bar"] as { enabled: boolean }).enabled).toBe(false);
      expect(Object.keys(result)).toHaveLength(8);
      expect(result).not.toHaveProperty("stats.headline");
    });

    it("derives group=announcement for announcement.bar and validates its closed shape", async () => {
      const value = { enabled: true, message: "Admissions open — batch starts Aug 15.", mode: "scroll" };
      repo.upsert.mockResolvedValue({ ...NAV_ROW, key: "announcement.bar", group: "announcement", value });
      await runWithScope("all", () => service.upsert("tenant-1", "announcement.bar", { value }));
      expect(repo.upsert).toHaveBeenCalledWith("tenant-1", "announcement.bar", "announcement", value);
      // extra/unknown fields are rejected (strict shape)
      await expect(
        runWithScope("all", () => service.upsert("tenant-1", "announcement.bar", { value: { ...value, blink: true } })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("falls back to the hardcoded default for a key whose stored value fails re-validation (corrupted row)", async () => {
      repo.findAll.mockResolvedValue([{ ...NAV_ROW, value: { not: "a valid nav array" } }]);
      const result = await service.getPublic();
      expect(result["nav.primary_links"]).toEqual(DEFAULT_PUBLIC_SITE_SETTINGS["nav.primary_links"]);
    });

    it("returns every default when NO rows are seeded at all (fresh/broken DB)", async () => {
      repo.findAll.mockResolvedValue([]);
      const result = await service.getPublic();
      expect(result).toEqual(DEFAULT_PUBLIC_SITE_SETTINGS);
    });

    it("404s when the tenant cannot be resolved", async () => {
      repo.getTenantIdBySlug.mockResolvedValue(null);
      await expect(service.getPublic()).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
