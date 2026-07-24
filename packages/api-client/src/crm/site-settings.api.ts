// Typed SiteSetting admin SDK (CRM/staff surface, super_admin-only) — Phase-10 page
// builder (docs/specs/phase-10-page-builder.md). Nav/footer/SEO/contact/stats sitewide
// primitives. Public read counterpart lives on `client.public.siteSettings`.
// Exposed on the SDK as `client.crm.siteSettings` (top-level, NOT nested under
// `client.crm.content.*` — a distinct permission domain, `site_settings.view`/`.edit`,
// deliberately narrower than `content.*`; see prisma SiteSetting model comment).

import type {
  ListSiteSettingsQuery,
  SiteSetting,
  SiteSettingKey,
  UpsertSiteSettingRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class SiteSettingsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/site-settings — small non-paginated list (exactly the 8 seeded keys). */
  async list(query?: ListSiteSettingsQuery): Promise<SiteSetting[]> {
    return this.client.request<SiteSetting[]>("GET", `/api/v1/crm/site-settings${toQueryString(query ?? {})}`);
  }

  /** GET /api/v1/crm/site-settings/:key */
  async get(key: SiteSettingKey): Promise<SiteSetting> {
    return this.client.request<SiteSetting>("GET", `/api/v1/crm/site-settings/${encodeURIComponent(key)}`);
  }

  /**
   * PUT /api/v1/crm/site-settings/:key — upsert. The server validates `body.value` against
   * that key's closed shape (`SiteSettingValueSchemaByKey[key]`, @repo/types); a shape
   * mismatch is a 400 with field-level errors, same as any other zod-validated body.
   */
  async upsert(key: SiteSettingKey, body: UpsertSiteSettingRequest, idempotencyKey: string = crypto.randomUUID()): Promise<SiteSetting> {
    return this.client.request<SiteSetting>("PUT", `/api/v1/crm/site-settings/${encodeURIComponent(key)}`, { body, idempotencyKey });
  }
}
