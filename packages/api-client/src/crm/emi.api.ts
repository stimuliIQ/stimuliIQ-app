// Typed EMI plans + dunning SDK (Finance/Admin) — Phase 9 Completion, T11/T14/T24.
// Student's own-scope read-only view lives on `client.lms.emiPlans`.

import type {
  CreateEmiPlanRequest,
  ListEmiPlansQuery,
  EmiPlanSummary,
  EmiPlanDetail,
  MarkEmiInstallmentPaidRequest,
  TriggerEmiDunningRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class EmiPlansApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/emi-plans */
  async list(query: ListEmiPlansQuery) {
    return this.client.requestPaginated<EmiPlanSummary>("GET", `/api/v1/crm/emi-plans${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/emi-plans/:id */
  async get(id: string): Promise<EmiPlanDetail> {
    return this.client.request<EmiPlanDetail>("GET", `/api/v1/crm/emi-plans/${id}`);
  }

  /** POST /api/v1/crm/emi-plans — server computes the installment schedule. */
  async create(body: CreateEmiPlanRequest, idempotencyKey: string = crypto.randomUUID()): Promise<EmiPlanDetail> {
    return this.client.request<EmiPlanDetail>("POST", "/api/v1/crm/emi-plans", { body, idempotencyKey });
  }

  /** POST /api/v1/crm/emi-plans/:id/installments/:installmentId/mark-paid — idempotent. */
  async markInstallmentPaid(
    id: string,
    installmentId: string,
    body: MarkEmiInstallmentPaidRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<EmiPlanDetail> {
    return this.client.request<EmiPlanDetail>(
      "POST",
      `/api/v1/crm/emi-plans/${id}/installments/${installmentId}/mark-paid`,
      { body, idempotencyKey },
    );
  }

  /** POST /api/v1/crm/emi-plans/:id/installments/:installmentId/dunning — manual reminder trigger. */
  async triggerDunning(
    id: string,
    installmentId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<EmiPlanDetail> {
    const body: TriggerEmiDunningRequest = {};
    return this.client.request<EmiPlanDetail>(
      "POST",
      `/api/v1/crm/emi-plans/${id}/installments/${installmentId}/dunning`,
      { body, idempotencyKey },
    );
  }
}
