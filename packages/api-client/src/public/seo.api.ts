// Typed PUBLIC per-city SEO SDK — Phase 9 Completion T30 follow-up (promoted from a
// backend-local schema; see @repo/types growth/public-seo.schemas.ts file header).
//
// Namespace: client.public.seo.*
//
// PUBLIC, unauthenticated GET-only reads. No credentials headers.

import type { CitySeoIndexResponse, CitySeoDetailResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicSeoApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/seo/cities — per-city program-count index. */
  async listCities(): Promise<CitySeoIndexResponse> {
    return this.client.request<CitySeoIndexResponse>("GET", "/api/v1/public/seo/cities");
  }

  /** GET /api/v1/public/seo/cities/:citySlug — per-city SEO landing detail. */
  async getCityDetail(citySlug: string): Promise<CitySeoDetailResponse> {
    return this.client.request<CitySeoDetailResponse>(
      "GET",
      `/api/v1/public/seo/cities/${encodeURIComponent(citySlug)}`,
    );
  }
}
