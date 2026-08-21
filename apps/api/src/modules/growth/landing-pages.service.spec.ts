// apps/api/src/modules/growth/landing-pages.service.spec.ts
//
// Unit tests for LandingPagesService, closes Phase-9-completion gap #1 (CRM landing
// pages CRUD). Covers: scope gate (all|branch readable; own/assigned fail-closed),
// draft/publish gate (create with status=published downgraded to draft; publishedAt
// stamped once on first publish), and the public A/B variant resolver.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { LandingPagesService } from "./landing-pages.service";
import { LandingPagesRepository, type LandingPageRow } from "./landing-pages.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<LandingPagesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findPublishedBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<LandingPagesRepository>;
}

const ROW: LandingPageRow = {
  id: "lp-1",
  campaign: "diwali-2026",
  slug: "diwali-offer",
  title: "Diwali Offer",
  variant: "a",
  content: [],
  seoTitle: null,
  seoDescription: null,
  status: "draft",
  publishedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "landing_pages.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("LandingPagesService", () => {
  let service: LandingPagesService;
  let repo: Mocked<LandingPagesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new LandingPagesService(repo as unknown as LandingPagesRepository);
  });

  it("scope=all/branch succeed; own/assigned fail closed (403)", async () => {
    repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);

    await runWithScope("branch", () => service.list("tenant-1", { page: 1, pageSize: 20 }));

    await expect(
      runWithScope("assigned", () => service.list("tenant-1", { page: 1, pageSize: 20 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("create() with status='published' is downgraded to 'draft'", async () => {
    repo.create.mockResolvedValue({ id: "lp-new" });
    repo.findById.mockResolvedValue({ ...ROW, id: "lp-new" });

    await runWithScope("all", () =>
      service.create("tenant-1", {
        slug: "new-page",
        title: "New page",
        variant: "a",
        content: [],
        status: "published",
      }),
    );

    expect(repo.create).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ status: "draft", publishedAt: null }),
    );
  });

  it("update() to status='published' stamps publishedAt once, not on subsequent updates", async () => {
    repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, status: "published", publishedAt: new Date() });

    await runWithScope("all", () => service.update("tenant-1", "lp-1", { status: "published" }));
    expect(repo.update).toHaveBeenCalledWith("lp-1", expect.objectContaining({ status: "published", publishedAt: expect.any(Date) }));

    repo.update.mockClear();
    repo.findById
      .mockResolvedValueOnce({ ...ROW, status: "published", publishedAt: new Date("2026-01-02T00:00:00Z") })
      .mockResolvedValueOnce({ ...ROW, status: "published", publishedAt: new Date("2026-01-02T00:00:00Z") });

    await runWithScope("all", () => service.update("tenant-1", "lp-1", { status: "published" }));
    const patch = repo.update.mock.calls[0][1];
    expect(patch.publishedAt).toBeUndefined();
  });

  it("getPublicBySlug() 404s when no published rows exist", async () => {
    repo.findPublishedBySlug.mockResolvedValue([]);
    await expect(service.getPublicBySlug("missing-slug")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getPublicBySlug() with an explicit variant returns that variant only", async () => {
    const variantB: LandingPageRow = { ...ROW, id: "lp-2", variant: "b", status: "published" };
    repo.findPublishedBySlug.mockResolvedValue([{ ...ROW, status: "published" }, variantB]);

    const result = await service.getPublicBySlug("diwali-offer", "b");
    expect(result.variant).toBe("b");
  });

  it("getPublicBySlug() 404s for an unknown variant", async () => {
    repo.findPublishedBySlug.mockResolvedValue([{ ...ROW, status: "published" }]);
    await expect(service.getPublicBySlug("diwali-offer", "z")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("softDelete() 404s for an unknown id", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(runWithScope("all", () => service.softDelete("tenant-1", "missing"))).rejects.toBeInstanceOf(NotFoundException);
  });
});
