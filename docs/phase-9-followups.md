# Phase-9 follow-ups (Completion — carried into future work)

Recorded at Phase-9 closeout (`docs/plans/phase-9-completion.md` — 22 new schema
tables, `LiveClassProvider` (Zoom/Google Meet), real MSG91 SMS, BullMQ async workers,
help-desk, headless CMS, feature flags/settings, EMI+dunning, referrals, video library,
invoice/receipt PDF, bookmarks/notes, global search, bulk actions/saved views, per-city
SEO + bundles, landing-page/lead-form CRM, password reset + TOTP 2FA, attendance editor,
bulk certificate issuance — every `comingSoon` CRM screen now live) so nothing found
during the build or the security review gets lost. None of these blocked the Phase-9 GO
decision; they are tracked here for prioritization, not as open incidents. Notable
architectural decisions from this phase are ADRs 0056–0060 (`docs/adr/README.md`), not
this file.

---

## Deferred / partial items

| ID | Item | Notes |
|----|------|-------|
| P9-1 | **Composed reports have no dedicated endpoints** | Some CRM report views (cross-cutting compositions over multiple existing read models) are assembled client-side from several existing endpoint calls rather than served by one purpose-built aggregate endpoint. Functionally correct, but means the client owns the composition logic and there is no single server-side query to optimize/cache for those views. A future pass should identify the highest-traffic composed reports and give them dedicated endpoints. |
| P9-2 | **Certificate-template designer `layout` persistence is basic** | `certificate_templates.layout` (Json?, migration `20260709100000_certificate_template_layout`) persists the CRM designer's drag-positioned merge-field layout, but `CertificatePdfPort` rendering still reads only `design`/`fields` — `layout` is saved but **not yet consumed by the PDF renderer**. The designer UI and the render pipeline are not yet wired end-to-end; a template edited in the designer does not change the issued PDF until this gap closes. |
| P9-3 | **Some list endpoints lack a `GET .../:id` body — now partially fixed** | A number of list-only endpoints added earlier in the build had no matching single-resource `GET`. This wave closed most of the ones the new frontend screens actually needed (live classes, tickets, content pages, EMI plans), but a full audit of every list endpoint across all modules for a matching detail endpoint was not performed — some list-only endpoints may remain. |
| P9-4 | **Public program search is client-composed** | `apps/web/src/app/search` (T33) composes results from the existing `GET /public/programs` + published-blog list endpoints rather than a server-side `tsvector` query. `programs`/`blog_posts` full-text search is explicitly **out of scope** for the P9 `search_vector` migration (ADR-0060), which only covers `lessons`/`resources`/`forum_threads` for the LMS's own-enrolled search surface. A server-side ranked public search is a future item if client-side composition proves insufficient at scale. |
| P9-5 | **Live classes / video transcode / SMS need real vendor credentials to activate** | `LiveClassProvider` (Zoom/Google Meet, ADR-0057), `VideoProvider` (Mux/Cloudflare Stream), and the real MSG91 SMS adapter are code-complete and unit-tested against mocked vendors, but **not yet verified against a live vendor account** — blocked on credential provisioning (`docs/go-live-checklist.md` B1/B5/B6, decisions #1–4 in `docs/plans/phase-9-completion.md`). All three fail closed in production rather than serving fake data if launched without credentials. |
| P9-6 | **`validateEnv` cold-start test-hygiene debt across several specs** | A number of unit-test suites call `validateEnv()`/provider-module factories without fully resetting `process.env` between cases, relying on test-execution order or defaults rather than an explicit clean-env fixture per test. Not a production defect (validated at real process boot, not per-test), but a source of test flakiness/coupling risk if suites are reordered or run in parallel differently. Worth a dedicated env-fixture cleanup pass. |
| P9-7 | **Integration-suite rate-limit-ceiling flakiness** | Some integration tests that exercise rate-limited endpoints (e.g. `POST /auth/refresh` after R6, public content-intake writes) are occasionally flaky when run alongside other suites that share the same Redis-backed rate-limit keys/windows, rather than fully isolating their own limiter state. Needs a per-test rate-limit-key namespacing pass. |
| P9-8 | **Mentor `branch_id` still needs product sign-off** | Carried unresolved from `docs/phase-8-followups.md` F1 — `mentors` remains tenant-level with no `branch_id`, so a Branch Manager with `mentors.*` still reads every mentor tenant-wide. Not touched this phase; still flagged for product sign-off. |
| P9-9 | **Enrollment-time referral auto-conversion is not wired** | `referrals.status` (`ReferralStatus`: `pending\|converted\|rewarded\|expired\|rejected`) has no automatic transition from `pending` → `converted` when the referred lead actually enrolls — the referral module is built (link generation, code lookup, reward ledger shape) but the conversion event has no caller yet, the same "built, never wired" shape R3 found for the P6 notifiers. A ~1-call-site fix once the enrollment-completion event hook is identified. |
| P9-10 | **Saved views are persisted on `settings`, not a dedicated model** | The bulk-actions/saved-views feature (T30) stores a user's saved list-view configuration as a JSON value keyed into the generic `settings` table (`scope='company'`-adjacent per-user key) rather than a first-class `SavedView` model with its own columns/indexes. Works, but means saved views cannot be queried/indexed independently of the generic settings blob (e.g. "list every saved view referencing program X" requires a JSON scan). A real `SavedView` model is the documented follow-up if usage grows. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 9 are recorded as ADRs 0056–0060 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for known
gaps and planned work, not decisions.
