# Phase-2 follow-ups (carried into P3+)

Recorded at Phase-2 closeout (Commerce + Leads, Waves 1–6 + remediation) so nothing
found during the security review, QA remediation, or left stubbed during the build gets
lost going into Phase 3. None of these blocked the Phase-2 GO decision; they are
tracked here for prioritization, not as open incidents.

Test counts at Phase-2 closeout (after Wave 7 security remediation): **235 unit tests** ·
**129 integration tests** (1 skipped) · 0 e2e (no-op stub). CI runs
`install → typecheck → lint → unit → integration → build → e2e`.

---

## Security follow-ups (Wave 7 review)

The Wave 7 security review returned **Conditional GO** with **no Critical findings**. The three
earlier fixes (webhook de-shadow, provider lazy-validation, reconcile double-count) were confirmed
secure. The following **must-fix** items were remediated before P2 sign-off:

| ID | Title | Status |
|----|-------|--------|
| H-1 | Public-intake rate-limiter failed **open** on Redis error + no `trust proxy` (IP bucketing broken/spoofable) | **Fixed** — limiter fails closed (Redis error → rate-limited); `main.ts` sets `trust proxy` = 1 (hop count must match deploy topology). Tenant-wide ceiling left as a TODO. |
| H-2 | `handleRefundProcessed` matched *any* approved refund (`\|\| status==="approved"`) → could process the wrong refund / corrupt the ledger | **Fixed** — strict `providerRefundId` match; unmatched → no-op; partial vs full refund handled; handler wrapped in one transaction. |
| M-1 | `approveRefund` writes not transactional + broken idempotent no-op | **Fixed** — early-return when already `processed`; the three writes wrapped in a transaction (provider call stays outside, idempotent via `idempotencyKey=refundId`). |
| M-2 | Refund **self-approval** possible (a Finance user could request + approve their own refund) | **Fixed** — rejects `requestedById === actorId` with 403 `commerce.refund_self_approval` (maker-checker). Refund integration tests split to distinct requester/approver. |
| M-6 | Manual-payment `reference` (cheque/NEFT no.) validated-required but silently dropped (audit gap) | **Fixed** — forward migration `20260702000000_payment_reference` adds `payments.reference`/`payments.notes`; persisted + surfaced on `PaymentDetail`. |

**Acceptable-with-tracked-follow-up (NOT blocking; carry into a later hardening pass):**

- **M-3** — `getOrderById` branch-scope check for a `BranchManager` is a best-effort `pageSize:1` list re-query (can false-404 a non-newest in-scope order). Push `restrictToBranchIds` into `findOrderById`'s where-clause. Low impact today (Finance/Owner/Admin = `all`).
- **M-4** — Public `utm`/`name`/`source` are stored unsanitized and later rendered in the CRM. Safe while React auto-escapes (no `dangerouslySetInnerHTML`); must encode in any CSV/PDF export path (P4). Frontend to confirm no raw-HTML sink.
- **M-5** — `assignOwner`/`create` don't validate the target `ownerId` is an in-tenant user; an out-of-scope UUID could orphan a lead. Add target-owner tenant-membership validation; consider stripping client-supplied `ownerId` for non-Marketing/Admin roles.
- **L-1** — invoice advisory lock keyed on `hashtext(tenantId)` (int4) can collide across tenants → benign brief serialization; `invoices.number` UNIQUE is the correctness backstop. Optional: hash `(tenantId||year)`.
- **L-2** — coupon `used` is incremented before the order row is created and not decremented on order-create failure → a failed order can burn a coupon use. Decrement-on-failure or fold into the order-create transaction.
- **L-3** — CSRF `exclude()` paths omit the `api/v1` prefix; no security impact (CSRF only enforces when a session cookie is present, which webhook/public callers lack) but the intent-vs-reality mismatch deserves a comment/test.
- **L-4** — `verifyPayment` flips a payment to `failed` on bad signature; a forged signature against a known (non-secret) `razorpay_order_id` is a minor per-order nuisance DoS. Low impact.

**Confirmed correctly handled (evidence in the Wave 7 report):** HMAC payment + webhook signatures
(constant-time, fail-closed, raw-body), order/payment/webhook idempotency (no double-enroll/refund),
reconciliation exactness (integer paise, no double-count), server-derived amounts + `.strict()`
over-post protection, `keyId` public / secrets never logged or returned, server-side RBAC +
data-scope + IDOR→404 across commerce and leads, public-intake over-post stripping + server-resolved
tenant, audit coverage on all 8 P2 tables with `SECRET_FIELDS` redaction, soft-delete respected,
CORS allowlist + helmet.

---

## Phase-2 deferred / stubbed items

| Item | What's deferred | Tracking |
|------|-----------------|----------|
| BullMQ invoice-gen worker | `InvoiceGenPort` is bound to `SyncInvoiceGenAdapter` — invoice rows are written synchronously but no PDF is generated; `invoices.storage_key` is `null` until the real worker lands. Wire a `BullMqInvoiceGenAdapter` + worker in P4 alongside certificate generation. | ADR-0020 |
| BullMQ webhook-processor worker | `WebhookProcessorPort` is bound to `SyncWebhookProcessorAdapter` — webhook events are processed inline in the HTTP request cycle. High-volume webhook traffic will need the BullMQ adapter. Swap when worker infra is wired. | ADR-0020 |
| Invoice PDF / S3 storage | `invoices.storage_key` is always `null` in P2. CRM invoice list shows a graceful "PDF pending" stub. Real PDF generation + S3/R2 upload land in P4 with the certificate pipeline. | ADR-0020 |
| `RAZORPAY_WEBHOOK_SECRET` not yet set | The webhook endpoint is **fail-closed**: all incoming webhooks are rejected until `RAZORPAY_WEBHOOK_SECRET` is set in the environment. The operator must create a webhook in the Razorpay dashboard and copy the secret into `.env`. Until then, payment-captured webhooks do not trigger enrollment. | ADR-0013, `.env.example` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in TEST mode only | The Razorpay keys in `.env` are TEST mode keys (`rzp_test_*`). Switch to LIVE keys only after a full checkout flow has been validated end-to-end. | ADR-0013 |
| OpenAPI list-query-param registration gap | The 8 `List*QuerySchema` types (for orders, payments, invoices, refunds, coupons, leads, activities, bookings) are defined in `@repo/types` and used by backend validation and the SDK, but are not yet attached to their list routes in the OpenAPI registry. Cosmetic OpenAPI-completeness gap only — the client and backend validation are correct. Fix in a P3 cleanup pass. | Wave 2 api-designer report |
| `auth.openapi.json` naming artifact | `apps/api/openapi/auth.openapi.json` now contains the full auth + CRM + commerce API surface. Rename to `api.openapi.json` and update references in `openapi.module.ts`, `@repo/api-client` generation, and CI. Low risk — internal artifact. Carried from P1. | `docs/phase-1-followups.md` |
| DataTable row virtualization | `@repo/ui DataTable` uses server-side pagination only; a seam for `@tanstack/react-virtual` is documented in the component. Wire when list views need 500+ rows without pagination (likely P7 analytics). Carried from P1. | ADR-0012 |
| Skipped integration test — public-intake over-post body | One integration test in the `leads-intake-convert` spec is marked `.skip`: the strict-zod body-stripping test for the public intake endpoint. The behavior is correct but the test infrastructure for asserting stripped fields on a `@Public` route requires a minor test-harness fix. Re-enable in P3 cleanup. | Wave 6 qa-engineer report |
| Playwright e2e for commerce + leads flows | Critical-path journeys (create order → payment capture → enrollment, coupon validation, lead pipeline stage-move, public intake → conversion) are not covered by Playwright. Deferred from P1 (CRM CRUD journeys also still pending). Pick up as a dedicated QA sprint or at P3 closeout. | `docs/phase-1-followups.md` (carried forward) |
| Multi-tenant resolution (hardcoded `TENANT_SLUG`) | `TENANT_SLUG = "stimuliiq"` is hardcoded in `auth.service.ts` and relied upon by the public intake endpoint for tenant resolution. Carried from P0/P1. Multi-tenant subdomain/header resolution is required before a second tenant is onboarded. | `docs/phase-1-followups.md` (carried forward) |
| PII access logging (§17) | `docs/03-prd-crm.md §17` specifies read-audit of PII fields (name, phone, email, college). The audit extension logs mutations only. Leads and activities introduce new PII surfaces (phone, email on leads). Carried from P1 (S1-2). | `docs/phase-1-followups.md` S1-2 |
| Cross-tenant IDOR integration test | All integration tests run against a single tenant. The tenant-scope guards are implemented but not exercised by a two-tenant isolation test. Carried from P1 (S1-3). | `docs/phase-1-followups.md` S1-3 |

---

## Carried-forward P1 deferred items (still open)

The following items from `docs/phase-1-followups.md` remain open and are not resolved
by P2 work:

| Item | Original tracking | Status |
|------|-------------------|--------|
| courses `assigned` scope fail-closed | ADR-0009 | Still deferred — no `programs.created_by` column; resolve in P3 LMS authoring. |
| System roles' permission matrix editable by any `all`-scope admin (S1-1) | `docs/phase-1-followups.md` S1-1 | Still open. |
| ZodValidationPipe + `@Query()` coexistence assumption (S1-4) | `docs/phase-1-followups.md` S1-4 | Still a code-review checklist item. |
| Soft-delete-bypass lint rule | Wave 5 qa-engineer report | Still a code-review checklist item. |
| argon2id cost parameters not pinned | `docs/phase-0-followups.md` | Carried forward. |
| JWT `aud` claim absent (M-4) | `docs/phase-0-followups.md` | Carried forward. |
| Inactive-account enumeration (M-5) | `docs/phase-0-followups.md` | Carried forward. |
| IP-dimension rate limiting (M-6) | `docs/phase-0-followups.md` | Carried forward. |
| Preview deploys (`if: false` guards in CI) | `docs/phase-0-followups.md` | Carried forward — flip when hosting projects + secrets provisioned. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 2 are recorded as ADRs 0013–0020 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
