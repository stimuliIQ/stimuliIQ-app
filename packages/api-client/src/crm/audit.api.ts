// Typed audit-logs SDK — read-only over /api/v1/crm/audit-logs.
// docs/03 §7.16 / §20(b): who/what/when/before-after. Mutations across the
// other CRM modules write their own audit rows server-side; this only reads.

import type { ListAuditLogsQuery, AuditLogEntry } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class AuditApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/audit-logs — filter by entity/actor/action/date-range, paginated. */
  async list(query: ListAuditLogsQuery) {
    return this.client.requestPaginated<AuditLogEntry>(
      "GET",
      `/api/v1/crm/audit-logs${toQueryString(query)}`,
    );
  }
}
