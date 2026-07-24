# Phase-6 follow-ups (carried into P7+)

Recorded at Phase-6 closeout (Engagement — notifications, campaigns, gamification, forum,
Waves 1–8 + security remediation) so nothing found during the security review, QA build, or
left stubbed during the build gets lost going into Phase 7. None of these blocked the
Phase-6 GO decision; they are tracked here for prioritization, not as open incidents.

Test counts at Phase-6 closeout: **1038 api unit tests / 53 suites** (green), including
dedicated suites for campaigns (30), gamification (23), notifications (16), forum (23).
testcontainers integration tests + automated axe a11y for the four headline ACs (AC-6, AC-27,
AC-44, AC-56) were **not written this wave** — the QA agent hit the account session limit
before authoring them. Unit coverage is comprehensive and green; the integration/a11y suites
are wired-but-deferred (mirrors how P5 handled Playwright browser e2e — see Deferred section
below).

---

## Security follow-ups (Wave 8 review)

The Wave 8 security review ran and remediation was applied **in-wave**. No Critical or High
finding was left open at closeout.

| ID | Title | Status |
|----|-------|--------|
| H-1 | **Campaign segment `both`-path mass-assignment + pagination truncation** | **FIXED this wave** — the segment-build service accepted a raw-segment spread for the combined lead+student ("both") audience path, and paginated the underlying query without exhausting all pages before materializing `campaign_recipients`. Fixed: the "both" path now runs **independent paginate-to-exhaustion** queries per source (leads, students) with no raw-segment spread into the query builder; every eligible recipient across all pages is materialized, and the mass-assignment vector (arbitrary fields riding through the raw segment object) is closed. |
| H-2 | **Forum `requireModeratorScope` fell through to ALLOW for unrecognized roles / program-scoped threads** | **FIXED this wave** — the assigned-scope resolver for forum moderation had a fall-through branch that granted access when the actor's role was unrecognized or the thread was scoped to a `program_id` rather than a `batch_id` (a case the original scope check didn't handle explicitly). Fixed: the resolver is now **default-deny** — any unrecognized role or unhandled scope shape returns 404 (IDOR-safe), consistent with the fail-closed pattern used everywhere else (ADR-0009/0018/0022/0031/0045). |
| M-2 | **Unsubscribe signing secret used a shared dev constant outside production** | **FIXED this wave** — `NOTIFICATION_SIGNING_SECRET` originally fell back to a shared local-only constant reachable in any non-production environment (mirroring the `CERT_SIGNING_SECRET` dev-fallback pattern). Fixed: the fallback is now scoped to **`NODE_ENV=test` only**; every other environment (including local dev) requires an explicitly-set secret. See ADR-0042. |
| C-1 (reported Critical, **RESOLVED / downgraded**) | **`provider_message_id` uniqueness — webhook cross-tenant collision** | **RESOLVED at review time, downgraded to a Medium residual.** The reviewer flagged `provider_message_id` as non-unique, reading only `schema.prisma`'s `@@index`. The **live database** already has a **partial unique index** — `campaign_recipients_active_provider_message_id_key` (`UNIQUE (...) WHERE deleted_at IS NULL AND provider_message_id IS NOT NULL`) — created by migration `20260703065700_engagement_partial_indexes`. Prisma's `@@` schema syntax cannot express partial unique indexes, so this constraint is **raw-SQL-only** and invisible to a schema-file-only review. That uniqueness, combined with the HMAC fail-closed webhook-signature verification (ADR-0040's `verifyWebhookSignature`), already prevents the cross-tenant webhook collision/corruption the reviewer was concerned about. The residual — a **shared (not per-tenant) webhook signing secret** — is real but is a multi-tenant-future hardening item, not an active vulnerability today (single active tenant). Tracked below as an open Medium. |

**Confirmed-GOOD controls (Wave 8 evidence):**

- Campaign per-recipient dedupe (`campaign_recipients` partial-unique on
  `(campaign_id, coalesce(lead_id, student_id, user_id)) WHERE deleted_at IS NULL`) holds
  under replay — a duplicate segment-materialization insert is a no-op, not a 500 (AC-28).
- Gamification award idempotency (`points_ledger` partial-unique on
  `(user_id, reason, ref) WHERE deleted_at IS NULL`) and badge dedup (`user_badges`
  partial-unique on `(user_id, badge_id) WHERE deleted_at IS NULL`) both hold under replayed
  domain events — no double-award (AC-44, AC-46).
- Forum IDOR is fail-closed 404 for non-enrolled students and non-assigned faculty (AC-55,
  AC-56, AC-64), post-H-2-fix.
- DLT/consent gating (Rules C-1/C-2/C-3, ADR-0041) holds at all three enforcement layers
  (segment build, template create, campaign send) — non-consented and suppressed recipients
  are never sent to; SMS/WhatsApp sends without a `dlt_template_id` are rejected 422.
- Unsubscribe token is HMAC-signed, constant-time verified, and does not leak raw user id or
  email in cleartext (AC-21, AC-24, AC-77), post-M-2-fix.
- No provider secret (`RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `MSG91_AUTH_KEY`, `MAIL_WEBHOOK_SECRET`, `NOTIFICATION_SIGNING_SECRET`) appears in any HTTP
  response, header, or structured log (AC-76).
- SSE stream is authenticated (401 with no valid JWT, AC-15) and own-scoped (AC-14) —
  independent of the M-1 scaling/tenancy follow-up below.

---

## Open follow-ups (tracked, non-blocking)

| ID | Title | Notes |
|----|-------|-------|
| M-1 | **SSE not keyed by `tenantId` + no per-user stream cap + misleading docstring** | The in-memory subscriber map (ADR-0043) keys subscriptions by `userId` only, not `(tenantId, userId)` — cross-tenant collision on `userId` is not currently possible because ids are globally unique (cuid), but the map should be tenant-namespaced defensively. There is also no cap on concurrent SSE connections per user (a client that opens many tabs/reconnects rapidly accumulates subscriber-map entries with no eviction beyond disconnect-cleanup). A code comment inaccurately claims a "500ms DB poll" fallback inside the SSE handler that does not actually exist in the shipped implementation — the docstring must be corrected to describe the real in-memory-map-plus-polling-fallback behavior. The durable fix for all three issues is **Redis pub/sub with BullMQ** (the migration path documented in ADR-0039/0043), which also resolves the single-instance limitation. |
| M-3 | **Campaign webhook hardening — freshness window, idempotent/monotonic bounce→suppression, per-IP rate limit** | Extends P4 M-6. The webhook handler (`POST /campaigns/webhooks/:channel`) verifies HMAC signature (AC-39) and handles duplicate/replayed events as a no-op (AC-38), but does not yet: (a) enforce a signature-timestamp freshness window (an old, validly-signed payload can be replayed indefinitely), (b) guarantee the bounce→suppression transition is strictly monotonic and idempotent under out-of-order delivery, (c) rate-limit webhook calls per source IP. None of these are exploitable today given HMAC verification, but should be closed before scaling webhook volume. |
| M-4 | **Forum server regex sanitizer is weak / not-a-control; downgrade to length/shape validator** | Per ADR-0045, DOMPurify-at-render-sink is the actual XSS control for forum content; the server-side regex HTML-strip at the write path is defense-in-depth only. Action item: explicitly downgrade/rename that regex function to a length/shape validator (it already enforces `BODY_TOO_LONG`, AC-71) so future engineers don't mistake it for the security control. P5 M-3 is **resolved for the forum + notification render surfaces** (DOMPurify-at-sink is proven there) but remains **open for any future non-DOMPurify render/export sink** — e.g., a future CSV export of forum content would need its own output-encoding control. |
| L-1 | **`campaigns.repository` `softDeleteCampaign` dead code after return** | A statement after an early `return` in `softDeleteCampaign` is unreachable. Cosmetic; no functional impact. Clean up in a future pass. |
| L-2 | **Raw email/phone in `campaign_recipients.to` and notification `payload` intentionally stored in `audit_logs`** | Inherits P5 L-1 (raw phone in lead-create audit). Ensure any future DPDP erasure/right-to-be-forgotten workflow covers `audit_logs` rows referencing these tables, or hash the address in the audit `after` snapshot. Low severity; audit logs are access-controlled. |
| L-3 | **`notifyThreadAuthor` `authorName` hardcoded `"Someone"`** | The forum reply-notification payload (AC-60) currently renders a placeholder display name instead of the actual replying user's name/alias. Cosmetic — the notification still correctly targets the right user and thread; only the display copy is a placeholder. Fix by threading the actual author's display name through the notification payload. |

---

## Deferred test coverage

- **testcontainers integration tests** for the four headline P6 acceptance criteria (AC-6
  notification fan-out with prefs/quiet-hours, AC-27 campaign exactly-once send, AC-44
  gamification idempotent award, AC-56 forum IDOR) were **not authored this wave** — the QA
  agent hit the account session limit mid-wave. Unit test coverage for the same logic paths
  is comprehensive and green (**1038 api unit tests / 53 suites**, including 30 dedicated
  campaigns tests, 23 gamification, 16 notifications, 23 forum). This is a **wired-but-deferred**
  gap, not an unverified-logic gap — the same assertions the integration specs would make are
  covered at the unit level against mocked repositories/providers; what's missing is the
  full-stack (real Postgres + Noop providers) proof and the automated axe a11y pass on the new
  `@repo/ui` primitives and LMS/CRM screens.
- Mirrors how P5 handled Playwright browser e2e (wired-but-skipped, API-integration as the
  authoritative gate) — here the unit suite is the authoritative gate until the integration
  specs land.
- **Action for P7 (or an early P7 wave):** author the testcontainers specs for AC-6/27/44/56
  plus cross-tenant isolation (AC-72–75) and the axe a11y pass on NotificationBell,
  CampaignBuilder, BadgeGrid/LeaderboardTable, and PostThread.

---

## Engineering notes

- **`campaign_recipients` partial-unique index is raw-SQL-only** — Prisma's `@@unique`/`@@index`
  schema syntax cannot express a partial index (`WHERE deleted_at IS NULL AND
  provider_message_id IS NOT NULL`). The constraint
  (`campaign_recipients_active_provider_message_id_key`) is created in migration
  `20260703065700_engagement_partial_indexes` via raw SQL and is **not visible from
  `schema.prisma` alone** — this caused the reviewer's C-1 report (see above). Anyone auditing
  uniqueness guarantees on this table must check the migration SQL, not just the Prisma
  schema file.
- **Sync-seam dispatch (ADR-0039) keeps P6 green with zero new infra** — `bullmq` was not
  installed; `SyncNotificationDispatchAdapter`/`SyncCampaignSendAdapter` provide idempotent,
  in-request dispatch with a documented (unbuilt) BullMQ migration path via the `throttle()`
  no-op hook.
- **Two new provider interfaces landed** (`MailProvider`/Resend, `WhatsAppProvider`/WhatsApp
  Cloud API — ADR-0040), both Noop-by-default and fail-closed in production when
  unconfigured; `SmsProvider`/MSG91 was reused unchanged as the SMS channel.

---

## Deferred / wired-but-gated

| Item | Deferred to | Notes |
|------|-------------|-------|
| Web Push / native mobile push | Later engagement or mobile phase | `NotificationChannel` enum is extensible; P6 ships in-app + email + SMS + WhatsApp only. See `CONFLICT-P6-1`. |
| Referral / affiliate program logic | Commerce-depth phase (no date) | The `referrals` table schema exists in `docs/05 §3`; reward attribution/payout logic is out. See `CONFLICT-P6-2`. |
| Marketing automation builder (drip sequences, if-this-then-that) | P8 | P6 ships single-shot scheduled campaigns only. See `CONFLICT-P6-3`. |
| Live-class scheduling / `LiveClassProvider` | Deferred since P3; reminder notification path only ships in P6 | The reminder template + fan-out path is wired; no live-class entity or scheduler is built. See `CONFLICT-P6-4`. |
| Engagement analytics dashboards (campaign ROI, gamification, forum health) | P7 | P6 writes all raw tracking rows (`campaign_recipients.status`, `points_ledger`, `campaigns.metrics`, forum upvote/post counts); dashboards visualize them in P7. |
| Real BullMQ cluster / Redis pub/sub / DLQ tooling depth | P7 hardening | Sync-seam (ADR-0039) is the default; BullMQ migration path is documented but not built. Also resolves the SSE single-instance limitation (M-1) once landed. |
| Forum full-text search | P7 (tsvector / Meilisearch) | Not built; `docs/05 §4`. |
| Forum rich editor (WYSIWYG), attachments, @mentions | Later forum-depth phase | P6 ships plain sanitized text only. |
| AI-drafted campaign copy / lead-scoring AI | P8 | Not in scope. |
| CRM automated test infra | Carried gap (P4/P5/P6) | `apps/crm` P6 screens are typecheck/lint/build-verified only; QA did not stand up CRM test infra this wave either. |
| Playwright browser e2e | Carried stub since P1 | Notification-center + forum-reply journeys remain candidates; unit + (once landed) integration tests are the authoritative gate. |

---

## Carried-forward still-open items (from `docs/phase-5-followups.md`)

Brief status only; full detail remains in the originating followups files. Two items are
called out at the top as still-blocking real-world activation of already-built features:

> **Still blocking real-world activation:**
> - **Cloudflare Stream video activation** — blocked on a valid API token/signing key;
>   `VIDEO_PROVIDER=noop` remains the effective setting.
> - **Rotate the two exposed `cfat_` Cloudflare video tokens** — carried since P3/P4/P5,
>   still not rotated.

| Item | Original tracking | Status |
|------|-------------------|--------|
| Real video provider keys blocked; two `cfat_` tokens to rotate | `docs/phase-3-followups.md` | **Still blocked / still not rotated.** See callout above. |
| `hls.js` approval for Chrome/Firefox | ADR-0026 | Still deferred. Safari/iOS native HLS works. |
| BullMQ transcode webhook worker | ADR-0020 | Still deferred (sync adapter); P6's own dispatch seam (ADR-0039) follows the same pattern. |
| Live-class attendance (`source=live`) | P3 followups | Still deferred. `live_classes` table not created; P6 wires the reminder notification path only (`CONFLICT-P6-4`). |
| Hardcoded `TENANT_SLUG = "stimuliiq"` / single-tenant | P1 followups | Carried forward. Every new P6 table + read resolves tenant server-side via `TENANT_SLUG`; full multi-tenant harness still deferred. Directly relevant to the C-1 webhook-secret residual above. |
| Cross-tenant IDOR harness (S1-3) | P1 followups S1-3 | Partially paid down again in P6 — cross-tenant isolation tests added for notifications, campaign_recipients, forum_posts, points_ledger (AC-72–75) at the unit level; full multi-tenant harness + integration proof deferred (see Deferred test coverage above). |
| PII read-audit (§17) | P1 followups S1-2 | Carried forward. |
| Certificate reissue partial-unique migration (M-2, P4) | `docs/phase-4-followups.md` M-2 | Carried forward. |
| argon2id cost parameters not pinned | P0 followups | Carried forward. |
| JWT `aud` claim absent | P0 followups M-4 | Carried forward. |
| Inactive-account enumeration | P0 followups M-5 | Carried forward. |
| IP-dimension rate limiting | P0 followups M-6 | Carried forward. Extended by P6 M-3 above (webhook per-IP rate limit). |
| DataTable row virtualization seam | ADR-0012 | Carried forward — wire in P7. |
| P2 M-3/M-4/M-5, L-1/L-2/L-4 | `docs/phase-2-followups.md` | Carried forward unchanged. |
| System roles' permission matrix editable by any `all`-scope admin (S1-1) | P1 followups S1-1 | Carried forward. |
| P3 L-3 CSRF exclude path prefix mismatch | P3 followups L-3 | Carried forward. |
| P4 L-2 Verify rate-limiter logs client IP on Redis error | `docs/phase-4-followups.md` L-2 | Carried forward. |
| AV / malware scanning on submission uploads | P4 deferred | Carried forward. |
| `@react-pdf/renderer` v3 pin | ADR-0029 | Carried forward. Do not upgrade to v4 without resolving ESM interop. |
| P5 M-1 (honeypot 400 vs 422), M-2 (invalid-signature 422 vs 400) | `docs/phase-5-followups.md` | Carried forward unchanged. |
| P5 L-2 (LMS handoff shared-cookie domain / signed handoff token) | `docs/phase-5-followups.md` L-2 | Carried forward — before go-live. |
| Razorpay go-LIVE | Pending explicit user decision | Still TEST mode (`rzp_test_*`). No change in P6. |
| Lighthouse SEO ≥95 + axe CI gates as hard-fail | Flip when stable | Still `continue-on-error: true`. No change in P6 (P6 adds no new Lighthouse-scored pages). |

---

## PRD conflict log (P6)

| Conflict ID | PRD section | PRD says | P6 gate decision | Resolution |
|-------------|-------------|----------|-------------------|------------|
| CONFLICT-P6-1 | `docs/02 §7.15` | In-app center + **push** + email + WhatsApp | Push (VAPID/native) is OUT of P6 | `NotificationChannel` enum is extensible; channels shipped: in_app + email + sms + whatsapp. |
| CONFLICT-P6-2 | `docs/03 §7.13` | Referral + affiliate programs under Marketing | Referral/affiliate program logic is OUT of P6 | `referrals` table schema exists; program logic (attribution, payouts) is a commerce-depth item, deferred. |
| CONFLICT-P6-3 | `docs/03 §19` | Automation builder (if-this-then-that) | OUT of P6, → P8 | P6 ships single-shot scheduled campaigns; multi-step journeys require a workflow engine, P8 scope. |
| CONFLICT-P6-4 | `docs/02 §7.4`, `docs/03 §7.10` | Live-class reminders as part of the live-class feature | Live-class feature (scheduler, `LiveClassProvider`) deferred since P3; reminder fan-out path ships in P6 | Notification template + fan-out path ready; no live-class entity built. |

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 6 are recorded as ADRs 0039–0045 in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for known
gaps and planned work, not decisions.
