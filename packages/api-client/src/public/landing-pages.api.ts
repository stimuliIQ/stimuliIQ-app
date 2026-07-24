// Typed landing-page render SDK (public) — Phase 9 Completion, T12/T14/T33. Admin
// CRUD lives on `client.crm.landingPages`.

import type { GetPublicLandingPageQuery, PublicLandingPage } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class PublicLandingPagesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/landing-pages/:slug?variant=b — server resolves the A/B split when variant is omitted. */
  async get(slug: string, query?: Partial<GetPublicLandingPageQuery>): Promise<PublicLandingPage> {
    return this.client.request<PublicLandingPage>(
      "GET",
      `/api/v1/public/landing-pages/${encodeURIComponent(slug)}${toQueryString(query ?? {})}`,
    );
  }
}
