// apps/api/src/modules/growth/growth.service.spec.ts
//
// Unit tests for GrowthService, per-city SEO data + bundles/tracks pricing.

import { NotFoundException } from "@nestjs/common";
import { GrowthService, citySlugify } from "./growth.service";
import type { PublicRepository } from "../public/public.repository";
import type { PublicCatalogService } from "../public/public-catalog.service";
import type { PublicProgramSummary } from "@repo/types";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function makeProgram(overrides: Partial<PublicProgramSummary> = {}): PublicProgramSummary {
  return {
    id: "prog-1",
    slug: "full-stack-dev",
    title: "Full Stack Development",
    domain: "Web Development",
    level: "beginner",
    mode: "recorded",
    durationWeeks: 12,
    cardSummary: "Learn full stack dev",
    compareAtPricePaise: null,
    pricePaise: 500000,
    emiDisplay: null,
    ratingAvg: 45,
    ratingCount: 10,
    ogImageUrl: null,
    scholarshipAvailable: false,
    enrollmentEnabled: true,
    enrollmentPaymentUrl: null,
    badgeColor: null,
    badgeLabel: null,
    ...overrides,
  };
}

describe("citySlugify", () => {
  it("lowercases and hyphenates", () => {
    expect(citySlugify("Hyderabad")).toBe("hyderabad");
    expect(citySlugify("New Delhi")).toBe("new-delhi");
  });
});

describe("GrowthService", () => {
  let publicRepository: Mocked<PublicRepository>;
  let publicCatalogService: Mocked<PublicCatalogService>;
  let service: GrowthService;

  beforeEach(() => {
    publicRepository = {
      listCitiesWithPublicPrograms: jest.fn(),
      findPublicProgramIdsForCity: jest.fn(),
    } as unknown as Mocked<PublicRepository>;
    publicCatalogService = {
      getPublicTenantId: jest.fn().mockResolvedValue("tenant-1"),
      listAllPublicProgramSummaries: jest.fn(),
    } as unknown as Mocked<PublicCatalogService>;
    service = new GrowthService(
      publicRepository as unknown as PublicRepository,
      publicCatalogService as unknown as PublicCatalogService,
    );
  });

  describe("listCities", () => {
    it("maps rows to a citySlug-bearing response", async () => {
      publicRepository.listCitiesWithPublicPrograms.mockResolvedValue([
        { city: "Hyderabad", programCount: 3 },
        { city: "Bengaluru", programCount: 5 },
      ]);

      const result = await service.listCities();

      expect(result.cities).toEqual([
        { city: "Hyderabad", programCount: 3, citySlug: "hyderabad" },
        { city: "Bengaluru", programCount: 5, citySlug: "bengaluru" },
      ]);
    });
  });

  describe("getCityDetail", () => {
    it("404s for an unknown city slug", async () => {
      publicRepository.listCitiesWithPublicPrograms.mockResolvedValue([{ city: "Hyderabad", programCount: 1 }]);

      await expect(service.getCityDetail("mumbai")).rejects.toThrow(NotFoundException);
    });

    it("filters public program summaries down to the ones offered in that city", async () => {
      publicRepository.listCitiesWithPublicPrograms.mockResolvedValue([{ city: "Hyderabad", programCount: 1 }]);
      publicRepository.findPublicProgramIdsForCity.mockResolvedValue(["prog-1"]);
      publicCatalogService.listAllPublicProgramSummaries.mockResolvedValue([
        makeProgram({ id: "prog-1" }),
        makeProgram({ id: "prog-2", slug: "data-science" }),
      ]);

      const result = await service.getCityDetail("hyderabad");

      expect(result.city).toBe("Hyderabad");
      expect(result.programs).toHaveLength(1);
      expect(result.programs[0]?.id).toBe("prog-1");
      expect(result.seoTitle).toContain("Hyderabad");
    });
  });

  describe("listBundles", () => {
    it("groups public programs by domain with a price range", async () => {
      publicCatalogService.listAllPublicProgramSummaries.mockResolvedValue([
        makeProgram({ id: "p1", domain: "Web Development", pricePaise: 300000 }),
        makeProgram({ id: "p2", domain: "Web Development", pricePaise: 600000 }),
        makeProgram({ id: "p3", domain: "Data Science", pricePaise: 800000 }),
      ]);

      const result = await service.listBundles();

      expect(result.bundles).toHaveLength(2);
      const web = result.bundles.find((b) => b.domain === "Web Development");
      expect(web).toMatchObject({ programCount: 2, minPricePaise: 300000, maxPricePaise: 600000 });
    });

    it("returns an empty bundle list when there are no public programs", async () => {
      publicCatalogService.listAllPublicProgramSummaries.mockResolvedValue([]);

      const result = await service.listBundles();

      expect(result.bundles).toEqual([]);
    });
  });
});
