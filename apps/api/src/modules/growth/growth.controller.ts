// apps/api/src/modules/growth/growth.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/public/seo/* and /api/v1/public/bundles — PUBLIC, unauthenticated
// (mirrors PublicCatalogController's "separate controller class, NO guards" convention,
// ADR-0019). GET-only — no CSRF exclusion needed (CsrfMiddleware only guards unsafe
// methods; see common/middleware/csrf.middleware.ts).

import { Controller, Get, Param } from "@nestjs/common";
import { GrowthService } from "./growth.service";
import type { CitySeoDetailResponse, CitySeoIndexResponse, ListBundlesResponse } from "./dto";

@Controller("public")
export class GrowthController {
  constructor(private readonly service: GrowthService) {}

  @Get("seo/cities")
  async listCities(): Promise<CitySeoIndexResponse> {
    return this.service.listCities();
  }

  @Get("seo/cities/:citySlug")
  async getCityDetail(@Param("citySlug") citySlug: string): Promise<CitySeoDetailResponse> {
    return this.service.getCityDetail(citySlug);
  }

  @Get("bundles")
  async listBundles(): Promise<ListBundlesResponse> {
    return this.service.listBundles();
  }
}
