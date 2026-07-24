# Spec: Phase 7 — Analytics + Hardening

> Written by: product-manager · Phase: P7 · Date: 2026-07-04
> Consumed by: db-architect (#1 — materialized views/aggregates), api-designer (#2),
> backend-builder (#3, #5, #6, #7 — dashboards, exports, observability, security fixes),
> frontend-builder (#8 — CRM dashboard/report UI), design-system (#4 — chart/KPI primitives),
> devops (#9 — health checks, CI gates, dependency scan), qa-engineer (#10 — load test +
> testcontainers backfill), security-reviewer (#11), docs-writer (#12).
>
> **PROPOSED numeric targets are marked inline and require explicit user sign-off before
> qa-engineer builds tests against them.** Everything else is LOCKED.
> Every numbered AC below maps to a test in task #10 and a security check in task #11.

---

## Why (purpose + which metric it moves)

P1–P6 built the operations, commerce, learning, and engagement layers and — per
`docs/00-product-strategy.md §10` — promised that **"every number on a dashboard is
traceable to a row in the DB."** P6 explicitly deferred "the dashboards that visualize
engagement ROI, gamification analytics, and forum health" to P7 (LOCK-5,
`docs/specs/phase-6-engagement.md`). P4/P5/P6 security reviews also left a documented
tail of Medium/Low findings (rate-limiting gaps, SSE tenancy/cap, webhook replay window,
audit-log PII) that were accepted for their respective gates but flagged for closure
before scale. P7 is the phase that makes the numbers visible, trustworthy, exportable —
and makes the platform provably ready for the 100k-concurrent target
(`docs/04-trd-architecture.md §8`, `docs/00 §7`).

**Metrics moved:**

| Metric | Direction | Mechanism |
|--------|-----------|-----------|
| Report freshness (target: near-real-time, `docs/03 §6`) | Up | Materialized-view/read-replica dashboards replace ad hoc queries; freshness is surfaced, not assumed |
| Lead→paid conversion (≥ 15%) | Up (indirectly) | Funnel dashboard makes conversion drop-off visible to counsellors/owner, enabling intervention |
| Program completion % (≥ 60%) | Up (indirectly) | Attendance + engagement dashboards surface at-risk batches early |
| Availability (99.9%, `docs/00 §7`) | Protected | Health/readiness endpoints + rate-limiting + load-test-verified capacity ceiling |
| Trust/credibility (North Star support) | Protected | DPDP erasure integrity, no PII leakage in exports/logs/errors, dependency hygiene |
| Certified Outcomes/Month (North Star) | Protected | Hardening prevents an incident (breach, data leak, outage) from damaging the credibility the whole funnel depends on |

---

## Users and roles affected

| Role | Scope | New capabilities in P7 |
|------|-------|------------------------|
| Owner / Admin | all | All KPI dashboards, all exports/scheduled reports, DPDP erasure execution, security-posture visibility (no new UI beyond existing Admin ▸ Audit Logs) |
| Branch Manager | branch | Branch-scoped revenue/enrollment/funnel/attendance dashboards + exports |
| Counsellor | own (assigned leads) | Own-scoped funnel/conversion report |
| Faculty / Mentor | assigned batches | Attendance, course/video engagement, gamification-participation, forum-health dashboards scoped to assigned batches |
| Finance | all (finance domain) | Revenue/payment reports + exports (existing PRD scope, now with real dashboards) |
| Marketing | all (marketing domain) | Campaign-performance dashboard (visualizes P6 `campaigns.metrics`/`campaign_recipients`) |
| Support | — | No new capability (ticket dashboards are explicitly OUT — `tickets` table is not yet implemented; see Part 6 CONFLICT-P7-3) |
| Student (LMS) | own | No new capability — P7 ships no new student-facing analytics UI (leaderboard/progress already shipped in P6) |
| Public (unauthenticated) | n/a | Can call `GET /health` (liveness) for uptime monitoring; receives no internal detail |
| Any authenticated caller | own request | Every error response now carries a correlation/trace id for support diagnosis |

RBAC is server-enforced (`@RequirePermission` + `ScopeInterceptor`, unchanged pattern from
P0–P6). The UI hides what the API already forbids. No dashboard, report, or export may
return data outside the caller's tenant or data-scope — this is asserted per-dashboard
below, not assumed.

---

## Locked Architecture Decisions (gate-confirmed, not up for debate)

**LOCK-D1: Analytics compute = materialized views / read replica, not the write-path DB.**
Per `docs/05-database-design.md §8`, heavy aggregates (revenue, funnel, completion,
attendance, engagement, campaign/gamification/forum health) are computed against
materialized views and/or a read replica, refreshed on a schedule or triggering event —
never a live aggregate query against the primary write connection pool. This protects
write-path latency under the 100k-concurrent target.

**LOCK-D2: No new async infra required.** Scheduled report emails (PRD `docs/03 §7.14`)
reuse the existing sync-seam `MailProvider`/Resend dispatch pattern (ADR-0039) already
built in P6. BullMQ is still not installed. A documented BullMQ migration path continues
to exist for both notification/campaign dispatch (P6) and future report scheduling.

**LOCK-D3: Observability stack is Sentry + OpenTelemetry + pino** (`docs/04 §2.13`,
already declared in the TRD). P7's job is to verify/complete the wiring (correlation ids,
PII scrubbing, trace propagation across module + provider boundaries) — not to introduce
a different stack.

**LOCK-D4: CSV export safety is a single shared `csvSafeCell()` choke-point.** Every
export sink (leads, students, payments, campaigns, forum, any future export) routes
through one formula-cell-neutralization helper. No export path hand-rolls its own
CSV escaping.

**LOCK-D5: SSE hardening (P6 M-1) is closed with in-memory tenant-namespacing + a
connection cap — not a Redis/BullMQ migration.** The full Redis pub/sub migration
(ADR-0039/0043 documented path) remains a future item; P7 only needs to (a) key the
subscriber map by `(tenantId, userId)` and (b) enforce a per-user connection cap.

**LOCK-D6: PROPOSED numeric SLO/Lighthouse/load-concurrency targets require explicit
user sign-off.** Every AC in WS-D (Performance SLOs) and WS-F (Load Test) that states a
concrete number is marked **PROPOSED** and must be confirmed or adjusted by the user
before `qa-engineer` builds pass/fail tests against it. Nothing else in this spec is
proposed — only the numbers.

---

## Part 1 — Locked Scope Decisions (explicit outs, with justification)

### LOCK-1: Certificate template designer UI — further deferred (NOT P7)

`docs/phase-4-followups.md` CONFLICT-2 named "P7" as the certificate designer's landing
phase. This spec explicitly moves it out again: a WYSIWYG drag-drop template designer is
a **content-authoring feature**, not analytics or hardening, and does not fit this
phase's purpose. Recorded as **CONFLICT-P7-1**.

### LOCK-2: Global search (tsvector / Meilisearch) — further deferred (NOT P7)

`docs/phase-5-followups.md` (CONFLICT-P5-4) and `docs/phase-6-followups.md` both named
"P7" for full-text search across programs/blog/forum. This spec is scoped to
analytics + hardening only; search is a **discovery feature**. Deferred again. Recorded
as **CONFLICT-P7-2**.

### LOCK-3: Support ticket system + ticket dashboards — OUT of P7

`docs/03 §7.15` describes a full help-desk module; `docs/05-database-design.md §10`
confirms `tickets` is still "Spec only (P7–P8)" — the table does not exist yet. A
dashboard cannot visualize a table that isn't built. Ticket-adjacent KPIs (open tickets
count on the Overview dashboard, per `docs/03 §7.1`) are **excluded** from the Overview
dashboard AC in this phase. Recorded as **CONFLICT-P7-3**.

### LOCK-4: Bookmarks — further deferred (NOT P7)

`docs/phase-6-followups.md` named "P7" for the LMS bookmarks convenience feature. Not
analytics or hardening; deferred again. Recorded as **CONFLICT-P7-4**.

### LOCK-5: AI mentor, multi-tenant SaaS onboarding, new portals (recruiter/college/parent)

Explicitly P8 per `CLAUDE.md §6`. Not touched by this spec.

### LOCK-6: Live-class scheduling, referral/affiliate programs, marketing automation builder

Carried P6 outs (`CONFLICT-P6-1..4`), unaffected by this phase.

### LOCK-7: Real video-provider activation, `hls.js` browser approval, BullMQ real cluster buildout

Unrelated infra blockers carried since P3–P6; not addressed by this spec. The SSE
tenancy/cap fix (LOCK-D5 above) does **not** require the BullMQ migration.

### LOCK-8: Certificate template designer, reissue partial-unique migration, live-class attendance

Other carried db/product items (`docs/phase-4-followups.md` M-2, etc.) are not gated by
this spec. `db-architect`/`security-reviewer` may pick them up opportunistically but they
are not P7 acceptance criteria here.

### LOCK-9: DataTable row virtualization (ADR-0012)

Named "wire in P7" across several followups files as a **CRM frontend performance**
item. It is relevant to WS-B (large report tables) and is noted as a dependency in
Part 8, but is not itself a numbered AC — it is an implementation technique
`frontend-builder` may use to satisfy the export/report performance ACs, not a
user-facing acceptance criterion in its own right.

---

## Part 2 — User Stories by Workstream

### WS-A: KPI Dashboards

- As the Owner, I see revenue, enrollment, funnel, and completion trends at a glance so I
  trust the numbers without asking finance to pull a spreadsheet.
- As a Branch Manager, I see the same dashboards scoped to only my branch.
- As a Counsellor, I see my own lead funnel and conversion rate.
- As Faculty, I see attendance and video/course engagement for my assigned batches so I
  can spot at-risk students early.
- As Marketing, I see campaign performance (sent/delivered/read/failed) across all
  campaigns.
- As Finance, I see revenue reconciled to the payments ledger for any date range.
- As any dashboard viewer, I see a clear loading state while data is fetching, a clear
  empty state when there is nothing in range, and a clear error state (not a blank
  screen) if the query fails.
- As any dashboard viewer, I can filter every dashboard by a date range and — where
  applicable — by branch.

### WS-B: Reports + Exports

- As a Finance/Ops user, I can export any report I can view as CSV so I can share it
  outside the CRM.
- As Ops, I can export a PDF report where a printable summary is expected (e.g. revenue
  summary).
- As Ops, I can schedule a recurring report email so I don't have to remember to pull it.
- As any exporter, I trust that a name or note field containing `=SUM(...)` in the
  exported CSV will not execute as a formula when I open it in Excel/Sheets.
- As a Branch Manager, my export contains only my branch's rows — never another
  branch's or another tenant's data.
- As Ops exporting 50,000 student rows, the export completes without timing out or
  crashing the server.

### WS-C: Observability

- As an on-call engineer, I can hit `/health` and `/health/ready` to know if the API and
  its dependencies (DB, Redis) are up, without needing to authenticate.
- As an on-call engineer, every error I see in Sentry has a correlation/trace id I can
  grep in the logs to reconstruct the full request.
- As a security reviewer, I can confirm that no log line or error response ever contains
  a plaintext email, phone number, or secret.

### WS-D: Performance

- As the Owner, I trust that the CRM dashboards and LMS pages stay fast as the student
  base grows toward 100k.
- As a developer, I have a documented, testable latency budget per hot endpoint instead
  of a vague "make it fast."

### WS-E: Security Hardening

- As a security reviewer, I can check off every Medium/Low finding carried from P0–P6
  that was accepted-for-now, one at a time, against a concrete AC.
- As a Data Protection Officer (compliance role), I can trigger an erasure request for a
  user and trust that their PII is gone from every place it was stored, including inside
  audit-log snapshots — without destroying the audit trail itself.

### WS-F: Load Test

- As the Owner, before we scale marketing spend, I want documented proof of how the
  system behaves as concurrency ramps toward the 100k target, with a clear ceiling
  documented for capacity planning.

---

## Part 3 — Acceptance Criteria (Given / When / Then)

> ACs are numbered sequentially. QA task #10 tests them all; security task #11 asserts
> the security-marked ACs. Headline ACs: **AC-1** (revenue reconciliation), **AC-28**
> (CSV-injection neutralization), **AC-43** (Sentry PII scrubbing), **AC-52** (N+1 query
> budget), **AC-64** (DPDP erasure reaches audit_logs), **AC-70** (load test journeys).
> Total AC count: **74**.

---

### WS-A1: Revenue Dashboard

**AC-1 — HEADLINE: Revenue dashboard reconciles exactly with the payments ledger**
Given a date range R and captured payments for tenant T within R,
When an Owner calls `GET /crm/reports/revenue?from=&to=`,
Then `data.totalPaise` equals `SUM(payments.amount_paise) WHERE status = 'captured' AND paid_at BETWEEN R AND tenant_id = T`, `data.currency` is explicit (e.g. `"INR"`), `totalPaise` is an integer (never a float), and the total never diverges from a direct ledger query by even one paisa.

**AC-2 — Revenue dashboard is branch-scoped for Branch Manager**
Given Branch Manager M assigned to Branch B,
When M calls `GET /crm/reports/revenue`,
Then only payments for orders whose student belongs to Branch B are included in any total or breakdown; Branch C's payments never appear.

**AC-3 — Revenue dashboard cross-tenant IDOR**
Given Tenant A's payments and an authenticated Owner of Tenant B,
When Tenant B's Owner calls `GET /crm/reports/revenue`,
Then Tenant A's rows never appear in any total, breakdown, or chart data point — the tenant filter is applied at the repository/materialized-view query level before aggregation runs.

**AC-4 — Revenue dashboard date-range filter is inclusive and validated**
Given `from=2026-06-01` and `to=2026-06-30`,
When the endpoint is called,
Then payments with `paid_at` at the first and last instant of the range (tenant timezone) are both included; a request with `from > to` returns 422 `INVALID_DATE_RANGE` before any query executes.

**AC-5 — Revenue dashboard: zero data in range is a valid empty result, not an error**
Given a date range with zero captured payments,
When the endpoint is called,
Then the response is 200 with `totalPaise = 0` and an empty (or all-zero) breakdown — never a 404 or 500.

**AC-6 — Non-Finance/Owner/Admin/BranchMgr role cannot read the revenue dashboard**
Given a Counsellor or Faculty user with no `reports.revenue.view` permission,
When they call `GET /crm/reports/revenue`,
Then the API returns 403.

---

### WS-A2: Enrollment Trend Dashboard

**AC-7 — Enrollment trend counts reconcile with the enrollments table**
Given enrollments created within a date range for tenant T,
When `GET /crm/reports/enrollments?from=&to=` is called,
Then the returned per-period counts (e.g., weekly buckets) equal `COUNT(enrollments) WHERE enrolled_at BETWEEN range AND tenant_id = T`, grouped identically to the bucket definition documented in the response `meta`.

**AC-8 — Enrollment trend is branch-scoped for Branch Manager and assigned-scoped for Faculty**
Given Branch Manager M and Faculty F,
When each calls the enrollment trend endpoint,
Then M sees only Branch B's enrollments and F sees only enrollments in batches assigned to F; neither sees the other's or another tenant's rows.

**AC-9 — Enrollment trend: batch with zero enrollments in range renders as a zero bucket, not an omitted one**
Given a period bucket with zero enrollments,
When the dashboard is rendered,
Then that bucket is present in the series with value `0` (so the chart doesn't silently skip a period).

---

### WS-A3: Lead Funnel / Conversion Dashboard

**AC-10 — Funnel stage counts reconcile with the leads table**
Given leads for tenant T grouped by `stage`,
When `GET /crm/reports/funnel?from=&to=` is called,
Then each stage's count equals `COUNT(leads) WHERE stage = X AND created_at BETWEEN range AND tenant_id = T`, and the overall conversion rate (`won / total leads in range`) matches a direct recomputation.

**AC-11 — Funnel dashboard is own-scoped for Counsellor**
Given Counsellor C with leads assigned via `owner_id = C.id`,
When C calls the funnel endpoint,
Then only C's own assigned leads are counted; another counsellor's leads never appear in C's totals.

**AC-12 — Funnel dashboard is branch-scoped for Branch Manager**
Given Branch Manager M for Branch B,
When M calls the funnel endpoint,
Then only leads with `branch_id = B` are counted.

**AC-13 — Funnel dashboard cross-tenant IDOR**
Given Tenant A's leads and a Tenant B counsellor/owner,
When Tenant B's user calls the funnel endpoint,
Then Tenant A's leads never appear in any count or rate.

---

### WS-A4: Attendance Dashboard

**AC-14 — Attendance % reconciles with the attendance table**
Given a batch B with attendance rows,
When `GET /crm/reports/attendance?batchId=B` is called by an authorized user,
Then the returned attendance percentage equals `COUNT(status='present') / COUNT(*) WHERE enrollment_id IN (batch B's enrollments)`, matching a direct recomputation.

**AC-15 — Attendance dashboard: Faculty assigned-scope IDOR**
Given Faculty F is assigned to Batch B but not Batch C,
When F calls `GET /crm/reports/attendance?batchId=C`,
Then the API returns 404 (assigned-scope, IDOR-safe — consistent with the fail-closed pattern from P6 AC-64).

**AC-16 — Admin/Owner sees attendance across all batches (all-scope)**
Given an Admin user,
When the admin requests attendance without a `batchId` filter,
Then the response aggregates across all batches in the tenant, respecting only the tenant boundary.

---

### WS-A5: Course / Video Engagement Dashboard

**AC-17 — Video/lesson completion % reconciles with lesson_progress**
Given a course/module with lesson_progress rows,
When `GET /crm/reports/engagement?programId=` is called,
Then the completion percentage per lesson equals `COUNT(status='completed') / COUNT(enrolled students)` for that lesson, matching a direct recomputation.

**AC-18 — Per-lesson drop-off is surfaced**
Given a sequence of lessons in a module with decreasing completion counts,
When the engagement dashboard renders the module,
Then each lesson's completion count is shown in curriculum order, so a drop-off point (a lesson with a materially lower completion count than its predecessor) is visually identifiable — verified by the response including a `dropOffLessonId` or equivalent computed field when a configured drop-off threshold is crossed.

**AC-19 — Engagement dashboard is assigned-scoped for Faculty, all-scoped for Admin**
Given Faculty F is assigned to Batch B,
When F requests engagement data,
Then only students enrolled via Batch B are included; an Admin request includes all batches in the tenant.

---

### WS-A6: Campaign Performance Dashboard

**AC-20 — Campaign performance reconciles with campaigns.metrics and campaign_recipients**
Given campaign C with `campaign_recipients` rows in various statuses,
When `GET /crm/reports/campaigns?campaignId=C` is called,
Then `sent`, `delivered`, `read`, `failed` counts equal `COUNT(campaign_recipients) GROUP BY status WHERE campaign_id = C`, matching `campaigns.metrics` exactly (no drift between the cached metrics JSON and a live recount).

**AC-21 — Campaign performance dashboard is marketing/admin-scoped**
Given a Counsellor or Faculty user with no `campaigns.view` permission,
When they call the campaign performance endpoint,
Then the API returns 403.

**AC-22 — Campaign performance dashboard cross-tenant IDOR**
Given Tenant A's campaign and a Tenant B marketing user,
When Tenant B's user requests campaign performance by Tenant A's campaign id,
Then the API returns 404 (tenant-scoped lookup, not a cross-tenant 403 that would confirm existence).

---

### WS-A7: Gamification Participation Dashboard

**AC-23 — Gamification participation counts reconcile with points_ledger and user_badges**
Given a batch with students earning XP and badges,
When `GET /crm/reports/gamification?batchId=` is called,
Then "active earners" count, total XP distributed, and badge-award counts each equal a direct recomputation from `points_ledger`/`user_badges` for that batch's enrolled students.

**AC-24 — Gamification dashboard excludes PII beyond what CRM staff are already permitted to see**
Given the gamification dashboard is a **staff-facing** (CRM) view, not the PII-minimal student leaderboard,
When an authorized staff user (Admin/Faculty for assigned batch) requests it,
Then real student names/emails MAY appear (staff have legitimate access, unlike the P6 student-facing leaderboard) — but a Faculty member not assigned to the batch still receives 404 (assigned-scope IDOR unchanged).

**AC-25 — Leaderboard opt-out students still counted in aggregate stats, never named individually if opted out**
Given a student has `leaderboard_opt_in = false`,
When the CRM gamification dashboard computes aggregate totals (total XP, active-earner count),
Then that student's activity IS included in the aggregate numbers (opt-out affects only the public/peer-facing leaderboard, not internal staff reporting), but any per-student breakdown table in the CRM view must still be scoped as in AC-24.

---

### WS-A8: Forum Health Dashboard

**AC-26 — Forum health metrics reconcile with forum_threads/forum_posts**
Given a batch's forum activity,
When `GET /crm/reports/forum-health?batchId=` is called,
Then thread count, post count, reply rate (posts per thread), and resolution rate (`resolved threads / total threads`) each equal a direct recomputation from `forum_threads`/`forum_posts` for that batch.

**AC-27 — Forum health dashboard is assigned-scoped for Faculty, all-scoped for Admin**
Given Faculty F assigned to Batch B,
When F requests forum health for Batch C,
Then the API returns 404 (assigned-scope IDOR, consistent with P6 AC-64).

---

### WS-B: Reports + Exports

**AC-28 — HEADLINE: CSV-injection payloads are neutralized in every export**
Given a stored field value beginning with `=`, `+`, `-`, `@`, or a tab character (e.g.
a lead name of `=cmd|' /C calc'!A0` or a note of `+SUM(1+1)`),
When any CSV export (leads, students, payments, campaigns, forum, or any future export)
serializes that value into a cell,
Then the emitted cell is prefixed with a neutralizing character (e.g. a leading single
quote) via the shared `csvSafeCell()` helper before being written, so that opening the
file in Excel/Google Sheets does NOT execute it as a formula — verified by scanning the
raw exported bytes for any un-neutralized leading formula character.

**AC-29 — CSV-injection neutralization is a single shared choke-point, not per-export logic**
Given the codebase's export code paths,
When a static/lint-level test scans every CSV-writing call site,
Then every call site routes cell values through `csvSafeCell()` (or an equivalent single
shared function) — no export path implements its own ad hoc escaping.

**AC-30 — HEADLINE: Export never leaks data outside the requester's scope**
Given Branch Manager M for Branch B,
When M requests a student export,
Then the exported file contains zero rows for students in Branch C; the row count in
the file exactly equals the row count of M's scoped on-screen query for the same filter.

**AC-31 — Export column set never exceeds the requester's permitted fields**
Given a Marketing user exporting a campaign audience segment,
When the export is generated,
Then the file contains only the columns in the documented `CampaignAudienceExportDto`
allowlist — no `answer_key`, no payment method detail, no raw phone number unless the
Marketing role is explicitly permitted to view it on-screen for that same data.

**AC-32 — On-demand CSV export data matches the on-screen dashboard/report for the same filter**
Given a report viewed on-screen with filter F,
When the same filter F is used to trigger a CSV export,
Then every row and computed value in the export matches the on-screen data exactly (no
separate, potentially-inconsistent export query path).

**AC-33 — Large export streams/paginates instead of loading all rows into memory**
Given an export matching 50,000+ rows,
When the export job runs,
Then rows are streamed/paginated in bounded batches (not a single in-memory array); the
request either streams the response progressively or completes as a background job with
a downloadable link; no request timeout and no out-of-memory condition occurs.

**AC-34 — Export requires an explicit export permission, separate from view permission**
Given a user with `reports.<domain>.view` but not `reports.export`,
When they call the corresponding export endpoint,
Then the API returns 403; on-screen viewing continues to work.

**AC-35 — Export/report download is delivered via a signed, short-lived URL**
Given an export/report file has been generated and stored,
When the client is given a download link,
Then the link is a signed URL with an expiry (consistent with the `StorageProvider`
signed-URL pattern used for videos/certificates/invoices — no raw, permanently-guessable
object URL is ever returned).

**AC-36 — Export action is audit-logged**
Given any export is triggered (CSV or PDF, on-demand or scheduled),
When the export completes,
Then an `audit_logs` row is written with `actor`, `entity = 'export'`, the filters/scope
used, and the row count exported.

**AC-37 — Scheduled report respects the recipient's RBAC scope at send time, not at schedule-creation time**
Given a scheduled weekly revenue report configured for Branch Manager M of Branch B,
And M is reassigned to Branch C (or has their role changed) before the next scheduled
send,
When the scheduled job fires,
Then the report re-evaluates M's current scope at send time and reflects Branch C's
(or the current) data — it does not use a stale scope captured at schedule-creation
time.

**AC-38 — Scheduled report failure is logged and surfaced, not silently dropped**
Given a scheduled report's `MailProvider.send` call fails (e.g. transient provider
error),
When the failure occurs,
Then a structured log entry records the failure (without leaking secrets), and the
report is retried or the failure is surfaced in an admin-visible failure list — it is
never silently discarded with no trace.

**AC-39 — Empty scheduled-report result is handled gracefully**
Given a scheduled report's underlying query returns zero rows for the period,
When the report is generated and sent,
Then the email/report indicates "no data for this period" rather than an empty/broken
attachment or a suppressed send with no notice.

**AC-40 — PDF export (where offered) matches the same data-scope rules as CSV**
Given a PDF summary report is generated for a scoped user,
When the PDF is rendered,
Then it is subject to the same scope-isolation (AC-30) and permission (AC-34) rules as
CSV — no separate, less-guarded code path.

---

### WS-C: Observability

**AC-41 — `GET /health` returns liveness without leaking internals, unauthenticated**
Given an unauthenticated caller,
When `GET /health` is called,
Then the response is 200 with a minimal payload (e.g. `{ status: "ok" }`) — it MUST NOT
include package versions, stack traces, internal hostnames, database connection
strings, environment variable names/values, or any other internal implementation
detail.

**AC-42 — `GET /health/ready` reflects real dependency health**
Given the database or Redis is unreachable,
When `GET /health/ready` is called,
Then the response is 503 (not 200), while still containing no secret or internal detail
beyond a per-dependency boolean/status label (e.g. `{ db: "down", redis: "ok" }`).

**AC-43 — HEADLINE: Sentry captures errors without PII**
Given an error occurs during a request that included a user's email, phone, or an
`Authorization` header,
When the error is reported to Sentry,
Then a `beforeSend` scrubbing hook has stripped the email, phone, and any
`Authorization`/cookie/token header from the event payload before it leaves the
process — verified by an integration test that triggers a representative error and
inspects the (mocked) Sentry transport payload for absence of the seeded PII/secret
values.

**AC-44 — Correlation/request id is present on every request and echoed in errors**
Given any API request (with or without a client-supplied `X-Request-Id`),
When the request completes (success or error),
Then a correlation id is present in the response (as a header and, for errors, as a
field in the RFC-7807 body), and the same id appears in the structured log lines
emitted for that request.

**AC-45 — RFC-7807 error envelope is consistent across all endpoints**
Given any endpoint returns a 4xx/5xx error,
When the response body is inspected,
Then it conforms to the RFC-7807 shape (`type`, `title`, `status`, `detail`, plus the
correlation id field from AC-44) — no endpoint returns an ad hoc error shape.

**AC-46 — OpenTelemetry trace spans cross module and provider boundaries**
Given a request that triggers a chain of internal calls (e.g. a campaign send trigger →
`CampaignService` → `CampaignSendPort` → `MailProvider` adapter),
When the resulting trace is inspected,
Then a single trace contains a parent span for the HTTP request and child spans for the
service call and the provider adapter call — the trace is not fragmented into
disconnected spans.

**AC-47 — Structured logs never contain a provider secret, JWT, or password hash**
Given any log line emitted anywhere in the API,
When logs are scanned across a representative test run,
Then none contain `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `MSG91_AUTH_KEY`,
`RAZORPAY_KEY_SECRET`, `CERT_SIGNING_SECRET`, `NOTIFICATION_SIGNING_SECRET`, a raw JWT,
or an argon2 password hash — extending the AC-76 (P6) pattern to every P7-touched
surface.

**AC-48 — Structured logs mask email and phone**
Given a log line that would otherwise include a user's email or phone number,
When the log is emitted,
Then the value is masked (e.g. `j***@e***.com`, `+91XXXXX1234`) rather than logged in
cleartext — verified by an integration test asserting the masked pattern and the
absence of the raw seeded value.

**AC-49 — `/health` and `/health/ready` are exempt from auth but still rate-limited**
Given a client hammers `/health` at high frequency,
When the request rate exceeds a configured threshold,
Then the endpoint throttles (429) rather than allowing unbounded unauthenticated load
to consume resources or flood logs.

**AC-50 — Correlation id survives an async/background dispatch boundary**
Given a user-facing request enqueues or triggers a background/deferred dispatch (e.g. a
deferred notification send per the P6 quiet-hours mechanism),
When the deferred action eventually executes and logs its outcome,
Then the log line for the deferred action carries the same correlation id as the
originating request, so the two can be joined for diagnosis.

---

### WS-D: Performance SLOs

> **PROPOSED — needs user sign-off.** The concrete numbers in AC-51 through AC-56 are
> proposed targets grounded in `docs/00-product-strategy.md §7` (existing API/web/LMS
> targets) and `docs/04-trd-architecture.md §8` (100k-concurrent scalability levers).
> Confirm or adjust before `qa-engineer` builds tests against them.

**AC-51 — PROPOSED: existing API latency targets hold under P7 load** — p95 < 300ms
for reads, p95 < 800ms for writes (these targets are **not new**; they are restated
from `docs/00 §7` and re-verified under the P7 load test, WS-F).

**AC-52 — HEADLINE / PROPOSED: hot list endpoints have a bounded, constant query count (N+1 guard)**
Given the students directory, leads pipeline, forum threads list, and notifications
list endpoints,
When query-count instrumentation (e.g. a Prisma query-log counter in an integration
test) measures the number of SQL queries issued to render one page of results,
Then the query count is constant and bounded (**PROPOSED ceiling: ≤ 5 queries per page**
regardless of how many rows are on that page) — no per-row query loop (classic N+1) is
present.

**AC-53 — PROPOSED: dashboard aggregate endpoint budget**
Given a KPI dashboard endpoint (WS-A) backed by a materialized view/read replica,
When the endpoint is called with a representative dataset (e.g. 10k leads / 5k
students / 1k campaigns),
Then p95 latency is **< 500ms** (proposed — heavier than a plain read because it's an
aggregate, but bounded because it never hits the live write-path DB per LOCK-D1).

**AC-54 — PROPOSED: export latency budget**
Given an on-demand CSV export of ≤ 10,000 rows,
When the export completes,
Then p95 latency is **< 2s**; a PDF summary export completes with p95 **< 5s**.

**AC-55 — PROPOSED: LMS Lighthouse budgets**
Given the LMS is measured via Lighthouse CI on a mid-tier Android device profile over a
simulated 4G connection,
Then **LCP < 2.5s, INP < 200ms, CLS < 0.1, TTI < 3s** (restates and slightly extends
`docs/00 §7`'s existing LMS target with an explicit LCP/CLS number to match `web`'s
existing budget).

**AC-56 — PROPOSED: web Lighthouse SEO gate flips to hard-fail**
Given `apps/web`'s CI Lighthouse job currently runs with `continue-on-error: true`
(per `docs/phase-5-followups.md`),
Then in P7 the gate is flipped to hard-fail (`continue-on-error: false`) once the site
reliably scores **SEO ≥ 95** across three consecutive CI runs — the flip itself is the
AC; the ≥95 threshold is carried, not new.

---

### WS-E: Security Hardening Verification (one AC per carried follow-up)

**AC-57 — Auth endpoints gain an IP-dimension rate limit (closes P0 M-6, carried through P1–P6)**
Given more than a configured threshold of failed login attempts arrive from a single
source IP across multiple distinct target accounts within a rolling window,
When the next attempt from that IP arrives,
Then the request is throttled (429) regardless of which account is targeted — closing
the distributed credential-stuffing gap that was account-keyed-only since P0.

**AC-58 — Webhook endpoints are rate-limited per source IP (closes part of P6 M-3)**
Given the payment webhook (`POST /payments/webhook`) or campaign webhook
(`POST /campaigns/webhooks/:channel`) receives requests from a single source IP at a
rate exceeding a configured threshold,
When the threshold is exceeded,
Then subsequent requests from that IP are throttled (429) within the rate-limit
window, independent of HMAC signature validity (the rate limit is a pre-check).

**AC-59 — Webhook signature freshness window is enforced (closes part of P6 M-3)**
Given a webhook payload with a valid HMAC signature but a signature timestamp older
than a configured maximum age (e.g. 5 minutes),
When the webhook handler processes it,
Then the request is rejected (e.g. 401 `STALE_SIGNATURE`) even though the signature
itself is cryptographically valid — closing the indefinite-replay window.

**AC-60 — HEADLINE: bounce→suppression transition is strictly monotonic and idempotent under out-of-order delivery (closes part of P6 M-3)**
Given two bounce webhook events for the same recipient/channel are delivered
out of order (a later-timestamped bounce event arrives before an earlier-timestamped
one, due to network reordering or retry),
When both are processed by the webhook handler,
Then exactly one `notification_suppressions` row exists for that
`(user_id/email/phone, channel)` pair with `reason = 'bounce'`; processing the
earlier event after the later one does not create a duplicate row or regress any
already-applied state.

**AC-61 — SSE subscriber map is tenant-namespaced (closes the tenancy half of P6 M-1)**
Given the in-memory SSE subscriber map used by `GET /me/notifications/stream`,
When a subscription is registered,
Then the map key is `(tenantId, userId)`, not `userId` alone — verified by a unit test
asserting the key shape used by the subscriber-registration function.

**AC-62 — SSE per-user connection cap is enforced (closes the cap half of P6 M-1)**
Given a user already has the maximum allowed concurrent SSE connections
(**PROPOSED cap: 3**),
When that user opens one additional `GET /me/notifications/stream` connection,
Then either the oldest connection is evicted or the new connection is rejected with a
clear error — the subscriber map never accumulates unbounded entries for a single user.

**AC-63 — SSE implementation docstring matches shipped behavior (closes the docstring half of P6 M-1)**
Given the SSE handler's code comments,
When reviewed,
Then the docstring accurately describes the actual in-memory-map-plus-polling-fallback
behavior and does not claim an unimplemented "DB poll" mechanism — verified by
code review, not a runtime test; listed here so `qa-engineer`'s P7 checklist tracks it
to closure.

**AC-64 — HEADLINE: DPDP erasure reaches audit_logs PII (closes P5 L-1 + P6 L-2)**
Given a data-erasure ("right to be forgotten") request is approved and processed for
User U,
When the erasure job runs,
Then every `audit_logs` row whose `before`/`after` JSON snapshot contains U's raw
phone number, email address, or other direct identifier has those specific fields
replaced with a redaction marker (e.g. `"[REDACTED]"`) or a stable one-way hash; the
`audit_logs` row itself is **NOT deleted** (append-only audit integrity is preserved —
only the PII fields within the snapshot are redacted); the erasure action itself
writes a new `audit_logs` row recording that the erasure occurred.

**AC-65 — DPDP erasure is permission-gated and cannot be triggered for another user by a non-privileged caller**
Given a non-privileged authenticated user U1,
When U1 attempts to trigger an erasure request for a different user U2's data,
Then the API returns 403 (or the request only succeeds for U1's own data, or for an
admin holding a dedicated `dpdp.erasure.execute` permission acting on U2's behalf with
an audit trail of who authorized it).

**AC-66 — DPDP erasure's table coverage is exhaustive and fails loud, not silent, on an unknown PII-bearing table**
Given the erasure job's configured list of PII-bearing tables/columns,
When a new table with a PII column is added to the schema without being registered in
the erasure job's coverage list,
Then a CI-level check (schema-vs-erasure-coverage diff, or an explicit allowlist test)
fails loudly rather than the erasure silently missing that table.

**AC-67 — Security headers are present on all API responses**
Given any API response,
When headers are inspected,
Then Content-Security-Policy, `X-Content-Type-Options: nosniff`,
`X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, and (in non-dev environments)
`Strict-Transport-Security` are all present — verified by an integration test
asserting header presence on a representative sample of endpoints across `web`, `lms`
API-facing routes, and the `api` service itself.

**AC-68 — No unresolved critical/high-severity dependency vulnerability at merge time**
Given the CI dependency-scan job (`pnpm audit` or equivalent, e.g. Dependabot/Snyk),
When it runs on any PR,
Then it fails the build if a critical or high-severity advisory is found in a
production dependency with no documented, explicitly-accepted exception; any accepted
exception is recorded (not silently ignored) with a justification and a re-check
date.

**AC-69 — Secrets never appear in dependency-scan output or CI build artifacts**
Given the CI pipeline's build-artifact secret scan (extending the AC-76/P6 pattern),
When it runs against all P7-added endpoints/services,
Then no provider secret, signing secret, or credential appears in any built artifact,
log, or scan output.

---

### WS-F: Load Test

**AC-70 — HEADLINE: load test models the core journeys under concurrent ramp**
Given a k6 load-test suite (per `docs/04-trd-architecture.md §6`) configured with the
following journeys:
1. anonymous browse → lead-capture (`web`),
2. student login → dashboard → video-stream-URL mint → lesson-progress ping (`lms`),
3. CRM staff dashboard/report read (`crm`),
4. payment order-create → webhook-verify (test-mode, `web`/`api`),

When the test ramps concurrency toward the **PROPOSED** target — 10,000 concurrent
learners / 1,000 concurrent video-stream-URL mints / 100 concurrent CRM staff sessions
(per `docs/00 §7`) — and sustains the peak for a defined window,
Then the pass/fail thresholds in AC-71 hold throughout the ramp and the sustained-peak
window.

**AC-71 — PROPOSED: pass/fail thresholds for the load test**
Given the load test run from AC-70,
Then: error rate **< 1%** across all journeys; p95 latency **< 300ms** (reads),
**< 800ms** (writes), **< 500ms** (dashboard aggregate reads, per AC-53); p99 **≤ 1.5×**
the respective p95 ceiling; no 5xx error spike correlated with connection-pool or
garbage-collection exhaustion.

**AC-72 — Load test documents a capacity ceiling for planning purposes**
Given the load test ramps beyond the point where AC-71's thresholds hold,
When the report is generated,
Then it explicitly states the concurrency level at which p95 latency first exceeds
threshold, giving a documented capacity ceiling ahead of the 100k-registered /
10k-concurrent target (`docs/00 §7`) — this is informational, not itself a pass/fail
gate.

**AC-73 — Load test never touches a live payment gateway**
Given the payment journey in the load test,
When it runs,
Then it exclusively uses Razorpay **TEST mode** (`rzp_test_*` keys) — consistent with
the carried decision that Razorpay remains in TEST mode (`docs/phase-5-followups.md`,
`docs/phase-6-followups.md`) — no live charge is ever attempted by the load test.

**AC-74 — Load test results are archived and diffable across phases**
Given a load test run completes,
When results are stored,
Then the report is archived tagged with the git commit SHA and run date, so a future
phase's load test can be diffed against this one to detect regressions.

---

## Part 4 — Edge Cases and Error States

### WS-A: KPI Dashboards

| Scenario | Expected behavior |
|----------|-------------------|
| Dashboard query is in-flight | UI shows a loading skeleton (per `@repo/ui` Skeleton), not a blank panel or stale data with no indicator |
| Materialized view has not refreshed since data changed | Dashboard surfaces a "data as of HH:MM" freshness indicator rather than silently presenting stale numbers as current |
| Materialized-view refresh job fails | Dashboard falls back to the last-known-good refresh and surfaces a visible staleness warning; it does not 500 |
| Date range spans a period before the tenant existed / before any data | Returns a valid empty/zero result, not an error |
| Branch filter selects a branch the caller cannot access (Branch Manager selecting another branch's ID) | 404, not 403 (IDOR-safe, consistent with the rest of the platform) |
| Chart data point count is very large (e.g., daily granularity over 2 years) | Response is paginated/bucketed server-side (e.g., auto-coarsens to weekly/monthly); the client never receives an unbounded array |
| Two dashboards disagree (e.g., Overview widget revenue vs. Revenue dashboard total for the same range) | Not possible by construction — both read from the same materialized view/aggregate function; a regression test asserts numeric equality between the two surfaces |

### WS-B: Reports + Exports

| Scenario | Expected behavior |
|----------|-------------------|
| Export requested for a report the caller cannot view | 403 before any query runs |
| Export matches zero rows | A valid, empty CSV/PDF is generated (header row only for CSV) — not an error |
| Export generation throws mid-stream | The partial file is discarded; the caller receives an error, not a truncated, silently "complete" download |
| Two users trigger a scheduled report send at the exact same instant (race) | Idempotent — each user's own scheduled report definition fires independently; no cross-user data mixing |
| CSV cell value is exactly `=` (just the character, no formula) | Still neutralized per the shared helper — the rule is "starts with a formula-trigger character," not "looks like a valid formula" |
| Recipient's email for a scheduled report is on the `notification_suppressions` list | The scheduled report send honors suppression (reuses P6 Rule C-2) and does not send; the admin sees a skipped/suppressed status, not a silent failure |

### WS-C: Observability

| Scenario | Expected behavior |
|----------|-------------------|
| Sentry SDK itself is unreachable/misconfigured | The application does not crash or block the request; error reporting fails silently (logged locally) while the user-facing response still returns |
| A request has no `X-Request-Id` header supplied by the client | The server generates one and returns it; it is never left blank |
| A trace span for a provider call throws | The span is marked errored in the trace, not dropped/orphaned |
| Log volume spikes under load | Structured logging remains bounded (no unbounded per-request payload logging) — verified alongside the load test (WS-F) |

### WS-D: Performance

| Scenario | Expected behavior |
|----------|-------------------|
| A hot list endpoint's page size is increased (e.g. from 20 to 100 rows) | Query count remains constant (AC-52); only row-fetch volume grows, not query count |
| Dashboard aggregate is requested for a tenant with an unusually large dataset (e.g. 100k+ leads) | Still served from the materialized view/read replica — p95 budget (AC-53) still applies; if a specific dashboard cannot meet budget at that scale, it is flagged as a capacity-ceiling finding (AC-72), not silently accepted as "slow is fine" |
| Lighthouse CI run is flaky (fails once, passes on retry) | CI retries once before failing the gate; a single flaky run does not block merge, but a persistent failure does |

### WS-E: Security Hardening

| Scenario | Expected behavior |
|----------|-------------------|
| Legitimate high-volume webhook source (the actual provider) is rate-limited by the new per-IP webhook limiter | The configured threshold is set well above expected legitimate provider volume (documented in the provider's rate-limit config); a false-positive block is a config bug to fix, not an acceptable outcome |
| DPDP erasure requested for a user with an active enrollment/order/certificate | Business-record rows (enrollments, orders, certificates) are NOT deleted (they are legitimate financial/academic records) — only direct-identifier PII fields across the erasure job's registered tables (including `audit_logs` snapshots) are redacted/hashed per AC-64; the exact table/field list is a `db-architect` deliverable reviewed by `security-reviewer` |
| Two erasure requests for the same user are triggered concurrently | Idempotent — the second run is a no-op (fields are already redacted); no error, no double-processing artifact |
| Webhook freshness-window rejection (AC-59) fires for a legitimately-delayed webhook (provider retry backlog) | The freshness window is configurable and set generously (e.g. minutes, not seconds) to avoid rejecting legitimate delayed retries; documented in config, not hardcoded |

### WS-F: Load Test

| Scenario | Expected behavior |
|----------|-------------------|
| Load test environment differs from production sizing | The report explicitly states the test environment's specs (instance size, DB tier, replica count) alongside results, so results are interpretable, not presented as an unconditional production guarantee |
| Load test triggers real email/SMS/WhatsApp sends | Test-mode/Noop providers are used for all notification channels during the load test — no real message volume is sent to real recipients |
| Load test itself causes a rate-limit false-positive against its own synthetic traffic | Test traffic uses a distinct, documented source-IP range or a load-test bypass flag (test-environment only, never enabled in production) so the new IP-rate-limiting (AC-57/58) doesn't invalidate the load test — this bypass must not exist in the production build |

---

## Part 5 — Scope Boundary (In vs. Out)

### In Scope (P7)

| Workstream | What ships |
|-----------|------------|
| WS-A KPI Dashboards | Revenue, enrollment trend, lead funnel/conversion, attendance, course/video engagement, campaign performance, gamification participation, forum health — each tenant + RBAC scoped, with loading/empty/error states and date-range (+ branch, where applicable) filters |
| WS-B Reports + Exports | On-demand CSV + PDF export, scheduled report emails (reusing the P6 Resend sync-seam), CSV-injection-safe shared export helper, scope-isolated + column-allowlisted exports, streamed/paginated large exports, signed download links, export audit logging |
| WS-C Observability | `/health` + `/health/ready`, correlation/trace id on every request + RFC-7807 error, Sentry PII-scrubbing hook, OpenTelemetry trace propagation across module/provider boundaries, pino log redaction (secrets) + masking (email/phone) |
| WS-D Performance SLOs | Concrete (PROPOSED, pending sign-off) latency/Lighthouse budgets; N+1/query-count guard on hot list endpoints; Lighthouse SEO gate hard-fail flip |
| WS-E Security Hardening | IP-dimension auth rate limiting (P0 M-6), webhook IP rate limiting + freshness window + monotonic bounce→suppression (P6 M-3), SSE tenant-namespacing + connection cap + docstring fix (P6 M-1), DPDP erasure reaching `audit_logs` (P5 L-1/P6 L-2), security headers, dependency-vuln CI gate |
| WS-F Load Test | k6 journeys (browse→lead, login→stream→progress, CRM dashboard read, test-mode payment verify), concurrency ramp toward the PROPOSED 100k-aligned target, pass/fail thresholds, documented capacity ceiling |

### Explicitly Out of P7 (with justification)

| Item | Deferred to | Recorded conflict |
|------|-------------|-------------------|
| Certificate template designer UI | Content-authoring phase (no date) | CONFLICT-P7-1 |
| Global search (tsvector/Meilisearch) across programs/blog/forum | Search-specific phase / P8 | CONFLICT-P7-2 |
| Support ticket system + ticket dashboards | Later (requires `tickets` table to be built first) | CONFLICT-P7-3 |
| Bookmarks (LMS convenience) | Later forum/LMS-depth phase | CONFLICT-P7-4 |
| AI mentor, multi-tenant SaaS onboarding, recruiter/college/parent portals | P8 | Per `CLAUDE.md §6` |
| Live-class scheduling, referral/affiliate program logic, marketing automation builder | Carried P6 outs (`CONFLICT-P6-1/2/3/4`) | No new conflict — unchanged |
| Real Cloudflare Stream / video provider activation, `hls.js` browser approval | Blocked on credential rotation (carried since P3) | No new conflict — unchanged |
| Full BullMQ/Redis-pub-sub migration (notifications, campaigns, reports) | Documented migration path remains unbuilt; sync-seam still default | No new conflict — SSE fix (LOCK-D5) does not require it |
| New student-facing (LMS) analytics UI | Not requested; P6 Progress/leaderboard is the current student-facing surface | No conflict |
| DataTable row virtualization as a standalone deliverable | Used as an implementation technique to satisfy export/report perf ACs where needed; not a separate feature | No conflict |
| Certificate reissue partial-unique migration, live-class attendance, other carried db/product items | Opportunistic pickup only, not gated by this spec | No conflict |
| CRM automated test infra | Carried gap (P4/P5/P6) — QA may stand up opportunistically; not a P7 gate | Carried |
| Playwright browser e2e | Carried stub since P1 | Carried |
| **P6 deferred testcontainers/axe backfill** (AC-6/27/44/56 integration specs + cross-tenant isolation + axe on NotificationBell/CampaignBuilder/BadgeGrid/LeaderboardTable/PostThread) | **Recommended early-P7 wave, but not a P7 analytics/hardening AC in this spec** — tracked as a QA backlog item inherited from `docs/phase-6-followups.md`, to be picked up by `qa-engineer` alongside or before this phase's own test authoring | Carried (not a new conflict) |

---

## Part 6 — Conflict Log

| Conflict ID | PRD/followup reference | What it says | P7 gate decision | Resolution |
|-------------|------------------------|---------------|-------------------|------------|
| CONFLICT-P7-1 | `docs/phase-4-followups.md` CONFLICT-2 | Certificate template designer UI deferred "to P7" | Designer UI is OUT of P7 | It's a content-authoring feature, not analytics/hardening; deferred again to a dedicated content-authoring phase |
| CONFLICT-P7-2 | `docs/phase-5-followups.md` CONFLICT-P5-4, `docs/phase-6-followups.md` | Full-text search deferred "to P7 (tsvector/Meilisearch)" | Search is OUT of P7 | It's a discovery feature, not analytics/hardening; deferred to a search-specific phase or P8 |
| CONFLICT-P7-3 | `docs/03-prd-crm.md §7.1`, `§7.15` | Overview dashboard lists "open tickets"; full help-desk module specified | Ticket dashboards OUT of P7 | `tickets` table is still spec-only (`docs/05 §10`); cannot build a dashboard on a table that doesn't exist. Overview dashboard AC in this phase excludes the tickets widget |
| CONFLICT-P7-4 | `docs/phase-6-followups.md` | Bookmarks deferred "to P7" | Bookmarks OUT of P7 | LMS convenience feature, not analytics/hardening; deferred again |

---

## Part 7 — Observability / Export / Erasure Rules (Testable)

These rules are enforced by the service layer and are not overridable by any request
parameter.

**Rule H-1 (CSV-injection neutralization):**
Any cell value beginning with `=`, `+`, `-`, `@`, or a tab/CR character is prefixed with
a neutralizing character before being written to any exported CSV, via the single shared
`csvSafeCell()` helper. Verified by AC-28, AC-29.

**Rule H-2 (export scope isolation):**
Every export query is built from the same scope-filtered query used for the on-screen
equivalent view — there is no separate, potentially broader "export query" code path.
Verified by AC-30, AC-31, AC-32.

**Rule H-3 (no internal leakage on health endpoints):**
`/health` and `/health/ready` never return package versions, stack traces, connection
strings, or environment variable contents, regardless of authentication state. Verified
by AC-41, AC-42.

**Rule H-4 (PII never in logs, errors, or Sentry events):**
Email and phone are masked in structured logs; provider secrets/JWTs/password hashes
never appear in logs, error responses, or Sentry event payloads. Verified by AC-43,
AC-47, AC-48.

**Rule H-5 (DPDP erasure preserves audit integrity while removing PII):**
An erasure request redacts direct-identifier PII fields inside `audit_logs`
before/after snapshots (and any other table holding that user's PII) without deleting
the `audit_logs` rows themselves — the audit trail's existence and shape survive;
only the PII values inside it are removed. Verified by AC-64, AC-65, AC-66.

**Rule H-6 (rate limiting is IP-aware everywhere credential/webhook abuse is possible):**
Auth endpoints and webhook endpoints are rate-limited on the source-IP dimension in
addition to any existing account/message-id dimension. Verified by AC-57, AC-58.

---

## Part 8 — Data and Permissions Impact

### Schema/data impact (no new core business tables — this phase is compute + verification, not new entities)

| Item | Nature | Notes |
|------|--------|-------|
| Materialized views (revenue, enrollment, funnel, attendance, engagement, campaign, gamification, forum-health) | New — `db-architect` owns definitions + refresh strategy | Read-replica or scheduled-refresh; never queried from the write-path connection pool (LOCK-D1) |
| `audit_logs` erasure-redaction pass | Behavior change on existing table, no schema change required (JSON field values are redacted in place) | `db-architect` defines the exhaustive PII-bearing table/column registry consumed by the erasure job (AC-66) |
| Export/report job metadata (if a durable export-job record is needed for large/background exports) | Possibly new — `db-architect` decides whether a lightweight `export_jobs` table (or reuse of existing infra) is warranted for AC-33's background-job path | Follows the standard §1 conventions (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`) if created |
| SSE subscriber map key change | In-memory data structure change only, no DB schema impact | `(tenantId, userId)` keying + connection cap (AC-61, AC-62) |

### RBAC Permissions (new entries in `role_permissions`)

| Permission | Student | Faculty | Branch Mgr | Counsellor | Finance | Marketing | Admin/Owner |
|------------|:-------:|:-------:|:----------:|:----------:|:-------:|:---------:|:-----------:|
| `reports.revenue.view` | — | — | branch | — | all | — | all |
| `reports.enrollment.view` | — | assigned | branch | — | — | — | all |
| `reports.funnel.view` | — | — | branch | own | — | — | all |
| `reports.attendance.view` | — | assigned | branch | — | — | — | all |
| `reports.engagement.view` | — | assigned | branch | — | — | — | all |
| `reports.campaigns.view` | — | — | — | — | — | all *(reuses P6 `campaigns.view`)* | all |
| `reports.gamification.view` | — | assigned | — | — | — | — | all |
| `reports.forum.view` | — | assigned | — | — | — | — | all |
| `reports.export` | — | assigned *(own domains)* | branch | own *(funnel only)* | all *(revenue)* | all *(campaigns)* | all |
| `dpdp.erasure.execute` | — | — | — | — | — | — | all |
| `observability.health.view` | public *(liveness only)* | public | public | public | public | public | all *(readiness detail)* |

Data scope semantics (unchanged from P0–P6):
- `own` = resource tied to `currentUser.id` (e.g. counsellor's assigned leads); IDOR→404
  for mismatched user.
- `assigned` = faculty `batch.faculty_id = currentUser.id`; IDOR→404 for unassigned
  batch.
- `branch` = `branch_id` matches the Branch Manager's assigned branch; IDOR→404 for a
  different branch.
- `all` = tenant-wide, still tenant-scoped; IDOR→404 across tenants.

---

## Part 9 — Dependencies (Agents and Modules)

| Dependency | Source | Consumed by |
|------------|--------|-------------|
| Read replica + materialized-view infra | `docs/05 §8`, P0 infra | WS-A all dashboards |
| `campaigns.metrics` / `campaign_recipients` (P6) | P6 marketing module | WS-A6 campaign performance dashboard |
| `points_ledger` / `user_badges` / `gamification_prefs` (P6) | P6 gamification module | WS-A7 gamification dashboard |
| `forum_threads` / `forum_posts` (P6) | P6 forum module | WS-A8 forum health dashboard |
| `payments` / `orders` / `invoices` ledger (P2) | P2 commerce module | WS-A1 revenue dashboard, WS-B revenue export |
| `leads` / `activities` (P2) | P2 CRM module | WS-A3 funnel dashboard |
| `attendance` (P3) | P3 LMS core | WS-A4 attendance dashboard |
| `lesson_progress` (P3) | P3 LMS core | WS-A5 engagement dashboard |
| `MailProvider`/Resend sync-seam (P6, ADR-0039/0040) | P6 integrations | WS-B scheduled report send |
| `StorageProvider` signed-URL pattern (P0/P3/P4, ADR-0027) | P0/P3/P4 | WS-B export/report signed download links |
| Sentry / OpenTelemetry / pino (declared, `docs/04 §2.13`) | P0 infra (partially wired) | WS-C observability |
| `@RequirePermission` + `PermissionsGuard` + `ScopeInterceptor` | P0/P1, ADR-0009/0018/0022/0031 | All WS-A/B RBAC + scope enforcement |
| Soft-delete + audit Prisma extensions | P0, ADR-0005 | WS-E DPDP erasure (redaction, not hard delete) |
| SSE subscriber map (P6, ADR-0043) | P6 notifications module | WS-E AC-61/62/63 (tenancy + cap fix) |
| Webhook HMAC verification (P4/P6, ADR-0040) | P4/P6 | WS-E AC-58/59/60 (webhook hardening) |
| `@repo/types` zod DTOs | api-designer | All new report/export DTOs |
| `@repo/api-client` SDK (regenerated) | api-designer | CRM frontend dashboard/report/export screens |
| `@repo/ui` chart wrappers, KPI cards, EmptyState, Skeleton (`docs/04 §3.1`) | design-system | WS-A dashboard UI, WS-B export UI |
| k6 (`docs/04 §6`) | devops/qa tooling | WS-F load test |
| CI dependency-scan tooling (`pnpm audit`/Dependabot/Snyk) | devops | WS-E AC-68 |
| DataTable row virtualization seam (ADR-0012) | design-system/frontend-builder | Optional implementation aid for large report tables (WS-B), not a standalone AC |

---

*Spec authored by `product-manager` for Phase 7, Task #0. Effective date: 2026-07-04.*
