// Typed public SiteSetting read SDK — Phase-10 page builder (docs/specs/phase-10-page-
// builder.md). Anonymous, cacheable (no per-user variance). Admin CRUD lives on
// `client.crm.siteSettings`. Exposed on the SDK as `client.public.siteSettings`.

import type { PublicSiteSettingsResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicSiteSettingsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/site-settings — all 8 sitewide values (nav/footer/SEO/contact/
   * stats) in one small, fixed-shape object. Anonymous — no cookies/CSRF required; safe
   * to cache (CDN or client-side) since the payload never varies per visitor.
   */
  async get(): Promise<PublicSiteSettingsResponse> {
    return this.client.request<PublicSiteSettingsResponse>("GET", "/api/v1/public/site-settings");
  }
}
