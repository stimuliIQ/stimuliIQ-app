// Typed invoices SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// GET list / GET detail / GET download signed-url stub.
// Invoices are server-generated (BullMQ queue on payment capture) — no POST/PATCH here.

import type {
  InvoiceSummary,
  InvoiceDetail,
  ListInvoicesQuery,
  InvoiceDownloadResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class InvoicesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/commerce/invoices — filter/paginate invoice list. */
  async list(query: ListInvoicesQuery) {
    return this.client.requestPaginated<InvoiceSummary>(
      "GET",
      `/api/v1/commerce/invoices${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/commerce/invoices/:id */
  async get(id: string): Promise<InvoiceDetail> {
    return this.client.request<InvoiceDetail>("GET", `/api/v1/commerce/invoices/${id}`);
  }

  /**
   * GET /api/v1/commerce/invoices/:id/download
   *
   * Returns a pre-signed download URL for the invoice PDF. In P2 with a stub
   * StorageProvider, `stubMode: true` is returned and `url` is null — the
   * frontend should show an appropriate message.
   */
  async getDownloadUrl(id: string): Promise<InvoiceDownloadResponse> {
    return this.client.request<InvoiceDownloadResponse>(
      "GET",
      `/api/v1/commerce/invoices/${id}/download`,
    );
  }
}
