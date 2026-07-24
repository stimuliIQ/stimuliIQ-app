// apps/api/src/modules/content/live-collection-resolver.service.spec.ts
//
// Unit tests for LiveCollectionResolverService (docs/specs/phase-10-page-builder.md
// block #10 `live_collection_ref`). Covers: `mode=manual` order-preservation + silent
// drop of missing/unpublished ids (Edge case #2), `mode=filter` published-only
// filtering, programs/mentors delegation to PublicCatalogService (reusing the SAME
// public projection, not a second implementation), resolution failures degrading to an
// EMPTY list rather than throwing (Edge cases #2/#3 — "never 500"), and Edge case #9
// (an unknown/legacy stored block `type` is silently skipped, never fails the batch).

import { LiveCollectionResolverService } from "./live-collection-resolver.service";
import { TestimonialsRepository, type TestimonialRow } from "./testimonials.repository";
import { PartnersRepository, type PartnerRow } from "./partners.repository";
import { PublicCatalogService } from "../public/public-catalog.service";
import type { PageBuilderBlock } from "@repo/types";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockTestimonialsRepository(): Mocked<TestimonialsRepository> {
  return {
    findManyPublishedByIds: jest.fn(),
    listPublishedFiltered: jest.fn(),
  } as unknown as Mocked<TestimonialsRepository>;
}

function mockPartnersRepository(): Mocked<PartnersRepository> {
  return {
    listPublishedFiltered: jest.fn(),
  } as unknown as Mocked<PartnersRepository>;
}

function mockPublicCatalogService(): Mocked<PublicCatalogService> {
  return {
    listPrograms: jest.fn(),
    listMentors: jest.fn(),
  } as unknown as Mocked<PublicCatalogService>;
}

function testimonial(id: string, overrides: Partial<TestimonialRow> = {}): TestimonialRow {
  return {
    id,
    programId: null,
    studentName: `Student ${id}`,
    studentPhotoKey: null,
    quote: "Great program!",
    rating: 45,
    status: "published",
    order: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function partner(id: string, overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    id,
    name: `Partner ${id}`,
    logoKey: null,
    url: "https://example.com",
    category: "college_partner",
    status: "published",
    order: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    focus: "Engineering",
    established: 1990,
    city: "Mumbai",
    ...overrides,
  };
}

describe("LiveCollectionResolverService", () => {
  let service: LiveCollectionResolverService;
  let testimonialsRepo: Mocked<TestimonialsRepository>;
  let partnersRepo: Mocked<PartnersRepository>;
  let publicCatalog: Mocked<PublicCatalogService>;

  beforeEach(() => {
    testimonialsRepo = mockTestimonialsRepository();
    partnersRepo = mockPartnersRepository();
    publicCatalog = mockPublicCatalogService();
    service = new LiveCollectionResolverService(
      testimonialsRepo as unknown as TestimonialsRepository,
      partnersRepo as unknown as PartnersRepository,
      publicCatalog as unknown as PublicCatalogService,
    );
  });

  describe("non-reference blocks", () => {
    it("passes every non-live_collection_ref block through unchanged", async () => {
      const blocks: PageBuilderBlock[] = [{ type: "brain_showcase", data: {} }];
      const result = await service.resolveKnownBlocks("tenant-1", blocks);
      expect(result).toEqual(blocks);
    });
  });

  describe("collection=testimonials", () => {
    it("mode=manual preserves the AUTHOR'S selected id order and silently drops missing/unpublished ids (Edge case #2)", async () => {
      testimonialsRepo.findManyPublishedByIds.mockResolvedValue([testimonial("id-2"), testimonial("id-1")]);
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "testimonials", layout: "grid-3", selection: { mode: "manual", ids: ["id-1", "id-missing", "id-2"], limit: 3, sort: "order" } },
      };

      const [resolved] = await service.resolveKnownBlocks("tenant-1", [block]);
      expect(resolved!.type).toBe("live_collection_ref");
      const items = (resolved as { data: { resolvedItems: Array<{ id: string }> } }).data.resolvedItems;
      expect(items.map((i) => i.id)).toEqual(["id-1", "id-2"]); // author order preserved; "id-missing" dropped, no error.
    });

    it("mode=manual with zero resolvable ids resolves to an empty list, never throws", async () => {
      testimonialsRepo.findManyPublishedByIds.mockResolvedValue([]);
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "testimonials", layout: "grid-3", selection: { mode: "manual", ids: ["id-gone"], limit: 3, sort: "order" } },
      };
      const [resolved] = await service.resolveKnownBlocks("tenant-1", [block]);
      expect((resolved as { data: { resolvedItems: unknown[] } }).data.resolvedItems).toEqual([]);
    });

    it("mode=filter delegates programId/minRating/limit/sort to the repository's published-only query", async () => {
      testimonialsRepo.listPublishedFiltered.mockResolvedValue([testimonial("id-1")]);
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "testimonials", layout: "grid-3", selection: { mode: "filter", programId: "prog-1", minRating: 40, limit: 3, sort: "newest" } },
      };
      await service.resolveKnownBlocks("tenant-1", [block]);
      expect(testimonialsRepo.listPublishedFiltered).toHaveBeenCalledWith("tenant-1", { programId: "prog-1", minRating: 40, limit: 3, sort: "newest" });
    });

    it("a repository error resolves to an empty list rather than throwing (never 500s the page)", async () => {
      testimonialsRepo.listPublishedFiltered.mockRejectedValue(new Error("db down"));
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "testimonials", layout: "grid-3", selection: { mode: "filter", limit: 3, sort: "order" } },
      };
      const [resolved] = await service.resolveKnownBlocks("tenant-1", [block]);
      expect((resolved as { data: { resolvedItems: unknown[] } }).data.resolvedItems).toEqual([]);
    });
  });

  describe("collection=partners", () => {
    it("resolves published partners INCLUDING the additive focus/established/city fields", async () => {
      partnersRepo.listPublishedFiltered.mockResolvedValue([partner("p-1")]);
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "partners", layout: "logo-wall", selection: { category: "college_partner", limit: 12, sort: "order" } },
      };
      const [resolved] = await service.resolveKnownBlocks("tenant-1", [block]);
      const items = (resolved as { data: { resolvedItems: Array<Record<string, unknown>> } }).data.resolvedItems;
      expect(items[0]).toMatchObject({ id: "p-1", focus: "Engineering", established: 1990, city: "Mumbai" });
      expect(partnersRepo.listPublishedFiltered).toHaveBeenCalledWith("tenant-1", { category: "college_partner", limit: 12, sort: "order" });
    });
  });

  describe("collection=programs / mentors — delegate to PublicCatalogService (no second projection)", () => {
    it("maps categorySlug to the public catalog's `domain` filter facet", async () => {
      publicCatalog.listPrograms.mockResolvedValue({ items: [], nextCursor: null });
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "programs", layout: "grid-4", selection: { categorySlug: "web-development", limit: 8, sort: "popularity" } },
      };
      await service.resolveKnownBlocks("tenant-1", [block]);
      expect(publicCatalog.listPrograms).toHaveBeenCalledWith({ domain: "web-development", sort: "popularity", limit: 8 });
    });

    it("resolves mentors via listMentors({limit})", async () => {
      publicCatalog.listMentors.mockResolvedValue({ items: [], nextCursor: null });
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "mentors", layout: "grid-4", selection: { limit: 8 } },
      };
      await service.resolveKnownBlocks("tenant-1", [block]);
      expect(publicCatalog.listMentors).toHaveBeenCalledWith({ limit: 8 });
    });

    it("a PublicCatalogService failure (e.g. tenant not found) resolves to an empty list, never throws", async () => {
      publicCatalog.listMentors.mockRejectedValue(new Error("tenant not found"));
      const block: PageBuilderBlock = {
        type: "live_collection_ref",
        data: { collection: "mentors", layout: "grid-4", selection: { limit: 8 } },
      };
      const [resolved] = await service.resolveKnownBlocks("tenant-1", [block]);
      expect((resolved as { data: { resolvedItems: unknown[] } }).data.resolvedItems).toEqual([]);
    });
  });

  describe("resolveRawBlocks — public read path (Edge case #9)", () => {
    it("silently skips an unknown/legacy block type instead of failing the whole page", async () => {
      const raw = [{ type: "some_removed_block_type", data: { foo: "bar" } }, { type: "brain_showcase", data: {} }];
      const result = await service.resolveRawBlocks("tenant-1", raw);
      expect(result).toEqual([{ type: "brain_showcase", data: {} }]);
    });

    it("returns an empty array for non-array input rather than throwing", async () => {
      const result = await service.resolveRawBlocks("tenant-1", null);
      expect(result).toEqual([]);
    });

    it("resolves a valid raw live_collection_ref block the same way resolveKnownBlocks does", async () => {
      testimonialsRepo.listPublishedFiltered.mockResolvedValue([testimonial("id-1")]);
      const raw = [
        { type: "live_collection_ref", data: { collection: "testimonials", layout: "grid-3", selection: { mode: "filter", limit: 3, sort: "order" } } },
      ];
      const result = await service.resolveRawBlocks("tenant-1", raw);
      expect(result).toHaveLength(1);
      expect((result[0] as { data: { resolvedItems: unknown[] } }).data.resolvedItems).toHaveLength(1);
    });
  });
});
