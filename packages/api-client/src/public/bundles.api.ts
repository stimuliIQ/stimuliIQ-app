// Typed PUBLIC bundles/tracks-pricing SDK — Phase 9 Completion T30 follow-up
// (promoted from a backend-local schema; see @repo/types growth/public-seo.schemas.ts
// file header).
//
// Namespace: client.public.bundles.*
//
// PUBLIC, unauthenticated GET-only read. No credentials headers.

import type { ListBundlesResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicBundlesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/bundles — programs grouped by `domain` ("track"). */
  async list(): Promise<ListBundlesResponse> {
    return this.client.request<ListBundlesResponse>("GET", "/api/v1/public/bundles");
  }
}
