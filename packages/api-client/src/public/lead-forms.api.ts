// Typed lead-form config read SDK (public) — Phase 9 Completion, T12/T14/T32. Admin
// CRUD lives on `client.crm.leadForms`. The web app fetches the field config here,
// then submits captured data via `client.public.leads.capture()` with `source` set
// to the form's `key`.

import type { PublicLeadForm } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicLeadFormsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/lead-forms/:key — 404 if inactive/not found. */
  async getByKey(key: string): Promise<PublicLeadForm> {
    return this.client.request<PublicLeadForm>("GET", `/api/v1/public/lead-forms/${encodeURIComponent(key)}`);
  }
}
