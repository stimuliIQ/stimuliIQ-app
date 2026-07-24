# ADR 0020: Invoice generation and webhook processing via SYNC-with-seam (BullMQ deferred behind ports)

## Status
Accepted

## Context
Two Phase-2 operations are natural candidates for async queue processing:

1. **Invoice generation**: generating a PDF, uploading it to S3/R2, and updating
   `invoices.storage_key` after a payment is captured. This is I/O-heavy and should
   not block the payment-capture HTTP response.
2. **Webhook processing**: Razorpay webhooks arrive at `POST /api/v1/commerce/webhook`
   and trigger state transitions (payment captured, refund processed). Razorpay expects
   a `200 OK` within a few seconds; if processing is slow, Razorpay retries — making
   idempotency (see ADR-0014) critical.

`CLAUDE.md §1` names **BullMQ** (backed by Redis) as the queue system. However, the
BullMQ worker infrastructure was not set up in Phase 0 or Phase 1, and wiring it fully
in Phase 2 would expand scope significantly.

## Decision
Both operations use a **SYNC-with-seam** pattern:

- `InvoiceGenPort` (DI token) and `WebhookProcessorPort` (DI token) define the
  interfaces.
- `SyncInvoiceGenAdapter` and `SyncWebhookProcessorAdapter` implement them by running
  the work **synchronously in the same request/transaction cycle** rather than
  enqueuing.
- The `AppModule` binds the `*Port` tokens to the `*Sync*` adapters for now.

The seam means that introducing real BullMQ workers later is a matter of:
1. Writing a `BullMqInvoiceGenAdapter` that enqueues a job instead of processing inline.
2. Writing the corresponding BullMQ processor (a NestJS `Processor`).
3. Swapping the DI binding in `AppModule` from `SyncInvoiceGenAdapter` to
   `BullMqInvoiceGenAdapter`.

No changes to `PaymentsService`, `OrdersService`, or the webhook handler are needed at
that point.

### Invoice PDF stub
The current `SyncInvoiceGenAdapter` creates the `invoices` DB row with `storage_key =
null` and sets `status = 'issued'`. Actual PDF generation and S3 upload are deferred
to Phase 4 (alongside certificate generation, which uses the same storage bucket). The
CRM invoice list displays invoices with a graceful "PDF pending" fallback when
`storage_key` is null.

## Consequences
- Phase-2 is shippable without a BullMQ worker infrastructure.
- Invoice PDFs are not available to students or finance staff until Phase 4. This is
  tracked in `docs/phase-2-followups.md`.
- Webhook processing is synchronous: if `SyncWebhookProcessorAdapter` is slow (e.g.
  because it triggers invoice generation which is also sync), Razorpay may retry the
  webhook. The idempotency guard on `provider_payment_id` (ADR-0014) ensures retries
  are safe.
- The SYNC adapter keeps the payment capture path fully within the HTTP request
  lifecycle, which actually simplifies error handling for P2: if invoice creation
  fails, it rolls back with the payment transaction.

## Alternatives considered
- **Wire BullMQ fully in Phase 2**: complete but high scope-expansion risk. Rejected
  for P2 — the sync adapter achieves the same data-correctness outcomes and is fully
  testable without a worker process.
- **Fire-and-forget (no interface, inline async call)**: no seam for later extraction.
  Rejected — violates the `CLAUDE.md §3.7` provider-interface rule and would require
  a rewrite rather than a binding swap when BullMQ is introduced.
- **Skip invoice generation entirely until Phase 4**: would leave `invoices` rows
  unwritten after payment, breaking the finance ledger. Rejected — the sync adapter
  writes the row immediately; only the PDF file is deferred.
