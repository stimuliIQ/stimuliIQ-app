# Plan: Phase 7 — Analytics + Hardening

> Owner: orchestrator. Executes after P0–P6 GO. Scope per `CLAUDE.md §6` (P7 =
> "dashboards, reports, perf, security audit, load test") + harvest of all
> `docs/phase-0..6-followups.md` carried Medium/Low items. Every task DoD references
> `CLAUDE.md §4`.

---

## DECISIONS NEEDED (batch-ask before execution)

These are genuine forks or ask-before-install items. Nothing in Wave 1+ starts until
these are answered.

1. **Analytics read model.** Recommend: indexed on-the-fly queries + Redis cache-aside for
   most KPIs, plus **Postgres materialized views** (revenue, lead-funnel, completion,
   attendance) refreshed on a schedule with `REFRESH … CONCURRENTLY`. Alternative:
   event-updated summary/rollup tables. Confirm MV approach + refresh cadence (e.g. 5 min).
2. **Read replica.** `docs/05 §8` + `docs/03 §16/§18` assume analytics run on a **read
   replica**. Is a replica provisioned for P7, or do we run analytics on the primary
   (MV + cache) and defer the replica to deploy time? (Affects db-architect connection wiring.)
3. **Scheduled reports + MV refresh — introduce BullMQ now, or `@nestjs/schedule` cron?**
   Memory `p6-decisions` chose the sync-seam (no BullMQ). Recommend staying consistent:
   `@nestjs/schedule` cron for MV refresh + scheduled-report dispatch, keeping the BullMQ
   migration seam documented (ADR-0020/0039). Confirm — this is a standing-architecture call.
4. **Observability backend.** Sentry SaaS vs self-hosted (GlitchTip)? OTel collector target
   (Grafana Tempo / Honeycomb / self-hosted OTLP)? SDKs are **already installed** in
   `apps/api` (`@sentry/node`, `@opentelemetry/*`, `nestjs-pino`) — this decision only
   supplies `SENTRY_DSN` / `OTEL_EXPORTER_OTLP_ENDPOINT` + vendor choice. Also: activate in
   staging/prod only, or exercise in a test env too?
5. **Load-test SLOs.** Confirm targets from `docs/00 §7`: 100k registered / **10k concurrent
   learners** / **1k concurrent streams**; API **p95 < 300 ms reads / < 800 ms writes**;
   video start < 2 s. Confirm pass/fail thresholds and that k6 runs against a **dedicated
   staging env** (NOT CI, NOT prod, NOT the TEST-mode Razorpay path with real charges).
6. **Lighthouse / axe warn → gate.** P5 left `web-lighthouse` + `web-axe` as
   `continue-on-error: true`. Flip `apps/web` to hard-fail now? Add + gate `apps/lms`
   Lighthouse budgets (TTI < 3 s mid-tier Android / 4G per `docs/00 §7`)?
7. **DPDP right-to-erasure vs audit immutability.** P5 L-1 / P6 L-2: raw phone/email sit in
   `audit_logs.after`. Erasure workflow options: (a) hash/redact PII in the audit `after`
   snapshot at **write time** going forward (keeps audit append-only), (b) a privileged
   erasure job that anonymizes audit rows referencing an erased subject. Pick the policy —
   it trades PII-minimization against audit immutability (`CLAUDE.md §3.4`, `docs/05 §6`).
8. **New dependencies (ask-before-install, `CLAUDE.md` standing rule).**
   - **`recharts`** in `@repo/ui` — charting lib for CRM dashboards. `@repo/ui` has **no
     chart primitive today** (TRD §3.1 lists "Chart wrappers" as unbuilt). Recommended
     (shadcn-standard, React 19 compatible). **Blocks the CRM dashboards.**
   - **`k6`** (Grafana k6 binary / CI tool, not an npm runtime dep) for load tests.
   - **`@nestjs/schedule`** — only if cron is chosen in Decision 3.
   - CSV export: prefer a **hand-rolled RFC-4180 writer with injection guard** (no new dep)
     over `csv-stringify`; confirm. PDF reports reuse the existing `@react-pdf/renderer`
     (already pinned in `apps/api`) + `@aws-sdk/client-s3` (already present).
   - Sentry / OTel / pino: **already installed — no new approval**, just activation.

---

## Goal & success criteria

- CRM analytics dashboards (revenue, enrollment, lead-funnel, attendance, course-engagement,
  campaign-performance) live, **RBAC + tenant + branch/assigned/own scoped**, every number
  traceable to source rows (`docs/00 §10.2`, `docs/03 §7.14`, `§20` AC).
- On-demand + scheduled **CSV/PDF exports** with **CSV-injection + at-sink XSS** controls
  (pays down P5 M-3 / P6 M-4 / P2 M-4).
- Observability live: OTel traces across modules+providers, Sentry errors, pino
  request/tenant/user context, **readiness** (DB+Redis ping) + **RED/USE metrics** endpoints.
- Performance hardening: N+1 audit, index review, Redis cache + cursor pagination on hot
  reads, payload trimming; Lighthouse budgets enforced per Decision 6.
- Consolidated **security sweep** paying down the harvested P0–P6 Mediums/Lows in grouped
  buckets, verified by security-reviewer in one pass.
- **k6 load test** modeling the 100k target on the hottest paths, with defined SLOs.
- Deferred P6 **testcontainers integration + axe** specs (AC-6/27/44/56, AC-72–75) authored.

## Preconditions (what must already exist)

- P0–P6 shipped (GO): auth/RBAC + ScopeInterceptor, CRM CRUD, commerce, leads/enrollment,
  LMS, learning-depth, public funnel, engagement. api unit **1038/53 green**; turbo 23/23.
- Observability SDKs installed (`apps/api/package.json`); `observability/{otel,sentry,logger}.ts`
  present but **stubbed/no-op**; `health` module exists (liveness only, no readiness).
- StorageProvider (`@aws-sdk/client-s3` + presigner) + `@react-pdf/renderer` present.
- Raw tracking rows already written (P6): `campaign_recipients.status`, `points_ledger`,
  `campaigns.metrics`, forum counts, `lesson_progress`, `attendance`, `orders`/`payments`.
- `@repo/ui` has **no chart primitive** (blocker → Decision 8).

---

## Task graph

| # | Task | Owner agent | Depends on | Parallel group | DoD (+ `CLAUDE.md §4`) |
|---|------|-------------|-----------|----------------|------|
| 1 | **Analytics read model** — MV/summary strategy (Decision 1/2), tenant-scoped aggregates for revenue/enrollment/funnel/attendance/engagement/campaign; `REFRESH CONCURRENTLY`; supporting indexes; money stays integer paise | db-architect | Decisions 1,2 | W1 | Migrations forward-only + reviewed; every aggregate carries `tenant_id`; refresh path documented; reconciles to source rows; `§4` |
| 2 | **Index / N+1 supporting indexes** — review hot read paths (dashboards, rosters, pipeline, catalog) incl. the raw-SQL partial-unique patterns; add covering indexes | db-architect | — | W1 | `EXPLAIN` notes for each new index; no dupes; migration reviewed; `§4` |
| 3 | **Cert reissue partial-unique migration (P4 M-2)** — `UNIQUE(enrollment_id) WHERE deleted_at IS NULL`; reissue soft-deletes old row | db-architect | — | W1 | Forward-only migration; reissue preserves revoked row in audit; `§4` |
| 4 | **Analytics/reports/export/observability contracts** — zod DTOs in `@repo/types`: metric envelopes, date-range + branch/scope filter params, export request/status, report-schedule; health/readiness + RED/USE metrics response shapes | api-designer | — | W1 | Schemas in `@repo/types`, imported FE+BE; OpenAPI registered; `§4` |
| 5 | **`@repo/ui` chart primitives** — KPI stat card, line/area/bar/funnel/donut wrappers; a11y (no color-only, data-table fallback, labelled series); dark-mode tokens | design-system | Decision 8 (recharts) | W1 | axe-clean; unit tests; loading/empty/error variants; `§4` (a11y) |
| 6 | **Pay-down P6 deferred tests** — testcontainers integration for AC-6/27/44/56 + cross-tenant AC-72–75; axe on NotificationBell/CampaignBuilder/BadgeGrid/PostThread | qa-engineer | — | W1 | Specs green in CI; axe clean; `§4` |
| 7 | **Analytics query + service layer** — read the MV/read-model; RBAC + scope filters (all/branch/assigned/own); Redis cache-aside w/ explicit invalidation; every metric traceable | backend-builder | 1,4 | W2 | Server-side scope enforced (never client); cache invalidation on write; integration tests incl. scope isolation; `§4` |
| 8 | **Reports + exports** — on-demand + scheduled CSV/PDF via StorageProvider + `@react-pdf/renderer`; signed download links; **CSV-injection guard + at-sink output-encoding** (pays P5 M-3 / P6 M-4 / P2 M-4) | backend-builder | 1,4 | W2 | Formula-prefix (`=+-@\t\r`) neutralized; signed/expiring links; RBAC-scoped; audit on export; tests incl. injection payloads; `§4` |
| 9 | **Observability wiring** — behind interface where vendor-specific (`ObservabilityProvider`/`ErrorReporter`): activate OTel spans across modules+providers, Sentry capture, pino request-id/tenant/user context; **readiness** (DB+Redis) + **RED/USE metrics** endpoints | integrations + backend-builder | 4 | W2 | Traces span provider calls; no secrets/PII in logs; readiness fails closed on dep down; Noop when unconfigured; `§4` |
| 10 | **Performance hardening** — N+1 audit + fix, cursor pagination completeness, Redis cache on catalog/curriculum/dashboards, payload trimming, DataTable virtualization seam (ADR-0012) | backend-builder + frontend-builder | 2 | W2 | Before/after query counts; p95 measured; no over-fetch; `§4` |
| 11 | **Report scheduling** — MV refresh + scheduled-report dispatch (cron or BullMQ per Decision 3); idempotent; observable | backend-builder | 1,8, Decision 3 | W2 | Schedule fires idempotently; failures logged/retried; `§4` |
| 12 | **Security hardening batch A (auth/rate-limit/webhook)** — P0 M-6 IP-dim rate limit, P4 M-6/P6 M-3 webhook per-IP throttle + signature freshness window + monotonic idempotent bounce→suppression, P2 L-4, argon2id cost pinning, JWT `aud` (M-4), inactive-account enumeration (M-5) | backend-builder | — | W2 | Fail-closed limiters; tests for each; uniform error responses; `§4` |
| 13 | **Security hardening batch B (SSE/RBAC/tenant/DPDP)** — P6 M-1 SSE tenant-key + per-user cap + docstring fix; S1-1 system-role matrix guard; P2 M-3/M-5 scope fixes; PII read-audit (S1-2); DPDP erasure covering `audit_logs` (P5 L-1/P6 L-2, per Decision 7); soft-delete-bypass lint rule | backend-builder | Decision 7 | W2/W3 | SSE map tenant-namespaced + capped; read-audit on PII; erasure policy implemented; `§4` |
| 14 | **CRM analytics dashboards** — revenue / enrollment / lead-funnel / attendance / course-engagement / campaign-performance; role-aware widgets; date-range + branch filters; drill-to-source | frontend-builder | 5,7 | W3 | RBAC-aware render (hides forbidden); loading/empty/error each widget; a11y; numbers reconcile; `§4` |
| 15 | **CRM reports & export UI** — request/download CSV/PDF, schedule management, export history | frontend-builder | 8,11 | W3 | Signed-link download; scope-aware; a11y; `§4` |
| 16 | **Observability infra + CI perf gates** — provision collector/DSN config (Decision 4), dashboards/alerts, flip Lighthouse/axe warn→gate (Decision 6), add `apps/lms` budgets, dependency audit in CI | devops | 9, Decisions 4,6 | W4 | Gates enforced or explicitly deferred with reason; alerts fire on RED/USE breach; `§4` |
| 17 | **k6 load test** — model 100k target (Decision 5) on hottest paths: auth, video-url mint, LMS dashboard, public funnel, notification fan-out; define + assert SLOs | qa-engineer | Decision 5,8(k6) | W4 | Scripts + SLO thresholds; runs vs staging; report of p50/p95/p99 + error rate vs SLO; `§4` |
| 18 | **Consolidated security review** — one sweep verifying batches A+B + export sinks + headers/CSP/HSTS + dependency audit + AV-scan-on-upload disposition; grouped punch-list | security-reviewer | 8,12,13 | W5 | GO/NO-GO verdict; each harvested item marked resolved/accepted/deferred with evidence; `§4` |
| 19 | **Security remediation (in-wave)** — fix any Critical/High from #18 | backend-builder | 18 | W5 | No open Critical/High at close; `§4` |
| 20 | **Docs** — `docs/phase-7-followups.md`, ADRs (read-model, observability, scheduling, erasure policy), dashboard/report/observability/load-test runbooks, update `docs/05 §10` status | docs-writer | 14–19 | W5 | Followups + ADRs written; status tables updated; `§4` |

---

## Execution order (waves)

- **Wave 1 (parallel):** #1 #2 #3 #4 #5 #6 — data model, indexes, migration, contracts,
  chart primitives, deferred-test paydown. All independent given decisions.
- **Wave 2 (parallel where marked):** #7 #8 #9 #10 #11 #12 #13 — backend analytics, exports,
  observability, perf, scheduling, security batches. #7/#8/#11 depend on #1/#4; #10 on #2;
  #12 independent; #13 spans into W3.
- **Wave 3 (parallel):** #14 #15 — CRM dashboards + reports UI (need #5 + backend live).
- **Wave 4 (parallel):** #16 #17 — observability infra / CI gates + k6 load test.
- **Wave 5 (sequential):** #18 → #19 → #20 — security sweep, remediation, docs.

## Risks & open questions

- **No read replica yet (Decision 2):** MV-on-primary is acceptable for current scale but is
  a stopgap; k6 (#17) will reveal if primary contention forces the replica sooner.
- **Sync-seam vs BullMQ (Decision 3):** cron covers P7; true fan-out scale (notification,
  campaign, report bulk) still points at the documented BullMQ migration for P8.
- **CSV/PDF at-sink encoding** is the *actual* control for P5 M-3 / P6 M-4 — must be enforced
  in the export path (#8), not just the store path; #18 verifies.
- **Lighthouse gate flip (Decision 6)** can destabilize CI if budgets aren't met — flip only
  after a clean baseline run.
- **DPDP erasure vs audit immutability (Decision 7)** is a policy trade-off, not a pure
  engineering call — needs the user.

## Definition of Done for the whole phase

- CRM dashboards + reports/exports live, RBAC/tenant/branch-scoped, numbers reconcile to
  source rows; exports pass CSV-injection + at-sink encoding tests.
- Observability active (traces/errors/logs/readiness/metrics); alerts wired.
- Perf hardening measured (N+1 fixed, cache + pagination on hot reads); Lighthouse per
  Decision 6.
- Harvested P0–P6 Mediums/Lows resolved/accepted/deferred with evidence; security-reviewer
  GO; no open Critical/High.
- k6 SLOs defined and asserted against staging; results reported.
- P6 deferred integration + axe specs green. `turbo run build lint test` green + integration
  suites green. `docs/phase-7-followups.md` + ADRs written.
</content>
</invoke>
