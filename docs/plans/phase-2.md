# Plan: Phase 2 — Commerce + Leads ("P2")

> Scope boundary (`CLAUDE.md §6`): **"P2 Commerce + Leads: Razorpay flow, invoices, lead
> pipeline, enrollment."** This plan delivers exactly that, end-to-end
> (schema → contracts → providers → backend → CRM frontend → tests → security → docs) and
> **does not** plan ahead into P3 (LMS/video/progress/attendance), P4 (certificates/
> assessments), P5 (marketing website + public book-slot funnel), P6 (notifications /
> WhatsApp / email *sending* / campaigns / gamification), or P7 (analytics dashboards).
>
> Two deliberate gate edges:
> - **Lead/booking INTAKE** is delivered as **API + CRM-side management** with a **minimal
>   stub public entry** only. The heavy marketing-site book-slot funnel is **P5**.
> - **Activities** (`call|note|whatsapp|email|task`) are **logged as records, not sent.**
>   Actual WhatsApp/email/SMS *delivery* is **P6**. P2 wires no MailProvider/WhatsAppProvider.
> - **Revenue analytics dashboards** are **P7**. P2 builds the **ledger correctness +
>   reconciliation primitive** only (the `docs/03 §20` "revenue totals reconcile exactly with
>   the payments ledger" invariant), not the dashboard charts.
>
> Each task DoD references `CLAUDE.md §4` + the relevant `docs/03 §7.x` / `docs/04 §2.x` /
> `docs/05 §3` + acceptance criteria from `docs/03 §20`.

---

## Goal & success criteria

**Goal:** Turn the P1 CRM operations core into a **commerce + admissions engine**: staff can
take money (Razorpay), reconcile it, refund it (with approval), discount it (coupons),
invoice it, and **convert a paid order into a real batch enrollment**; and counsellors can
**work a lead pipeline** (kanban stages, owner assignment, activity timeline, follow-up
tasks + SLA, demo/slot bookings) and **convert a won lead into a student + order/enrollment**
— all tenant-scoped, RBAC-enforced server-side with data-scope, soft-deletable + restorable,
audited on every mutation, idempotent on every money mutation, money in integer paise.

This phase also **makes the counsellor `own`/`assigned` scope real** (deferred in P1): leads
carry an `owner_id`, so `leads`/`activities`/`bookings` scope `own|assigned` is now
meaningful and testable (closing the P1 gap where counsellors were scoped to `branch` as a
placeholder).

**Success criteria:**
1. **Commerce — orders/payments** (`docs/03 §7.6`, `docs/04 §2.6/§2.10/§2.14`, `docs/05 §3`
   Commerce): create an **order** for a program (amount in paise, optional coupon), **create a
   Razorpay order** via the `PaymentProvider`, **verify payment signature**, handle the
   **webhook** (idempotent + signature-verified), record **payments** in a ledger. Every order/
   payment mutation is **idempotent** (idempotency key, `docs/04 §2.6`). Manual/offline payment
   entry supported (`docs/03 §7.6`).
2. **Commerce — order→enrollment** (`docs/05 §2` `ORDER ||--o| ... ENROLLMENT`): a **paid**
   order for a program **atomically** creates/links an `enrollment` into a chosen batch
   (connects the P1 enrollments join — adds the commerce fields P1 deferred). Idempotent and
   transactional: no double-enroll, no enroll-without-paid-order.
3. **Commerce — refunds** (`docs/03 §7.6`): refund a payment through an **approval workflow**
   (request → approve/reject → process via provider), amount in paise, `approved_by` recorded,
   audited; finance-scoped authz.
4. **Commerce — invoices/receipts** (`docs/03 §7.6`): on payment success, **queue** invoice +
   receipt generation (BullMQ `invoice-gen`); invoice row with unique number + tax json +
   storage key. **PDF rendering may be a simple/stub renderer in P2** (HTML→string or a minimal
   PDF) — the row, numbering, and queue path are real; heavy templated PDF is flagged as a
   follow-up.
5. **Commerce — coupons** (`docs/03 §7.6` / `§7.13` coupons): `pct|flat`, `value`, `validity`
   window, `max_uses` + `used` counter, optional program scope; coupon math runs **in paise**
   server-side at order time; over-use / expiry / wrong-program rejected.
6. **Leads — pipeline** (`docs/03 §7.11/§7.12`, `docs/05 §3` CRM): `leads` with stages
   `new→contacted→qualified→counselling→negotiation→won|lost`, `source` + `utm`, **owner
   assignment** (simple round-robin/territory acceptable in P2), `branch_id`, `score` (field,
   manual/simple), `sla_due_at`. Kanban move = stage transition, audited.
7. **Leads — activities + tasks/SLA** (`docs/03 §7.11`): `activities`
   (`call|note|whatsapp|email|task`) **logged** (not sent) against a lead (or student), with
   `due_at`/`done_at` for follow-up **tasks** and **SLA timers**; counsellor "today's tasks /
   due follow-ups" view (`docs/03 §7.12`).
8. **Leads — bookings + conversion** (`docs/03 §7.12`): `bookings` (demo/slot) **intake API**
   + CRM management; a minimal stub public POST entry. **Lead→student conversion**: a won lead
   becomes a `student_profile` (status `active`/`lead`→`active`) and **optionally** spawns an
   order/enrollment, atomically + audited, with `converted_student_id` backlink.
9. **Cross-cutting** (`CLAUDE.md §3/§4`): every new table has `tenant_id` + soft-delete +
   audit; RBAC enforced server-side with data-scope per the `docs/03 §9` matrix (Payments/
   Refunds/Coupons = Finance full; Leads/Pipeline = Counsellor `own|assigned` + Marketing full
   + BranchMgr branch); zod DTOs in `@repo/types` shared FE+BE; **idempotent** money mutations;
   loading/empty/error on every async UI; a11y AA; money in paise; `turbo run build lint test`
   green; unit + integration tests gate; security-reviewer sign-off (no high/crit).
10. **`docs/03 §20` ledger reconciliation primitive:** for any date range, **sum of captured
    payments minus processed refunds equals the order ledger's paid total** — proven by an
    integration test. (Full revenue *dashboard* is P7; the reconciling primitive is P2.)

---

## Preconditions (what must already exist — verified from Phase 1)

- **P1 GREEN:** 118 unit + 75 integration tests pass; `turbo run build lint test` +
  `test:integration` green from clean clone (per `docs/phase-1-followups.md`).
- **Schema present** (`prisma/schema.prisma`): full identity/access + catalog
  (`programs/modules/lessons`) + **`student_profiles`, `faculty_profiles`, `batches`,
  `enrollments`** + `audit_logs`. Soft-delete + audit Prisma extensions are live and proven.
  `Program.pricePaise`/`currency`/`emi` already exist. `Enrollment` exists as **roster/join
  only** (`studentId`, `batchId`, `programId`, `status`, `progressPct`) — **no commerce
  fields/linkage yet** (P2 adds them).
- **RBAC machinery reusable** (proven across 8 CRM modules in P1):
  - `apps/api/src/modules/auth/decorators/require-permission.decorator.ts`
  - `apps/api/src/modules/auth/guards/permissions.guard.ts`
  - `apps/api/src/modules/auth/interceptors/scope.interceptor.ts`
  - `apps/api/src/modules/auth/lib/scope-context.ts` (`all|branch|assigned|own`)
  - `apps/api/src/modules/common-scope/*` (scope repository helpers)
- **Provider pattern proven** (the model the Razorpay adapter copies exactly):
  - `apps/api/src/modules/auth/providers/sms/sms-provider.interface.ts` — interface +
    `SMS_PROVIDER` DI `Symbol` token; `msg91-sms.provider.ts` is the stub impl; `AuthService`
    depends only on the interface. **The `PaymentProvider`/`PAYMENT_PROVIDER` token + Razorpay
    adapter must follow this identical shape** (`CLAUDE.md §1/rule 7`).
- **Contracts/SDK pattern proven:** `@repo/types` (zod DTOs, `{data,meta,error}` envelope,
  `Paginated<T>`, RFC-7807); OpenAPI registry → generated `@repo/api-client`. (Note follow-up:
  the spec file is named `auth.openapi.json` but holds the whole surface — rename to
  `api.openapi.json` is a tracked low-risk cleanup; do it opportunistically in W2.)
- **`@repo/ui` primitives present:** Button/Card/Input/Label/Toast + the 10 P1 primitives
  (DataTable, Drawer, Tabs, Select, StatusChip, EmptyState, Skeleton, FormField,
  ConfirmDialog, and the matrix grid). **Missing for P2:** Kanban board/column/card, a
  money/paise input, date/SLA chips, and an activity timeline.
- **CRM nav** (`apps/crm/src/lib/nav-config.ts`): the **Leads** section and the **Commerce**
  section (Payments/Invoices/Refunds/Coupons/Plans) are present but flagged `comingSoon: true`.
  P2 **flips these on** and wires routes. **Plans** stays `comingSoon` (EMI/dunning depth is
  beyond the P2 gate — P2 ships order-level `emi_plan` json only if free; full EMI plans +
  dunning are deferred).
- **Razorpay TEST keys already in `.env`:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
  **`RAZORPAY_WEBHOOK_SECRET` is NOT yet present** and must be user-provided (see "Secrets").

**Carried P1/P0 follow-ups that intersect P2 (fold in where a P2 task touches the code; else
leave tracked in `docs/phase-2-followups.md`):**
- **Counsellor `own`/`assigned` scope (P1 deferred):** P2 **resolves this** — `leads.owner_id`
  makes `own` real; `assigned` = owner_id OR territory/branch. This is a first-class P2 outcome.
- **Courses `assigned` scope fail-closed (P1, ADR-0009):** unchanged — remains P3 (LMS
  authoring). Do **not** touch in P2.
- **Hardcoded `TENANT_SLUG`:** P2 stays single-tenant; every new repo MUST tenant-scope every
  query (no new hardcodes). Real multi-tenant resolution stays deferred. (S1-3 cross-tenant
  IDOR test debt: P2 security review SHOULD add at least the **commerce/leads** cross-tenant
  isolation tests since money + PII are now in scope.)
- **PII read-access logging (S1-2):** leads carry phone/email PII; if cheap, add read-audit on
  lead detail; otherwise keep tracked. Not gating.
- **Playwright e2e + axe (carried):** P2 adds critical money + conversion journeys; light
  happy-path e2e (order→pay→enroll, lead→convert) is **recommended**, integration tests remain
  the gate.

---

## New schema the db-architect adds in P2

All from `docs/05 §3` "Commerce" + "CRM & marketing" (currently **spec-only**, per
`docs/05 §10`). Every table: `id` uuid PK, `created_at`/`updated_at`/`deleted_at`,
`tenant_id`, wired into the soft-delete + audit Prisma extensions, with the `docs/05 §4`
indexes. **Money fields are `*_paise Int`** (`CLAUDE.md §6`). **Do not** add later-phase
tables (campaigns, campaign_recipients, referrals, certificates, videos, etc. — those are
P3/P4/P6).

### Commerce tables

| Table | Columns (`docs/05 §3` Commerce) | Notes |
|-------|---------------------------------|-------|
| `orders` | `tenant_id`, `student_id` (FK student_profiles), `program_id` (FK programs), `amount_paise` Int, `currency` (default INR), `coupon_id` (FK coupons, null), `discount_paise` Int default 0, `status` enum `OrderStatus` (`created\|paid\|failed\|refunded`), `idempotency_key` (uniq), `emi_plan` Json?, `notes` | Indexes: `(idempotency_key)` uniq, `(student_id)`, `(tenant_id, status, created_at)`. `amount_paise` = net charged (after discount). |
| `payments` | `order_id` (FK orders), `tenant_id`, `provider` (default `razorpay`), `provider_payment_id` (uniq, null until captured), `provider_order_id` (Razorpay order id), `amount_paise` Int, `status` enum `PaymentStatus` (`created\|authorized\|captured\|failed\|refunded`), `method`, `signature_verified` Bool, `is_manual` Bool default false, `paid_at` | Indexes: `(provider_payment_id)` uniq, `(order_id)`, `(tenant_id, status)`. Ledger source of truth for reconciliation. |
| `invoices` | `order_id` (FK orders, uniq 1:1), `tenant_id`, `number` (uniq, sequential per tenant), `storage_key` (null until generated), `tax` Json?, `status` enum `InvoiceStatus` (`pending\|generated\|failed`), `issued_at` | Indexes: `(number)` uniq, `(order_id)` uniq. Generated async via `invoice-gen` queue. |
| `refunds` | `payment_id` (FK payments), `tenant_id`, `amount_paise` Int, `reason`, `status` enum `RefundStatus` (`requested\|approved\|rejected\|processed\|failed`), `requested_by` (FK users), `approved_by` (FK users, null), `provider_refund_id` (null until processed), `processed_at` | Indexes: `(payment_id)`, `(tenant_id, status)`. Approval workflow. |
| `coupons` | `tenant_id`, `code` (uniq per tenant), `type` enum `CouponType` (`pct\|flat`), `value` Int (percent points for pct, paise for flat), `max_uses` Int?, `used` Int default 0, `valid_from`, `valid_to`, `program_scope` Json? (null = all programs), `status` enum `CouponStatus` (`active\|disabled`) | Indexes: `(tenant_id, code)` uniq, `(tenant_id, status)`. `used` incremented atomically at order time. |

### CRM / leads tables

| Table | Columns (`docs/05 §3` CRM & marketing) | Notes |
|-------|----------------------------------------|-------|
| `leads` | `tenant_id`, `branch_id` (FK branches, null), `name`, `phone`, `email` (null), `program_interest` (FK programs, null), `source`, `utm` Json?, `stage` enum `LeadStage` (`new\|contacted\|qualified\|counselling\|negotiation\|won\|lost`), `owner_id` (FK users, null), `score` Int?, `sla_due_at` (null), `converted_student_id` (FK student_profiles, null, uniq) | Indexes: `(tenant_id, stage, owner_id)`, `(sla_due_at)`, `(phone)`. **`owner_id` is the field that makes counsellor `own`/`assigned` scope real.** |
| `activities` | `tenant_id`, `lead_id` (FK leads, null), `student_id` (FK student_profiles, null), `user_id` (FK users — actor), `type` enum `ActivityType` (`call\|note\|whatsapp\|email\|task`), `payload` Json?, `due_at` (null), `done_at` (null) | Indexes: `(lead_id, due_at)`, `(user_id, due_at)`. **Logged, not sent** — `whatsapp`/`email` types are records only in P2. `task` rows with `due_at` = follow-up SLA list. |
| `bookings` | `tenant_id`, `lead_id` (FK leads, null), `program_id` (FK programs, null), `slot_at`, `status` enum `BookingStatus` (`requested\|confirmed\|attended\|cancelled\|no_show`), `source` | Indexes: `(tenant_id, slot_at)`, `(lead_id)`. Demo/slot intake (API + CRM); minimal public stub POST. |

### Enrollment commerce-linkage (the P1-deferred connection)

Extend the existing `enrollments` table (additive, forward-only migration) — **do not** edit
shipped P1 migrations:

| Add to `enrollments` | Why |
|----------------------|-----|
| `order_id` (FK orders, **nullable**, optional uniq/partial-uniq) | Links a paid order to the enrollment it created. Nullable so P1-style manual/roster enrollments (no order) still validate; a partial-unique on `order_id WHERE order_id IS NOT NULL` prevents one order enrolling twice. |
| `source` enum `EnrollmentSource` (`manual\|order\|conversion`) default `manual` | Distinguishes admin/roster enroll (P1) vs paid-order enroll vs lead-conversion enroll. Keeps P1 behaviour intact. |

> Rationale (record as ADR): commerce-side enrollment data lives on the **order** (amount,
> coupon, payments); the enrollment only needs a **backlink** (`order_id`) + provenance
> (`source`). This avoids duplicating money fields onto `enrollments` and keeps the ledger
> single-sourced on `orders`/`payments` for clean reconciliation (`docs/03 §20`).

### New enums

`OrderStatus`, `PaymentStatus`, `InvoiceStatus`, `RefundStatus`, `CouponType`, `CouponStatus`,
`LeadStage`, `ActivityType`, `BookingStatus`, `EnrollmentSource`.

### Seed expansion (permission matrix + sample data)

Expand `prisma/seed.ts` to materialize, per `docs/03 §9`, the permission catalog + scoped
`role_permissions` for the **new modules**:

- `orders`, `payments`, `invoices`, `refunds`, `coupons` (Commerce): **Finance = full (`all`)**;
  **Owner/Admin = full**; **BranchManager = `branch` view** (payments/orders); Counsellor/
  Faculty/Marketing/Support = none (Marketing may have `coupons.view`/`create` per §9
  Marketing-owns-coupons — confirm). `refunds.approve` granted to **Finance + Owner/Admin** only.
- `leads` (+ `pipeline`), `activities`, `bookings` (CRM): **Counsellor = `own|assigned`
  view/create/edit**; **Marketing = full (`all`)** on leads; **BranchManager = `branch`**;
  **Owner/Admin = full**. `leads.convert` (conversion) granted to Counsellor (own/assigned) +
  Admin/Owner.
- Forward-looking keys for still-later modules may remain seeded but unused (harmless).

Plus **sample data** so the CRM renders + tests have fixtures: a few coupons; a handful of
leads across stages with owners + activities + a booking; one or two completed
order→payment→invoice→enrollment chains (so the ledger + reconciliation test + the Payments
ledger UI have rows); a refund in `requested` state.

---

## Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 1 | **Schema + migration + seed.** Add the 5 commerce tables (`orders`, `payments`, `invoices`, `refunds`, `coupons`) + 3 CRM tables (`leads`, `activities`, `bookings`) + the 10 new enums per the tables above; add `order_id` + `source` to `enrollments` (additive). uuid PK, `tenant_id`, soft-delete + audit wired, `docs/05 §4` indexes (incl. `orders.idempotency_key` uniq, `payments.provider_payment_id` uniq, `coupons (tenant_id,code)` uniq, `leads (tenant_id,stage,owner_id)`). Forward-only migration applies clean (never edit P1 migrations). Expand `seed.ts`: new-module permission matrix per `docs/03 §9` + sample commerce/leads data. Integration test: soft-delete filter + audit-row-on-mutation for `orders` + `leads`; money fields are Int paise. | db-architect | — | **W1** | §4: every table tenant_id + soft-delete + audit; money in paise; migration forward-only. `docs/05 §3/§4/§10`, `docs/03 §9`. Migration + seed run clean; extension test green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for **Commerce** — Orders (Create/Query/ListItem/Detail; CreateRazorpayOrder; VerifyPayment{razorpay_order_id,payment_id,signature}; ManualPayment), Payments (ledger ListItem/Detail), Invoices, Refunds (Request/Approve/Reject/ListItem), Coupons (Create/Update/Query/Validate{code,programId}→discount), plus a `LedgerReconciliation` summary DTO — **and Leads** — Leads (Create/Update/Query/ListItem/Detail/MoveStage), Activities (Create/Query incl. task/SLA), Bookings (Create/Query/UpdateStatus), Convert (lead→student[+order]). Webhook payload type (Razorpay event). Reuse the `{data,meta,error}` envelope + `Paginated<T>` + RFC-7807. **All money fields = integer paise**, validated `>= 0`. Register in OpenAPI registry; regenerate `@repo/api-client`. (Opportunistic: rename `auth.openapi.json`→`api.openapi.json` per follow-up.) | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at every boundary; money paise. `docs/04 §2.5/§2.14`. Client compiles; SDK methods exist for every commerce + leads resource. |
| 3 | **Commerce design-system primitives.** Add to `@repo/ui` ONLY what P2 needs and P1 lacks, per `docs/03 §11/§12/§15` + `docs/07`: **KanbanBoard / KanbanColumn / KanbanCard** (keyboard-movable, DnD with a no-mouse fallback, AA, status-by-label-not-color-only), **MoneyInput** (paise-aware: displays ₹, stores integer paise; never floats), **DateChip / SlaChip** (due/overdue with label + icon, not color-only), **ActivityTimeline** (chronological list of typed activity items). All keyboard-first, focus-managed, AA; unit/a11y test each. | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard + SR labels); loading/empty/error patterns where applicable; no color-only status (`docs/03 §15`). `docs/07`. Each primitive has a unit/a11y test. |
| 4 | **Razorpay `PaymentProvider` adapter.** Following the SMS-provider pattern exactly (`sms-provider.interface.ts` + `SMS_PROVIDER` token): define `PaymentProvider` interface + `PAYMENT_PROVIDER` DI `Symbol` token with `createOrder(amountPaise, currency, receipt, notes)`, `verifyPaymentSignature({orderId,paymentId,signature})` (HMAC-SHA256 with `RAZORPAY_KEY_SECRET`), `verifyWebhookSignature(rawBody, signatureHeader)` (HMAC with `RAZORPAY_WEBHOOK_SECRET`), `fetchPayment(id)`, `refund(paymentId, amountPaise)`. Implement `RazorpayPaymentProvider` (TEST keys from env, zod-validated at boot per `CLAUDE.md §3.12`). Provider does NO business logic — only vendor calls + signature math; idempotency/ledger live in the service (#5). Unit tests with known HMAC vectors (signature verify pass/fail, webhook verify pass/fail). | integrations | 1, 2 | **W3** | §4 + `CLAUDE.md §1/rule 7`: vendor SDK only behind interface; env-validated; secrets via env. `docs/04 §2.10`. Adapter injected by token; signature/webhook unit tests green (deterministic vectors, no live network). |
| 5 | **Backend A — Commerce module.** NestJS `commerce` module (orders/payments/invoices/refunds/coupons), controller→service→repository, depending on `PaymentProvider` (token from #4). Endpoints: create order (coupon applied + validated server-side, **idempotency-key** header → `orders.idempotency_key`), create-razorpay-order, **verify-payment** (signature via provider → mark payment captured → mark order paid → **atomically create/link enrollment into chosen batch** in one `$transaction`, `source=order`), **manual/offline payment** entry, **webhook** endpoint (raw-body, signature-verified, **idempotent** by `provider_payment_id` — replay-safe), **refunds** (request→approve/reject→process via provider, finance/`refunds.approve` gated, audited), **coupons** CRUD + validate (paise math, `used`/`max_uses`/validity/program-scope), **invoices** (queued `invoice-gen` on payment success; **simple/stub PDF** renderer writing a `storage_key`; row + sequential `number`), and a **ledger reconciliation** read (sum captured − processed refunds vs order paid total, for `docs/03 §20`). `@RequirePermission` + `ScopeInterceptor` per §9 (Finance full; BranchMgr branch-view). Every mutation audited; soft-delete where applicable. BullMQ `invoice-gen` worker (idempotent). | backend-builder | 1, 2, 4 | **W4** | §4: server RBAC + scope; **idempotent money mutations** (`docs/04 §2.6`); audit on mutation; money paise; loading-agnostic API. `docs/03 §7.6/§20`, `docs/04 §2.6/§2.8/§2.10`. Order→enrollment atomic; webhook replay-safe; reconciliation read correct. |
| 6 | **Backend B — Leads module.** NestJS `leads` module (leads/activities/bookings/conversion), controller→service→repository. Endpoints: leads CRUD + **stage move** (kanban transition, audited), **owner assignment** (manual + a **simple round-robin/territory** assigner — keep simple), list/filter by stage/owner/source/SLA; **activities** CRUD (typed `call|note|whatsapp|email|task`, `due_at`/`done_at`; **logged not sent** — no MailProvider/WhatsAppProvider wired) + a **"my tasks / due follow-ups"** query (`docs/03 §7.12`); **bookings** intake (CRM management + a **minimal stub public POST** `/api/v1/bookings`, rate-limited, no auth) + status updates; **lead→student conversion** (atomic `$transaction`: create `student_profile`, set `converted_student_id`, optionally create order/enrollment via the commerce service, audited). `@RequirePermission` + `ScopeInterceptor` per §9 with **`own|assigned` now real via `leads.owner_id`** (Counsellor own/assigned; Marketing all; BranchMgr branch). Every mutation audited. | backend-builder | 1, 2, (5 for conversion→order) | **W4** | §4: server RBAC + **`own`/`assigned` scope enforced via owner_id**; audit on mutation. `docs/03 §7.11/§7.12/§9/§20(a)`. Counsellor sees only own/assigned leads; forbidden action 403 + logged; conversion atomic. |
| 7 | **CRM frontend A — Commerce screens.** Flip the **Commerce** nav (Payments/Invoices/Refunds/Coupons) off `comingSoon`; wire routes (Vite/TanStack Router+Query, RHF+zod from `@repo/types`). Build: **Payments/Orders ledger** (dense DataTable, status chips, ₹ via MoneyInput, manual-payment entry, order detail drawer showing payments/invoice/enrollment link + the reconciliation total), **Invoices** (list + download/regenerate), **Refunds** (request + **approval queue** with approve/reject — finance only, RBAC-aware), **Coupons** (CRUD + validity/usage). RBAC-aware rendering (hide what API forbids); loading/empty/error everywhere; money always paise→₹ formatted, never float math in the client. **Plans** stays `comingSoon`. | frontend-builder | 5, 3 | **W5** | §4: loading/empty/error on every async UI; a11y; RBAC-aware UI; no business logic in components (hooks). `docs/03 §7.6/§10/§11/§12`. Ledger UI total matches API reconciliation read. |
| 8 | **CRM frontend B — Leads screens.** Flip the **Leads** nav (Pipeline/Counselling/Tasks) off `comingSoon`; wire routes. Build: **Pipeline kanban** (KanbanBoard, drag/keyboard stage move → API, owner avatar, SLA chip), **Lead detail drawer/page** (fields + UTM + **ActivityTimeline** + log-activity form + follow-up **tasks** with DateChip/SlaChip), **Counselling/Tasks** view (today's tasks + due follow-ups), **Bookings** management, **Convert-to-student** action (lead→student[+optional order/enrollment], confirm dialog). RHF+zod, RBAC-aware (counsellor sees own/assigned only — mirrors server scope), loading/empty/error. | frontend-builder | 6, 3 | **W5** | §4: as #7. `docs/03 §7.11/§7.12/§10/§11/§12`. Kanban move + conversion call the scoped APIs; UI hides cross-scope leads. |
| 9 | **Tests.** Unit (services: coupon paise math incl. pct/flat/cap/expiry/over-use; signature/webhook verify; idempotency-key dedupe; reconciliation summation; round-robin assigner; scope-filter builders for leads own/assigned). Integration (testcontainers, real PG/Redis + **mocked provider**): **order→pay(verify)→enrollment** atomic + idempotent (replayed verify/webhook does NOT double-enroll or double-pay); **webhook signature reject** + **replay idempotency**; **refund approval** authz (non-finance 403 + logged; approve flips status; ledger reflects); **coupon** validity/usage/program-scope enforcement; **ledger reconciliation equals payments−refunds** for a date range (`docs/03 §20`); **leads pipeline** CRUD + stage move audited; **scope isolation** (Counsellor sees only `own|assigned` leads/activities/bookings; cross-owner access 403 + logged — the now-real P1-deferred scope); **lead→conversion** atomic; **audit-row on every mutation**. Light Playwright happy-path e2e (order→pay→enroll; lead→convert) — recommended, non-gating. Wire into CI. | qa-engineer | 5, 6, 7, 8 | **W6** | §4: unit + integration green; tests gate merge. `docs/03 §20` (incl. reconciliation). Coverage of every commerce + leads path + each scope mode + idempotency + signature. |
| 10 | **Security review.** Payment integrity: **signature verification mandatory** (no order marked paid without verified signature); **webhook replay + forgery** (unverified/duplicate webhook is rejected/no-ops); **idempotency** can't be bypassed to double-charge/double-enroll; **IDOR** on orders/payments/invoices/refunds (can a non-owner/non-finance user read/refund another's order?); **finance-scope** + `refunds.approve` authz (no self-approval escalation beyond grants); **coupon abuse** (negative/over-100% discount, over-use race); **leads `own`/`assigned` scope isolation** (counsellor cannot read/edit out-of-scope leads — the P1-deferred criterion now exercised); **no secret leakage** (key secret / webhook secret never in responses, logs, or client bundle); **tenant isolation** on all new repos (add the cross-tenant commerce/leads test debt from S1-3); **PCI-surface note** (we never store card data — Razorpay-hosted; document the surface). Report high/crit as fix tasks; re-verify. | security-reviewer | 9 | **W7** | §4 + `docs/04 §7` gate: server RBAC; idempotent payments; no secret leakage. `docs/03 §17/§20`. No high/crit open; signature + webhook + scope + IDOR verified. |
| 11 | **Docs sync.** Update `README.md` (commerce + leads modules; how to run with Razorpay TEST keys + the new `RAZORPAY_WEBHOOK_SECRET`; how to seed/verify P2; how to exercise the webhook locally). ADRs for P2 decisions (order-as-ledger-source / enrollment-backlink modeling; idempotency-key strategy; order→enrollment atomicity; invoice-PDF stub-vs-real; coupon paise math; lead-owner scope resolving the P1 `own|assigned` deferral; round-robin assignment). Update `docs/05 §10` implementation status (commerce + CRM tables → Implemented P2). Update `docs/phase-2-followups.md` (invoice PDF heaviness, Plans/EMI/dunning deferral, public booking funnel → P5, activity *sending* → P6, revenue dashboards → P7, any carried S1-x). | docs-writer | 10 | **W7** | §4: short summary of what changed + how to verify. P2 closeout; `docs/05 §10` + ADRs + followups synced. |

---

## Execution order (waves)

- **Wave 1:** #1 (db-architect) — schema + migration + seed; everything depends on it.
- **Wave 2 (parallel):** #2 (api-designer — contracts/SDK, needs #1) ‖ #3 (design-system —
  Kanban/MoneyInput/SLA chips/timeline, needs nothing).
- **Wave 3:** #4 (integrations — Razorpay `PaymentProvider` adapter; needs #1 + #2 types).
  This is a hard dependency for the commerce backend.
- **Wave 4 (parallel):** #5 (backend-builder — Commerce; needs #1+#2+#4) ‖ #6 (backend-builder
  — Leads; needs #1+#2, and #5's commerce service for the convert→order path). If #6's
  conversion-spawns-order path would block on #5, ship #6's lead/activity/booking/stage-move
  first and land convert→order as a thin follow-on once #5's order-create exists.
- **Wave 5 (parallel):** #7 (frontend-builder — Commerce UI; needs #5 + #3) ‖ #8
  (frontend-builder — Leads UI; needs #6 + #3).
- **Wave 6:** #9 (qa-engineer) — needs all backend + frontend landed.
- **Wave 7:** #10 (security-reviewer) → #11 (docs-writer).

---

## Risks & open questions

1. **Payment idempotency (highest risk).** Every money mutation must be replay-safe.
   Strategy: **`Idempotency-Key` header → `orders.idempotency_key` unique**; verify-payment and
   webhook both **idempotent by `provider_payment_id`** (unique) so a replayed verify OR a
   duplicate webhook is a no-op, not a second charge/enroll. The order→pay→enroll step runs in a
   single `$transaction`. QA (#9) explicitly replays verify + webhook and asserts no double
   effect. Decision recorded as ADR.
2. **Order→enrollment atomicity.** A paid order must enroll **exactly once** into exactly one
   batch. Open question: **which batch?** Decision: the order (or the verify/convert call)
   carries an explicit `batch_id` chosen by staff/funnel (validated: batch belongs to the
   order's program, capacity not exceeded). The enrollment links back via `enrollments.order_id`
   (partial-unique) so the same order can't enroll twice. Manual roster enrollments (P1) keep
   `order_id = null`, `source = manual` — backward compatible.
3. **Invoice PDF: stub vs real.** Templated, tax-correct PDF generation is heavy. **P2 ships
   the real row + sequential numbering + the `invoice-gen` queue + a *simple* renderer**
   (minimal PDF or HTML→string to a `storage_key`); a polished branded templated invoice is a
   tracked follow-up (likely alongside certificate PDF rendering in P4). Flagged so the
   `docs/03 §7.6` "auto invoice + receipt" criterion is met in mechanism, refined later.
4. **Lead assignment strategy.** §7.11 wants round-robin/territory. **P2 keeps it simple:**
   manual owner set + a basic round-robin (and/or branch=territory) assigner; advanced rules +
   lead scoring are P6/future. Recorded as ADR; not over-built.
5. **Making counsellor `own`/`assigned` scope real (resolves a P1 deferral).** P1 scoped
   counsellors to `branch` as a placeholder because there was no ownership field. **`leads.owner_id`
   is that field.** P2 defines: `own` = `owner_id = current_user`; `assigned` = owned OR within
   the user's territory/branch (configurable). `activities`/`bookings` inherit scope via their
   parent lead. The `students` module's counsellor scope can now optionally tighten to
   "students converted from leads I own", but to stay in-gate **P2 only makes leads-side
   own/assigned real**; revisiting students-side counsellor scope is a small follow-on, not a
   P2 blocker. QA (#9) + security (#10) exercise the leads scope isolation explicitly.
6. **Webhook local testing.** Razorpay webhooks need a public URL; locally use a tunnel or a
   signed-payload test fixture. QA uses **deterministic signed fixtures** (no live network);
   docs (#11) explain tunnel-based manual testing. Not a code risk, a dev-ergonomics note.
7. **Backend split sizing.** #5 (commerce) is large (5 sub-resources + provider + queue +
   reconciliation). If it overruns one specialist run, sub-split: **5a orders/payments/webhook/
   enrollment** | **5b refunds/coupons/invoices/reconciliation** — same wave, shared module.
8. **`coupons` ownership (Marketing vs Finance).** `docs/03 §9` puts coupons under Marketing
   (§7.13) but they affect money (Finance). Default: **Marketing creates/edits coupons; Finance
   + Owner/Admin see all order/discount impact**; confirm in seed. Low risk.
9. **Cross-tenant test debt (S1-3).** Single-tenant simplification persists, but money + PII
   raise the stakes. Security review (#10) SHOULD add commerce/leads cross-tenant isolation
   tests even though full multi-tenant resolution stays deferred.

---

## Open questions / secrets the user must provide for P2

- **`RAZORPAY_WEBHOOK_SECRET` — REQUIRED, user-provided.** Set in the Razorpay dashboard when
  creating the webhook; needed to HMAC-verify incoming webhook payloads (#4 `verifyWebhookSignature`,
  #5 webhook endpoint). Must be added to `.env` and to the zod env schema. **Until provided,
  the webhook path can be built + unit-tested with a fixture secret, but live webhook
  verification is inert.**
- **`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — ALREADY in `.env` (TEST mode).** Used for
  create-order, signature verify, and refunds. Confirm they are TEST keys (no live charges).
- **NOT needed in P2 (sending is P6):** MSG91/SMS, WhatsApp Cloud/Gupshup, SES/Resend/email.
  Lead **activities** of type `whatsapp`/`email` are **logged as records, not sent** — no
  MailProvider/WhatsAppProvider is wired in P2. Those keys land in P6.
- **NOT needed in P2:** S3/R2 storage *can* be stubbed for the invoice PDF `storage_key` (a
  local/stub StorageProvider is acceptable in P2; real bucket wiring can come with video/
  certificate storage in P3/P4). If a real bucket is desired now, S3/R2 creds would be the only
  extra secret — otherwise stub it. Flag the choice in the integrations task.
- **Product decisions (defaults chosen if no answer):**
  1. **Q1 (which batch a paid order enrolls into):** order/verify carries explicit `batch_id`
     (validated vs program + capacity). *Default:* explicit `batch_id`.
  2. **Q2 (invoice PDF depth):** simple/stub renderer in P2, branded templated PDF deferred.
     *Default:* stub renderer, real row+numbering+queue.
  3. **Q3 (coupon ownership):** Marketing creates, Finance sees impact. *Default:* that split.
  4. **Q4 (assigned scope definition):** `assigned` = owned OR territory/branch. *Default:* that.
  5. **Q5 (invoice storage):** stub StorageProvider in P2 vs real R2/S3 now. *Default:* stub.

---

## Definition of Done for the whole phase (gate to P3)

- [ ] Migration adds `orders`, `payments`, `invoices`, `refunds`, `coupons`, `leads`,
      `activities`, `bookings` + the 10 enums + `enrollments.order_id`/`source` (uuid PK,
      tenant_id, soft-delete, indexes, money paise), wired to soft-delete + audit; seed creates
      the new-module permission matrix (`docs/03 §9`) + sample commerce/leads data.
- [ ] zod DTOs for all commerce + leads resources in `@repo/types`, imported FE+BE;
      `@repo/api-client` regenerated with SDK methods for each; all money fields integer paise.
- [ ] Razorpay `PaymentProvider` lives behind the interface + DI token (SMS-provider pattern);
      vendor SDK never called from a feature module; env zod-validated; signature + webhook
      verification unit-tested with deterministic vectors.
- [ ] Commerce backend: create-order (coupon paise math + idempotency-key), Razorpay
      create-order, **verify-payment → captured → order paid → atomic enrollment**, manual
      payment, **idempotent signature-verified webhook**, refunds approval workflow, coupons
      CRUD+validate, queued invoice gen (row + number + stub PDF), **ledger reconciliation read**
      — all `@RequirePermission` + scope per §9, every mutation audited, money mutations idempotent.
- [ ] Leads backend: leads CRUD + stage move + owner assignment (incl. round-robin), activities
      (logged not sent) + tasks/SLA, bookings intake (+ stub public POST), **lead→student
      conversion** (atomic, optional order/enrollment) — scope `own|assigned` **real via
      owner_id**, every mutation audited.
- [ ] CRM SPA: Commerce (Payments/Orders ledger, Invoices, Refunds approval, Coupons) and Leads
      (Pipeline kanban, Lead detail + ActivityTimeline + tasks/SLA, Bookings, Convert) screens
      live; nav flipped off `comingSoon` (except Plans); RBAC-aware UI; loading/empty/error
      everywhere; ₹ formatted from paise, no client-side float money math.
- [ ] **`docs/03 §20` ledger reconciliation:** sum(captured payments) − sum(processed refunds)
      = order paid total for any date range — proven by integration test.
- [ ] **Idempotency proven:** replayed verify + duplicate webhook do NOT double-charge or
      double-enroll (integration test). Webhook signature forgery/replay rejected.
- [ ] **`docs/03 §20(a)`:** a Counsellor sees only `own|assigned` leads/activities/bookings; a
      forbidden action (cross-owner / non-finance refund-approve) is blocked **server-side** and
      **logged** — proven by integration tests (the now-real P1-deferred scope).
- [ ] **`docs/03 §20(b)`:** every create/update/delete on orders/payments/refunds/coupons/
      invoices/leads/activities/bookings writes an audit-log row with actor, timestamp,
      before/after.
- [ ] Unit + integration tests green (commerce + leads + every scope mode + idempotency +
      signature + reconciliation); `turbo run build lint test` + `test:integration` green;
      optional light e2e (order→pay→enroll, lead→convert) if added.
- [ ] a11y AA pass on new `@repo/ui` primitives (Kanban/MoneyInput/SLA chips/timeline) and the
      new CRM screens (keyboard + SR labels; no color-only status).
- [ ] security-reviewer sign-off: no high/critical findings open on payment signature/webhook/
      idempotency/IDOR/finance-scope/refund-authz/coupon-abuse/leads-scope/secret-leakage/tenant.
- [ ] README + ADRs + `docs/phase-2-followups.md` synced; `docs/05 §10` reflects commerce + CRM
      tables as Implemented (P2).
