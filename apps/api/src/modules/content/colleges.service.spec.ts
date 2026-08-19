// apps/api/src/modules/content/colleges.service.spec.ts
//
// Unit tests for CollegesService (docs/plans/phase-11-locked-templates.md P3;
// crm/colleges.schemas.ts). Covers: scope=all-only, the "college_partner" category
// default/persistence on create, focus/established/city actually being wired into the
// Prisma call (P1 flagged these as exposed-but-unwired on the generic PartnersService),
// 404s on update/delete of an unknown id, logo-upload-url key namespacing, and CDN-URL
// minting on the logoKey -> logoUrl projection (mirrors blog.service.spec.ts's pattern).

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CollegesService } from "./colleges.service";
import { CollegesRepository, type CollegeRow, COLLEGE_PARTNER_CATEGORY } from "./colleges.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import { validateEnv } from "../../config/env";

/** The public asset base the code mints against (PUBLIC_ASSET_BASE_URL or the prod CDN). */
function assetUrl(key: string): string {
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? "https://cdn.stimuliiq.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<CollegesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<CollegesRepository>;
}

function mockStorageProvider() {
  return {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    putObject: jest.fn(),
    delete: jest.fn(),
    head: jest.fn(),
    getObject: jest.fn().mockResolvedValue({ body: Buffer.from("stub"), contentType: "application/pdf", size: 4 }),
  };
}

const ROW: CollegeRow = {
  id: "college-1",
  name: "ABC Institute of Technology",
  logoKey: "college_logos/tenant-1/abc.webp",
  url: "https://abc.example.edu",
  category: COLLEGE_PARTNER_CATEGORY,
  focus: "Engineering & Computer Science",
  established: 1998,
  city: "Hyderabad",
  status: "published",
  order: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "content.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("CollegesService", () => {
  let service: CollegesService;
  let repo: Mocked<CollegesRepository>;
  let storage: ReturnType<typeof mockStorageProvider>;

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorageProvider();
    service = new CollegesService(repo as unknown as CollegesRepository, storage as never);
  });

  it("scope=all succeeds; non-all scope fails closed (403)", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);

    await expect(runWithScope("own", () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("create()", () => {
    it("defaults category to college_partner (zod default) and persists focus/established/city", async () => {
      repo.create.mockResolvedValue({ id: "college-new" });
      repo.findById.mockResolvedValue({ ...ROW, id: "college-new" });

      await runWithScope("all", () =>
        service.create("tenant-1", {
          name: "ABC Institute of Technology",
          category: COLLEGE_PARTNER_CATEGORY,
          focus: "Engineering & Computer Science",
          established: 1998,
          city: "Hyderabad",
          status: "draft",
          order: 1,
        }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({
          name: "ABC Institute of Technology",
          category: COLLEGE_PARTNER_CATEGORY,
          focus: "Engineering & Computer Science",
          established: 1998,
          city: "Hyderabad",
        }),
      );
    });

    it("maps logoKey -> logoUrl via mintCdnUrl on the returned DTO (raw key never leaks)", async () => {
      repo.create.mockResolvedValue({ id: "college-1" });
      repo.findById.mockResolvedValue(ROW);

      const result = await runWithScope("all", () =>
        service.create("tenant-1", { name: ROW.name, logoKey: ROW.logoKey!, category: COLLEGE_PARTNER_CATEGORY, status: "draft", order: 1 }),
      );

      expect(result).not.toHaveProperty("logoKey");
      expect(result.logoUrl).toBe(assetUrl(ROW.logoKey!));
    });
  });

  describe("update()", () => {
    it("404s when the college does not exist", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.update("tenant-1", "missing", { name: "New Name" })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("persists a partial patch including focus/established/city", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, focus: "Data Science", established: 2001, city: "Bengaluru" });

      const result = await runWithScope("all", () =>
        service.update("tenant-1", ROW.id, { focus: "Data Science", established: 2001, city: "Bengaluru" }),
      );

      expect(repo.update).toHaveBeenCalledWith(ROW.id, { focus: "Data Science", established: 2001, city: "Bengaluru" });
      expect(result.focus).toBe("Data Science");
      expect(result.established).toBe(2001);
      expect(result.city).toBe("Bengaluru");
    });
  });

  describe("softDelete()", () => {
    it("404s when the college does not exist", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.softDelete("tenant-1", "missing"))).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("soft-deletes an existing college", async () => {
      repo.findById.mockResolvedValue(ROW);
      await runWithScope("all", () => service.softDelete("tenant-1", ROW.id));
      expect(repo.softDelete).toHaveBeenCalledWith(ROW.id);
    });
  });

  describe("getLogoUploadUrl()", () => {
    it("mints a college_logos-namespaced key and delegates to the StorageProvider", async () => {
      storage.getSignedUploadUrl.mockResolvedValue({
        url: "https://signed.example.com/put",
        storageKey: "college_logos/tenant-1/uuid-logo.webp",
        expiresAt: new Date("2026-01-01T00:15:00Z"),
        requiredHeaders: { "Content-Type": "image/webp" },
      });

      const result = await runWithScope("all", () =>
        service.getLogoUploadUrl("tenant-1", { fileName: "logo.webp", contentType: "image/webp", sizeBytes: 500_000 }),
      );

      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^college_logos\/tenant-1\//),
          contentType: "image/webp",
          maxBytes: 500_000,
          ttlSeconds: 900,
        }),
      );
      expect(result.storageKey).toBe("college_logos/tenant-1/uuid-logo.webp");
    });
  });
});
