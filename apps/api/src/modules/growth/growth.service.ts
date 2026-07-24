// apps/api/src/modules/growth/growth.service.ts
//
// Business logic for per-city SEO data + bundles/tracks pricing (docs/plans/
// phase-9-completion.md T30). PUBLIC, read-only, unauthenticated — no scope context,
// no Prisma here (delegates to PublicRepository/PublicCatalogService, REUSING the
// existing forbidden-field-safe public program projection rather than a second one).

import { Injectable, NotFoundException } from "@nestjs/common";
import { PublicRepository } from "../public/public.repository";
import { PublicCatalogService } from "../public/public-catalog.service";
import type { CitySeoDetailResponse, CitySeoIndexResponse, ListBundlesResponse } from "./dto";

/** Lowercase, hyphenated slug for a city name — e.g. "Hyderabad" -> "hyderabad". */
export function citySlugify(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

@Injectable()
export class GrowthService {
  constructor(
    private readonly publicRepository: PublicRepository,
    private readonly publicCatalogService: PublicCatalogService,
  ) {}

  async listCities(): Promise<CitySeoIndexResponse> {
    const tenantId = await this.publicCatalogService.getPublicTenantId();
    const rows = await this.publicRepository.listCitiesWithPublicPrograms(tenantId);
    return {
      cities: rows.map((r) => ({ city: r.city, programCount: r.programCount, citySlug: citySlugify(r.city) })),
    };
  }

  async getCityDetail(citySlug: string): Promise<CitySeoDetailResponse> {
    const tenantId = await this.publicCatalogService.getPublicTenantId();
    const cities = await this.publicRepository.listCitiesWithPublicPrograms(tenantId);
    const match = cities.find((c) => citySlugify(c.city) === citySlug.toLowerCase());
    if (!match) {
      throw new NotFoundException({ code: "growth.city_not_found", title: "City not found" });
    }

    const programIds = await this.publicRepository.findPublicProgramIdsForCity(tenantId, match.city);
    const allSummaries = await this.publicCatalogService.listAllPublicProgramSummaries();
    const idSet = new Set(programIds);
    const programs = allSummaries.filter((p) => idSet.has(p.id));

    return {
      city: match.city,
      citySlug,
      seoTitle: `Best Internship Training Programs in ${match.city} | StimuliiQ`,
      seoDescription:
        `Explore ${programs.length} internship-training program${programs.length === 1 ? "" : "s"} ` +
        `available in ${match.city} — hands-on projects, live mentorship, and certification.`,
      programs,
    };
  }

  async listBundles(): Promise<ListBundlesResponse> {
    const allSummaries = await this.publicCatalogService.listAllPublicProgramSummaries();

    const byDomain = new Map<string, typeof allSummaries>();
    for (const program of allSummaries) {
      const group = byDomain.get(program.domain) ?? [];
      group.push(program);
      byDomain.set(program.domain, group);
    }

    const bundles = [...byDomain.entries()]
      .map(([domain, programs]) => {
        const prices = programs.map((p) => p.pricePaise);
        return {
          domain,
          programCount: programs.length,
          minPricePaise: Math.min(...prices),
          maxPricePaise: Math.max(...prices),
          programs,
        };
      })
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return { bundles };
  }
}
