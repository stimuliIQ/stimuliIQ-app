# Phase-7 follow-ups (carried into P8+)

Recorded at Phase-7 closeout (Analytics + Hardening — dashboards, reports/exports,
observability, scheduling, security sweep, load test, Waves 1–5 + security remediation) so
nothing found during the security review, QA build, or left stubbed during the build gets lost
going into Phase 8. None of these blocked the Phase-7 GO decision; they are tracked here for
prioritization, not as open incidents.

Test counts at Phase-7 closeout: **1362 api unit tests / 90 suites** (green); `turbo run
typecheck lint build` **23/23** green; integration specs (testcontainers Postgres/Redis) green,
including the P7-W1 backfill of the P6-deferred AC-6/27/44/56 + cross-tenant (AC-72–75)
specs and the new permission-catalog regression spec (see Engineering notes below).

---

## Security review verdict

**NO-GO → GO after in-wave remediation.** The Wave 5 security sweep (task #18) returned a
Critical finding; it was fixed in-wave (task #19) and the gate flipped to GO. No Critical or
High finding was left open at closeout.

| ID | Title | Status |
|----|-------|--------|
| H-1 | **Engagement report `getEngagement` passed the caller's `programId` to `listLessonsForProgram` with no tenant filter — cross-tenant curriculum-structure disclosure** | **FIXED this wave** — the course/video-engagement dashboard endpoint (WS-A5) resolved lesson lists for an arbitrary `programId` without first confirming the program belongs to the caller's tenant, allowing a Tenant B caller to disclose Tenant A's curriculum structure (module/lesson names/order) via the engagement endpoint. Fixed: an `isProgramInTenant` 404 ownership check now runs before any read, and `listLessonsForProgram` itself is now tenant-filtered via the program relation (defense in depth, not just the caller-facing guard). 2 regression tests added (direct cross-tenant call, and a call with a well-formed but foreign `programId`). |
| L-2 | **Client-supplied `X-Request-Id` echoed unbounded** | **FIXED this wave** — the correlation-id resolver (ADR-0047) previously echoed any client-supplied `X-Request-Id` value verbatim, including arbitrarily long or unusual-character strings, into the response header, RFC-7807 body, and log lines. Fixed: the accepted value is capped to 128 characters matching `[A-Za-z0-9._-]`; anything outside that shape is discarded and a fresh uuid is minted instead. |

**Confirmed-GOOD controls (Wave 5 evidence):**

- Revenue/enrollment/funnel/attendance/engagement/campaign/gamification/forum-health
  dashboards reconcile exactly to a direct source-row recomputation for every tested range and
  scope (AC-1, AC-7, AC-10, AC-14, AC-17, AC-20, AC-23, AC-26).
- Every dashboard/export cross-tenant and IDOR-scope check returns 404, not 403 or a
  scoped-but-200 leak (AC-3, AC-8, AC-11–13, AC-15, AC-19, AC-21–22, AC-27, AC-30).
- CSV-injection payloads (`=`, `+`, `-`, `@`, tab-prefixed cells) are neutralized at the single
  `csvSafeCell()` choke-point in every export sink; a lint-level scan confirms no export path
  hand-rolls its own escaping (AC-28, AC-29).
- Export row/column sets exactly match the caller's on-screen scoped query for the same filter
  — no separate, broader export query path exists (AC-30, AC-31, AC-32).
- Sentry `beforeSend` scrubbing strips email/phone/`Authorization`/cookie/token values before
  an event leaves the process; pino masks email/phone and never logs a provider secret, JWT, or
  password hash (AC-43, AC-47, AC-48).
- `/health` and `/health/ready` leak no internal detail regardless of authentication state, and
  `/health/ready` fails to 503 when DB or Redis is down (AC-41, AC-42).
- DPDp erasure redacts `audit_logs` PII in place without deleting rows, writes its own audit
  entry, is idempotent under concurrent re-run, and is permission-gated to
  `dpdp.erasure.execute` (AC-64, AC-65).
- Auth rate limiting fails closed on a Redis error; webhook rate limiting fails open; webhook
  signature-freshness window and monotonic bounce→suppression both hold under out-of-order
  delivery (AC-57–60).
- No provider secret, signing secret, or credential appears in any P7-added endpoint's
  response, log, or CI build artifact (AC-69).

---

## Open follow-ups (tracked, non-blocking)

| ID | Title | Notes |
|----|-------|-------|
| M-1 | **Export `assertCanExportType` collapses spec Part-8 per-role parentheticals to a coarser check** | The spec's Part 8 permission table lists per-role parentheticals for `reports.export` (e.g. Counsellor "funnel only", Faculty "assigned own domains", Finance "revenue", Marketing "campaigns"). The shipped `assertCanExportType` collapses this to `reports.export AND <domain>.view` rather than a full per-role-per-export-type allowlist. The security reviewer confirmed this is a **strict subset** of what each role can already see on-screen, not a privilege leak — but it is coarser than the spec's literal per-role wording. **Product decision needed**: accept the current behavior, or add an explicit per-role export-type allowlist for a literal match to Part 8. Non-blocking; see ADR-0051. |
| L-1 | **Revenue `bigint→number` precision degrades above 2^53 paise (≈ ₹90,000 crore aggregate)** | The revenue dashboard/export sums `payments.amount_paise` as a Postgres `bigint`; serializing it to a JS `number` loses precision above `Number.MAX_SAFE_INTEGER` (2^53 − 1 paise, roughly ₹90,000 crore in a single aggregate). Unreachable at current or foreseeable scale. Keep the column/aggregate as `bigint` (never a float, per `CLAUDE.md §3.6`) until either a serialization change (string-encode large aggregates) is made or this ceiling is formally documented as a known limit. |
| — | **5 HIGH-severity dependency CVEs in `apps/api` transitive deps (multer, OpenTelemetry)** | Parked in `package.json` → `pnpm.auditConfig.ignoreCves` with patches available upstream. Dependency-bump fast-follow — re-check by **2026-08-07**. See the devops Wave-4 CI note in `README.md` for the full advisory-id list. |
| — | **Perf-hardening pass DEFERRED to post-load-test** | Data-driven by design — indexes, cache-aside, and N+1 fixes are already shipped (task #10); the k6 load test (task #17) is what should gate the read-replica and further-index decisions, not a guess made ahead of evidence. See ADR-0046's "no read replica yet" consequence. |
| — | **S1-2 single-record PII read-audit DEFERRED** | Carried since P1 followups. The write-mutation audit (soft-delete + audit Prisma extension, now with write-time PII masking per ADR-0049) is the current gate; auditing individual PII *reads* (not just writes) remains a future item. |
| — | **k6 load suite wired-but-not-CI-run** | The k6 scripts + SLO thresholds (task #17) run against staging via `K6_BASE_URL`, never CI, never localhost, never prod — per design (AC-73, no live payment gateway; avoids polluting CI with load-test noise). Needs a live staging environment provisioned plus a human SLO sign-off before the results in AC-70–74 can be treated as validated against real infra sizing. |
| — | **Lighthouse LMS/web numeric budgets are PROPOSED and need human tuning** | Per spec LOCK-D6, the concrete numbers in AC-51–56 (and the `lighthouserc.json`/`lighthouserc.lms.json` thresholds the devops Wave-4 CI work gates on) are proposed targets grounded in `docs/00 §7`/`docs/04 §8`, not yet confirmed against real device/CrUX/RUM data. Treat a red CI run as "investigate", not "auto-revert", until a human signs off on the exact numbers. |
| — | **`deploy-api` Railway job gated behind `RAILWAY_TOKEN_PRESENT`, not live-tested** | Mirrors the `deploy-preview-web` gating pattern (P5). The job runs `pnpm db:migrate:deploy` then `railway up` but has not been exercised against a real Railway project in this wave — set `RAILWAY_TOKEN`/`RAILWAY_SERVICE_ID` + the `RAILWAY_TOKEN_PRESENT` repo variable to activate, then verify with a real deploy before relying on it. |

---

## Carried follow-ups CLOSED this phase

| Item | Original tracking | Resolution |
|------|-------------------|------------|
| Certificate reissue partial-unique migration | P4 followups M-2 | `UNIQUE(enrollment_id) WHERE deleted_at IS NULL` shipped in P7 Wave 1 (db-architect); reissue now soft-deletes the old row and preserves it in audit history instead of a hard delete. `docs/phase-4-followups.md` M-2 marked CLOSED. |
| CSV/export sink output-encoding | P5 followups M-3, P6 followups M-4 | Resolved by the single `csvSafeCell()` choke-point (ADR-0051) — every export sink (leads, students, payments, campaigns, forum, and any future export) routes through one shared helper; a lint-level scan confirms no ad hoc per-export escaping exists. |
| SSE tenant-namespacing + per-user connection cap | P6 followups M-1 (tenancy + cap portion) | The in-memory subscriber map (ADR-0043) is now keyed `(tenantId, userId)`, not `userId` alone, and enforces a per-user connection cap (AC-61, AC-62). The BullMQ/Redis-pub/sub multi-instance limitation remains the documented future item — this wave closed only the tenancy-key and cap portion. |
| Webhook per-IP rate limit, signature-freshness window, monotonic suppression | P6 followups M-3 | Fully closed by ADR-0050 (AC-58, AC-59, AC-60) — per-IP throttling (fail-open), a configurable signature-freshness window, and a strictly monotonic idempotent bounce→suppression transition under out-of-order delivery. |
| DPDP audit PII (raw phone/email inside `audit_logs` snapshots) | P5 followups L-1, P6 followups L-2 | Closed by ADR-0049 — write-time masking via `PII_FIELD_REGISTRY` in the audit extension (going forward) plus a privileged admin-only anonymization job for historical rows (`POST /dpdp/erasure`), with `audit_logs` rows never deleted (AC-64). |
| IP-dimension rate limiting | P0 followups M-6 | Closed by ADR-0050 — Redis-backed per-IP rate limiting added alongside the existing account/message-id dimensions; auth fail-closed, webhook fail-open (AC-57, AC-58). |
| PII read-audit foundational gap (partial) | P1 followups S1-1 | `docs/phase-1-followups.md` S1-1 (system-role permission matrix editable by any `all`-scope admin) is resolved by the same guard-hardening pass that shipped the P7-W1 permission-catalog regression spec (see Engineering notes below) — full detail remains in the P1 followups file. |
| P2 M-3 / P2 M-5 | P2 followups | `getOrderById` BranchManager false-404 (M-3) and `assignOwner`/`create` missing target-owner tenant validation (M-5) both closed as part of the P7 security batch A scope-fix pass. |
| JWT `aud` claim absent | P0 followups M-4 | Closed by ADR-0050 — access/refresh tokens now carry an explicit `aud` claim; verification rejects tokens minted for a different audience. |

Also closed this phase, not carried from an earlier followups file:

- **Two real bugs found and fixed in-wave by security batch A**: `notification_suppressions`
  had **no unique constraint** despite an existing code comment claiming DB-level dedupe
  (`createSuppression` could silently create duplicate suppression rows under concurrent
  writes); and `createSuppression` was **missing `P2002` (unique-violation) handling**, so a
  genuine race would have surfaced as an unhandled 500 rather than an idempotent no-op. Both
  fixed: a partial-unique constraint was added on the active-row shape, and `createSuppression`
  now catches `P2002` and treats it as success.
- **CRM permission-catalog CRITICALs found by the P7-W1 integration backfill**: `forum.read`
  and `notification_prefs.edit` were required by their respective controllers (`@RequirePermission`
  guards) but had never been seeded into the role/permission matrix — every role, including
  Admin/Owner, received a 403 on those two routes. Fixed by seeding the missing grants; a new
  **permission-catalog regression spec** now asserts every `@RequirePermission` string used by a
  controller has a corresponding seeded permission row, so this bug class (a controller guard
  referencing an unseeded permission) cannot silently recur.

---

## PRD conflict log (P7)

No new PRD conflicts surfaced this phase beyond the ones already recorded in
`docs/specs/phase-7-analytics-hardening.md` Part 6 (CONFLICT-P7-1 through CONFLICT-P7-4 —
certificate template designer UI, global search, ticket dashboards, and bookmarks, all
deferred again per the spec's LOCK-1/2/3/4). No additional CONFLICT-P7-x items were recorded
during the build or security review.

---

## Engineering notes

- **Materialized views + `refresh_analytics_views()` + `analytics_mv_refresh_log` are
  raw-SQL-only** — same caveat as P6's `campaign_recipients` partial-unique lesson. Prisma's
  schema syntax cannot express `CREATE MATERIALIZED VIEW` or a stored procedure; anyone
  auditing the analytics read model must check the migration SQL directly, not `schema.prisma`
  alone. See ADR-0046 and `docs/05-database-design.md §10`.
- **Scheduling stays on `@nestjs/schedule` cron, not BullMQ** (ADR-0048) — consistent with the
  P6 sync-seam decision (ADR-0039). Both new cron jobs (MV refresh, scheduled-report dispatch)
  are registered conditionally and never fire when `NODE_ENV=test`.
- **DPDP erasure is two-layered** (ADR-0049): write-time masking closes the gap for all future
  audit writes; the `POST /dpdp/erasure` job only ever needs to handle the historical backlog
  plus any registry gaps, not an ever-growing raw-PII corpus.
- **The permission-catalog regression spec** (added during the P7-W1 integration backfill) is
  now the standing guard against the "controller requires an unseeded permission" bug class
  that produced the forum.read/notification_prefs.edit CRITICALs above — any new
  `@RequirePermission` string added to a controller without a matching seed will now fail this
  spec, not silently 403 every role in production.

---

## Deferred / wired-but-gated

| Item | Deferred to | Notes |
|------|-------------|-------|
| Read replica for analytics | Post-load-test decision | ADR-0046 — MV-on-primary is the P7 posture; k6 (task #17) results are the intended forcing function, not a guess. |
| Full BullMQ / Redis pub/sub migration (notifications, campaigns, reports, MV refresh) | P8 | Documented migration path remains unbuilt; sync-seam + cron (ADR-0039/0048) remain the default. Also the durable fix for SSE's remaining single-instance limitation. |
| Certificate template designer UI | Content-authoring phase (no date) | CONFLICT-P7-1 — further deferred; not analytics/hardening. |
| Global search (tsvector/Meilisearch) | Search-specific phase / P8 | CONFLICT-P7-2 — further deferred; not analytics/hardening. |
| Support ticket system + ticket dashboards | Later (requires the `tickets` table first) | CONFLICT-P7-3 — `tickets` remains spec-only. |
| Bookmarks (LMS convenience) | Later forum/LMS-depth phase | CONFLICT-P7-4 — further deferred. |
| Real Cloudflare Stream / video provider activation, `hls.js` browser approval | Blocked on credential rotation (carried since P3) | No change this phase. |
| Live-class scheduling, referral/affiliate programs, marketing automation builder | Carried P6 outs (`CONFLICT-P6-1..4`) | Unaffected by P7. |
| CRM automated test infra | Carried gap (P4/P5/P6/P7) | `apps/crm` P7 dashboard/report/export screens are typecheck/lint/build-verified only; QA did not stand up CRM unit-test infra this wave either. |
| Playwright browser e2e | Carried stub since P1 | Still wired-but-skipped; the integration suite remains the authoritative gate for user-facing journeys. |

---

## Carried-forward still-open items (from `docs/phase-6-followups.md`)

Brief status only; full detail remains in the originating followups files.

> **Still blocking real-world activation:**
> - **Cloudflare Stream video activation** — still blocked on a valid API token/signing key;
>   `VIDEO_PROVIDER=noop` remains the effective setting.
> - **Rotate the two exposed `cfat_` Cloudflare video tokens** — carried since P3/P4/P5/P6,
>   still not rotated.
> - **Razorpay go-LIVE** — still pending an explicit user decision; TEST mode
>   (`rzp_test_*`) unchanged, including for the k6 load-test payment journey (AC-73).

| Item | Original tracking | Status |
|------|-------------------|--------|
| `hls.js` approval for Chrome/Firefox | ADR-0026 | Still deferred. Safari/iOS native HLS works. |
| BullMQ transcode webhook worker / real BullMQ cluster | ADR-0020 | Still deferred (sync adapter); P6/P7's own dispatch/scheduling seams (ADR-0039/0048) follow the same pattern. |
| Live-class attendance (`source=live`) | P3 followups | Still deferred. `live_classes` table not created. |
| Hardcoded `TENANT_SLUG = "stimuliiq"` / single-tenant | P1 followups | Carried forward. Every P7 table/read resolves tenant server-side via `TENANT_SLUG`; full multi-tenant harness still deferred. |
| Cross-tenant IDOR harness (S1-3) | P1 followups S1-3 | Further paid down this phase — the P7-W1 integration backfill added cross-tenant isolation coverage for the P6 AC-72–75 surfaces plus the new P7 dashboard/export endpoints; a full multi-tenant harness (real second tenant, not id-uniqueness-by-construction) remains deferred. |
| Certificate reissue partial-unique migration (P4 M-2) | `docs/phase-4-followups.md` M-2 | **CLOSED this phase** — see "Carried follow-ups CLOSED this phase" above. |
| DataTable row virtualization seam | ADR-0012 | Carried forward — used opportunistically as an implementation technique for large report tables (per spec LOCK-9), not shipped as a standalone deliverable this phase either. |
| P3 L-3 CSRF exclude path prefix mismatch | P3 followups L-3 | Carried forward. |
| P4 L-2 Verify rate-limiter logs client IP on Redis error | `docs/phase-4-followups.md` L-2 | Carried forward. |
| AV / malware scanning on submission uploads | P4 deferred | Carried forward. |
| `@react-pdf/renderer` v3 pin | ADR-0029 | Carried forward. Do not upgrade to v4 without resolving ESM interop. |
| P5 M-1 (honeypot 400 vs 422), M-2 (invalid-signature 422 vs 400) | `docs/phase-5-followups.md` | Carried forward unchanged. |
| P5 L-2 (LMS handoff shared-cookie domain / signed handoff token) | `docs/phase-5-followups.md` L-2 | Carried forward — before go-live. |
| P6 M-4 (forum regex sanitizer downgrade-in-naming) | `docs/phase-6-followups.md` M-4 | Carried forward — remains open for any future non-DOMPurify render/export sink. |
| P6 L-1 / L-3 (dead code after return; hardcoded `authorName`) | `docs/phase-6-followups.md` L-1/L-3 | Carried forward, cosmetic. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 7 are recorded as ADRs 0046–0052 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for known gaps
and planned work, not decisions.
