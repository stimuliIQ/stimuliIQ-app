// Typed System Health SDK (CRM). Exposed on the SDK as `client.crm.systemHealth.*`.
//
// GET /api/v1/crm/system-health is gated on `system.health.view`, which only the super admin
// holds. Callers hide the nav entry behind that permission; the API is the real enforcement
// (CLAUDE.md §3.5).

import type { SystemHealthReport } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class SystemHealthApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/system-health — live platform snapshot (server-cached for ~10 s). */
  async get(): Promise<SystemHealthReport> {
    return this.client.request<SystemHealthReport>("GET", "/api/v1/crm/system-health");
  }
}
