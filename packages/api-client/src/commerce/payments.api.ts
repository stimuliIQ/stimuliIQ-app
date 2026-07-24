// Typed payments SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// Covers: ledger list/detail, verify (Razorpay callback), manual payment,
// and the ledger reconciliation summary.
// NOTE: The webhook endpoint is NOT represented here — it is called by Razorpay
// servers directly (unauthenticated, raw-body HMAC-verified) and is not a
// client-facing SDK method.

import type {
  PaymentSummary,
  PaymentDetail,
  ListPaymentsQuery,
  VerifyPaymentRequest,
  ManualPaymentRequest,
  LedgerReconciliation,
  ReceiptDownloadResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class PaymentsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/commerce/payments — the authoritative payment ledger. */
  async list(query: ListPaymentsQuery) {
    return this.client.requestPaginated<PaymentSummary>(
      "GET",
      `/api/v1/commerce/payments${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/commerce/payments/:id */
  async get(id: string): Promise<PaymentDetail> {
    return this.client.request<PaymentDetail>("GET", `/api/v1/commerce/payments/${id}`);
  }

  /**
   * POST /api/v1/commerce/payments/verify
   *
   * Forwards the Razorpay checkout handler callback fields verbatim to the server.
   * The server verifies the HMAC-SHA256 signature, marks the payment captured,
   * the order paid, and creates the enrollment — all in one atomic transaction.
   *
   * Idempotent by `razorpay_payment_id` (unique) — replaying does NOT double-enroll.
   * `idempotencyKey` maps to the `Idempotency-Key` header (docs/04 §2.6).
   */
  async verify(
    body: VerifyPaymentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PaymentDetail> {
    return this.client.request<PaymentDetail>(
      "POST",
      "/api/v1/commerce/payments/verify",
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/commerce/payments/manual
   *
   * Records an offline/cash/NEFT payment by Finance staff. Finance / Admin only.
   * `idempotencyKey` prevents duplicate offline payment records on retry.
   */
  async recordManual(
    body: ManualPaymentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PaymentDetail> {
    return this.client.request<PaymentDetail>(
      "POST",
      "/api/v1/commerce/payments/manual",
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/commerce/payments/reconciliation?from=...&to=...
   *
   * Ledger reconciliation summary for a date range (docs/03 §20 invariant).
   * Finance + Admin/Owner only.
   */
  async reconciliation(params: { from: string; to: string }): Promise<LedgerReconciliation> {
    return this.client.request<LedgerReconciliation>(
      "GET",
      `/api/v1/commerce/payments/reconciliation${toQueryString(params)}`,
    );
  }

  /**
   * GET /api/v1/commerce/payments/:id/receipt (T27, Phase 9 Completion)
   *
   * Returns a pre-signed download URL for the payment's receipt PDF, generated
   * async via BullMQ (`@react-pdf/renderer` -> StorageProvider). `ready: false`
   * while the render job is still queued/running — poll until true. Owner
   * (paying student, own-scope) or Finance/Admin (all-scope).
   */
  async getReceiptUrl(paymentId: string): Promise<ReceiptDownloadResponse> {
    return this.client.request<ReceiptDownloadResponse>("GET", `/api/v1/commerce/payments/${paymentId}/receipt`);
  }
}
