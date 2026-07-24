# Plan: Phase 6 — Engagement ("P6")

> Scope boundary (`CLAUDE.md §6`): **"P6 Engagement: notifications, WhatsApp/email campaigns,
> gamification, forum."** This plan delivers exactly those four workstreams end-to-end
> (PM gate → schema → provider seams (Mail/WhatsApp) + queue seam → contracts → backend
> domains → design-system → LMS + CRM frontends → tests → security → docs) and **does not**
> plan ahead into P7 (analytics dashboards, reports, perf/security hardening, load test) or
> P8 (AI mentor, placement/recruiter/college/parent portals, multi-tenant SaaS, automation
> builder, lead-scoring AI).
>
> **P6 is the phase that finally *sends*.** P4 wrote grade/certificate-ready domain events +
> audit rows but deferred fan-out (`CONFLICT-4`). P5 lead/booking/registration confirmations
> only **enqueue** the event (`CONFLICT-P5-2`, `-5`); the actual email/WhatsApp/SMS **send is
> P6**. P6 builds the `NotificationService` fan-out engine + the `MailProvider` /
> `WhatsAppProvider` interfaces those deferred events have been waiting on, and connects the
> already-emitted P4/P5 events to real delivery.
>
> Each task DoD references `CLAUDE.md §4` + the relevant `docs/02 §7.12/§7.14/§7.15`,
> `docs/03 §7.13/§7.16`, `docs/04 §2.8/§2.9`, `docs/05 §3` ("Engagement & support"),
> `docs/06 §13`, and `docs/07`.

---

## P5 verification (done before planning — report gaps, no rework)

**P5 (Marketing Website + funnel) is GREEN and gates open to P6.** Confirmed from
`docs/plans/phase-5.md` and `docs/phase-5-followups.md`: **734 API unit tests / 43 suites**;
P5 funnel integration **34/34** + public module **71**; **web 175**; workspace
`turbo typecheck + lint + build` **23/23** green. Wave-7 security returned **NO-GO → GO**
after C-1 (register account-takeover) + H-1 (coupon programScope array) fixes; **no
Critical/High open**. ADRs 0034–0038 recorded. The full funnel journey (browse → enroll →
register → pay → verify → exactly-one-enrollment → LMS handoff) is proven at the
API-integration level.

**Foundations P6 REUSES (verified by Glob/Grep against the live tree — do NOT rebuild):**
- **Provider pattern is fully established** (interface + DI `Symbol` token + Noop + real
  adapter bound via `useFactory`, lazy env validation, fail-closed in prod): payment
  (ADR-0013), video (ADR-0023), storage (ADR-0027), captcha (ADR-0036). P6 adds two **new**
  provider seams (Mail, WhatsApp) following this exact pattern.
- **`SmsProvider` / MSG91 EXISTS** (`apps/api/src/modules/auth/providers/sms/`, ADR-0006) —
  built in P0 for OTP. P6 **reuses** it as the SMS channel of the notification fan-out; it is
  the model for the two new providers.
- **The BullMQ SEAM pattern EXISTS but BullMQ IS NOT INSTALLED** (verified:
  `invoice-gen.seam.ts`, `webhook-processor.adapter.ts`, `sync-certificate-pdf.adapter.ts`;
  no `bullmq` in `apps/api/package.json`; ADR-0020). Prior phases process async work via
  **synchronous idempotent adapters behind a `*Port` DI token** with a documented BullMQ
  migration path. **This is the single most important correction to the P6 brief** (see
  Risk #1): the four "queues already provisioned" named in `docs/04 §2.8`
  (`email|sms|whatsapp|notifications|campaign-send`) are **specified but not running** — they
  are sync seams. P6 must decide install-BullMQ-now vs. continue-sync-seam (task #0 gate;
  default in Risk #1).
- **RBAC machinery** (`@RequirePermission` + `PermissionsGuard` + `ScopeInterceptor`, scope
  `all|branch|assigned|own`, IDOR→404 fail-closed — ADR-0009/0018/0022/0031), soft-delete +
  audit Prisma extensions (ADR-0005), global `ZodValidationPipe` `.strict()`,
  `{data,meta,error}` + `Paginated<T>` + RFC-7807 envelope, OpenAPI→`@repo/api-client` — all
  proven P0–P5.
- **Domain events already emitted (P3/P4/P5) that P6 CONSUMES:** lesson-completed +
  progress rollup (P3, ADR-0024); assignment graded, assessment passed, project approved,
  **certificate issued** (P4 — events + audit rows written, fan-out deferred `CONFLICT-4`);
  lead-created, booking-created, registration, payment-verified/receipt (P5 — **enqueued**,
  send deferred `CONFLICT-P5-2/-5`). P6's gamification consumes the learning events; P6's
  notification fan-out consumes all of them.
- **Frontends:** `apps/lms` (Next.js PWA) already has dashboard, courses, lesson player,
  assignments, assessments, certificates, progress routes — P6 adds **Notifications center**,
  **Forum**, and folds gamification (points/badges/streaks/leaderboard) into the existing
  **Progress** surface. `apps/crm` (Vite SPA) has the route-file convention under
  `src/routes/*-route.tsx` with a **Marketing IA slot** (`docs/03 §10`: Marketing ▸ Campaigns
  (Email/WhatsApp)) and an **Admin ▸ Notifications** slot — P6 adds those routes.
  `@repo/ui` primitives (DataTable, Drawer, StatusChip, Tabs, FormField, Toast, EmptyState,
  Skeleton, ProgressRing, ConfirmDialog, MultiStepForm) are present.

**Current gaps / carried follow-ups that P6 MUST honor or resolve:**
- **`MailProvider` and `WhatsAppProvider` interfaces DO NOT EXIST.** Only `SES_*` /
  `RESEND_API_KEY` env vars are declared (unused, no adapter). P6 **builds both interfaces +
  Noop + real adapters** (SES/Resend, WhatsApp Cloud API/Gupshup) behind DI tokens,
  fail-closed. This is the integrations crux of the phase.
- **India DLT / consent compliance is load-bearing for campaigns.** SMS (MSG91) and WhatsApp
  in India require **DLT-registered template IDs** + explicit opt-in/consent + unsubscribe.
  P5 already records DPDP `consent` on `leads`/`bookings` (`{marketing_opt_in, tos_version,
  timestamp, ip_hash}`). P6 campaigns MUST honor `marketing_opt_in` + a per-recipient
  unsubscribe/suppression list, and template IDs must be supplied per channel (see §7).
- **CRM has no automated test infra** (P4/P5 followups). CRM P6 screens (Campaigns,
  Notifications, Forum-moderation) are typecheck/lint/build-verified; unit tests remain a
  carried gap unless the QA wave stands CRM test infra up (flagged, not required for gate).
- **Playwright browser e2e is still a no-op stub** (carried P1–P5). P6's notification-center
  + forum-reply journeys are candidates; API-integration remains the authoritative gate.
- **Hardcoded `TENANT_SLUG` / single-tenant harness (S1-3)** persists; every new P6 table +
  read MUST tenant-scope; new IDOR surfaces (notifications, forum posts, campaign recipients)
  get cross-tenant isolation tests in the security wave.
- **P5 M-3 (regex HTML-strip is a weak sanitizer; real fix is output-encoding at render/export
  sinks)** and **P3 L-2 / P4 DOMPurify** — P6 renders **user-generated forum content** (the
  widest UGC surface yet) → sanitize (DOMPurify) on every render of forum posts/replies is in
  scope (security-reviewer gate), extending the carried item.

None of these block the P6 GO; they are folded into the tasks below.

---

## 1. Scope statement + what is explicitly OUT of P6 (gate decisions — kept tight)

### In scope (the P6 headline — four workstreams)

**WS-1 Notifications core** (`docs/02 §7.15`, `docs/03 §7.16`, `docs/04 §2.9`)
- **In-app notification center** (`notifications` table): typed notifications, read/unread
  state, unread badge count, list + mark-read/mark-all-read, per-type payload.
- **Unified `NotificationService`** that **fans out** a single domain notification to the
  channels a user's preferences allow: **in-app + email + SMS + WhatsApp** (push = OUT, see
  below), via the queue seam (WS-1 queue) and the Mail/SMS/WhatsApp providers.
- **Per-user delivery preferences** (`notification_prefs`: `type × channel` matrix) + **quiet
  hours** (defer non-urgent channels during a user-configured window; in-app always allowed).
- **Templated messages** — a per-channel template registry (subject/body per notification
  type per channel) rendered server-side with a typed payload; **no vendor SDK in a feature
  module** (WS-1 goes through the providers).
- **Real-time delivery seam — RECOMMEND SSE with a polling fallback** (see Risk #4): a
  `GET /me/notifications/stream` Server-Sent-Events endpoint (authenticated, tenant/own-scoped)
  for live unread-badge + toast; the LMS client falls back to interval polling of
  `GET /me/notifications?unread` where SSE is unavailable (PWA/offline). SSE is chosen over
  WebSockets (one-way server→client, cheap on the modular monolith, no new infra).
- **Connect the deferred P4/P5 events:** grade-ready, certificate-ready (`CONFLICT-4`),
  lead/booking/registration/receipt confirmations (`CONFLICT-P5-2/-5`), live-reminder
  placeholder → all now fan out through `NotificationService`.

**WS-2 Campaigns** (`docs/03 §7.13`, `docs/06 §13`)
- **CRM-driven bulk campaigns** on **email / WhatsApp / SMS** (`campaigns` + `campaign_recipients`).
- **Audience segmentation** — build a recipient set from `leads`/`students` filters (stage,
  program-interest, batch, status, source, consent) → materialized to `campaign_recipients`.
- **Template management** — reusable campaign templates per channel (reuse the WS-1 template
  registry model; WhatsApp/SMS templates carry the **DLT/approved template id**).
- **Scheduling + throttling** — `schedule_at`, per-channel send-rate throttle (respect
  provider + DLT rate limits), queue-driven send (WS-1 `campaign-send` seam).
- **Delivery + open tracking** — per-recipient status (`queued|sent|delivered|read|failed`),
  provider webhook ingestion (delivery/read receipts) behind a verified webhook seam,
  aggregate `campaigns.metrics`.
- **Unsubscribe / consent (India DLT/DPDP compliance)** — honor `marketing_opt_in`; a
  **suppression list** + public unsubscribe link; skip non-consented recipients; never send a
  marketing message on a transactional-only channel without consent.
- **Idempotent send with per-recipient dedupe** — a recipient is sent at most once per
  campaign (`(campaign_id, recipient)` unique); replay/retry is a no-op (reuses the
  idempotency discipline of ADR-0014).

**WS-3 Gamification** (`docs/02 §7.12/§7.13/§19`)
- **Points/XP** (`points_ledger`: append-only `user_id, delta, reason, ref`), **badges /
  achievements** (`badges` catalog + `user_badges` awards), **streaks** (derived from
  daily-activity events), **leaderboards** (batch-level, opt-in, privacy-safe — display name
  or alias only, per `docs/02 §7.12`).
- **Event-driven** — a `GamificationService` consumes the existing domain events
  (lesson-completed, assignment on-time, assessment-passed, project-approved,
  certificate-issued, streak-day) and awards points/badges via the ledger. **No new emit
  points** invented where an event already exists; P6 subscribes to them.
- **Anti-abuse / idempotent award ledger** — every award carries a **dedupe key**
  `(user_id, reason, ref)` so replaying an event never double-awards; the ledger is
  append-only (points are never mutated, only added — reversals are negative-delta rows with
  audit). Leaderboard reads off an aggregated/cached projection (cache-aside, `docs/04 §2.7`).

**WS-4 Forum / community** (`docs/02 §7.14`, `docs/03` moderation)
- **Threaded discussions** scoped to a **course or batch** (`forum_threads`), posts + nested
  replies (`forum_posts` with `parent_id`), upvotes, mark-as-resolved (Q&A).
- **Moderation** — report / hide / pin (faculty/admin), delete (soft), moderation audit.
- **Notifications on reply** — a reply to your thread/post fans out via `NotificationService`
  (WS-1 dependency).
- **RBAC** — **students post only in threads for batches they are enrolled in**
  (enrollment-scoped, IDOR→404, ADR-0022 pattern); **faculty/admin moderate** their assigned
  batches (assigned-scope, ADR-0031 pattern); read is enrollment-scoped.
- **Sanitize** all rendered user-generated post/reply content (DOMPurify — widest UGC surface;
  resolves the carried P3 L-2 / P5 M-3 boundary for this surface).

### Explicitly OUT of P6 (gate decisions — justified)

- **Web Push / native push notifications.** `docs/02 §7.15` lists "push"; P6 ships **in-app +
  email + SMS + WhatsApp** only. Web-Push (VAPID/service-worker push) and native mobile push
  need a push provider + PWA push subscription flow — deferred to a later engagement/mobile
  phase. *Default: no push; `channels` enum is extensible so push slots in later.* (PRD
  conflict — record as CONFLICT-P6-1.)
- **Full marketing-automation builder / drip sequences / if-this-then-that** (`docs/03 §19`
  "automation builder", `docs/06 §13` conversions-attributed drip) → **P8**. P6 ships
  **single scheduled campaigns** (audience → template → schedule → send → track), not
  multi-step automated journeys. *Default: single-shot scheduled campaigns.*
- **Referral / affiliate programs** (`docs/03 §7.13`, `referrals` table). Marketing lists
  referrals alongside campaigns; the `referrals` schema exists in `docs/05 §3` but the
  program logic (reward attribution, payouts) is a **commerce/marketing depth** item →
  **deferred** (keep the table out of P6 unless a downstream campaign needs it). *Default:
  OUT.* (CONFLICT-P6-2.)
- **Landing-page / lead-form builder + blog CMS** (`docs/03 §7.13`) — P5 shipped MDX content
  (ADR-0035); the CRM authoring UI + headless content API remain the CMS-phase item. **OUT.**
- **Live-class reminders as a real live-class feature.** `live_classes` still isn't built
  (carried P3). P6 wires the **reminder notification path** (template + fan-out) but does
  **not** build the live-class scheduler / `LiveClassProvider` — the reminder fires off
  whatever event source exists; the live-class feature itself is deferred. *Default:
  notification path ready, no live-class feature.*
- **Analytics dashboards for engagement** (campaign ROI dashboard, gamification analytics,
  forum health metrics) → **P7**. P6 writes the tracking rows (`campaign_recipients.status`,
  `points_ledger`, `campaigns.metrics`); the dashboards that visualize them are P7. *Default:
  data captured, dashboards P7.*
- **Real BullMQ cluster / dedicated worker deployment + Redis Streams / dead-letter tooling
  depth.** See Risk #1 — P6 either installs BullMQ for the send workers OR continues the
  proven sync-seam; either way the heavy DLQ/observability tooling depth is P7 hardening.
- **AI-drafted campaign copy / summarize / lead-scoring** (`docs/03 §19`) → **P8.**
- **Forum full-text search + rich editor / attachments / @mentions.** P6 ships plain
  (sanitized) markdown-ish text posts + upvote/resolve/moderate. Full-text search
  (tsvector/Meilisearch, `docs/05 §4`) is carried to P7; rich media/mentions later. *Default:
  plain text, no search, no attachments.*

---

## 2. New DB tables/columns + new provider/queue seams (and what is reused)

All new tables from `docs/05 §3` "Engagement & support" (currently spec-only per `docs/05 §10`).
Every table: `id` (cuid) PK, `created_at`/`updated_at`/`deleted_at` soft-delete, `tenant_id`,
wired into the soft-delete + audit Prisma extensions, with the `docs/05 §4` indexes.
**Forward-only migration** — never edit shipped P0–P5 migrations.

### New DB tables

| Table | Columns (`docs/05 §3` + P6 detail) | Notes |
|-------|-----------------------------------|-------|
| `notifications` | `tenant_id`, `user_id` (FK users), `type` (enum `NotificationType`), `channels` Json (which channels this went to), `payload` Json (typed per type), `read_at` DateTime? | In-app center. Index `(user_id, read_at)` (unread counts, `docs/05 §4`). |
| `notification_prefs` | `tenant_id`, `user_id` (FK, uniq), `matrix` Json (`type × channel → bool`), `quiet_hours` Json? (`{start, end, tz}`) | One row per user; upsert. Defaults applied server-side when absent. |
| `notification_suppressions` | `tenant_id`, `user_id?`/`email?`/`phone?`, `channel` (enum), `reason` (`unsubscribe|bounce|complaint`), `created_at` | Suppression/unsubscribe list — WS-1 + WS-2 consult before send (India DLT/DPDP). |
| `campaigns` | `tenant_id`, `channel` (enum `CampaignChannel` `email|whatsapp|sms`), `template_id` (FK campaign_templates), `name`, `segment` Json (audience filter def), `schedule_at` DateTime?, `status` (enum `CampaignStatus`), `metrics` Json, `created_by` (FK users) | `CAMPAIGN ||--o{ CAMPAIGN_RECIPIENT`. Authored in CRM Marketing. |
| `campaign_templates` | `tenant_id`, `channel`, `name`, `subject?`, `body`, `dlt_template_id?` (India SMS/WhatsApp approved template id), `variables` Json | Reusable per-channel templates; WhatsApp/SMS carry the DLT id. |
| `campaign_recipients` | `tenant_id`, `campaign_id` (FK), `lead_id?`/`student_id?`/`user_id?`, `to` (resolved email/phone), `status` (enum `RecipientStatus` `queued|sent|delivered|read|failed`), `provider_message_id?`, `error?`, `sent_at?`, `delivered_at?`, `read_at?` | **Partial-unique `(campaign_id, coalesce(lead_id,student_id,user_id))` for per-recipient dedupe.** Provider webhook updates status. |
| `badges` | `tenant_id`, `key` (uniq per tenant), `name`, `description`, `icon`, `criteria` Json (rule descriptor), `status` | Catalog. Seeded set (`docs/02 §19`: first project, perfect attendance, top of batch, streak milestones). |
| `user_badges` | `tenant_id`, `user_id` (FK), `badge_id` (FK), `awarded_at`, `ref?` | Award. **Partial-unique `(user_id, badge_id) WHERE deleted_at IS NULL`** (a badge awarded once). |
| `points_ledger` | `tenant_id`, `user_id` (FK), `delta` Int, `reason` (enum/str), `ref?` (source event id), `created_at` | **Append-only.** **Partial-unique dedupe on `(user_id, reason, ref) WHERE deleted_at IS NULL`** — idempotent awards (anti-abuse). Never mutated; reversals are negative rows. |
| `forum_threads` | `tenant_id`, `batch_id?`/`program_id?` (course/batch scope), `author_id` (FK users), `title`, `status` (enum `ThreadStatus` `open|resolved|hidden|pinned`), `pinned` Bool, `resolved_post_id?` | Scoped to a batch/course. Index `(tenant_id, batch_id, status)`. |
| `forum_posts` | `tenant_id`, `thread_id` (FK), `author_id` (FK users), `body`, `parent_id?` (FK self — nested replies), `upvotes` Int default 0, `status` (enum `PostStatus` `visible|hidden`), `hidden_by?`, `hidden_reason?` | Body **sanitized on render**. Upvote via a small `forum_post_votes` dedupe (see below). |
| `forum_post_votes` | `tenant_id`, `post_id` (FK), `user_id` (FK) | **Partial-unique `(post_id, user_id)`** — one upvote per user (anti-abuse). Keeps `forum_posts.upvotes` a derived/cached count. |

> **`tickets` / `bookmarks`** (also under `docs/05 §3` "Engagement & support") are **OUT of
> P6** — tickets = the P-anything support desk (not an engagement feature named in `§6 P6`);
> bookmarks = an LMS convenience (P3/P7). Keep P6 to the four named workstreams.

### New enums
`NotificationType` (e.g. `grade_ready|certificate_ready|live_reminder|forum_reply|announcement|
lead_confirmation|booking_confirmation|payment_receipt|welcome`),
`NotificationChannel` (`in_app|email|sms|whatsapp`),
`CampaignChannel` (`email|whatsapp|sms`),
`CampaignStatus` (`draft|scheduled|sending|sent|paused|cancelled|failed`),
`RecipientStatus` (`queued|sent|delivered|read|failed`),
`ThreadStatus` (`open|resolved|hidden|pinned`), `PostStatus` (`visible|hidden`),
`SuppressionReason` (`unsubscribe|bounce|complaint`).

### Relations to wire (reverse relations on existing models)
- `User`: `notifications Notification[]`, `notificationPref NotificationPref?`,
  `userBadges UserBadge[]`, `pointsLedger PointsLedger[]`, `forumThreads`, `forumPosts`.
- `Batch`/`Program`: `forumThreads ForumThread[]`.
- `Lead`/`StudentProfile`: `campaignRecipients CampaignRecipient[]`.

### New provider + queue seams (behind DI token + Noop, fail-closed — `CLAUDE.md §1 rule 7`)
- **`MailProvider`** / `MAIL_PROVIDER` token — `send({ to, subject, html, text, tags })` →
  `{ providerMessageId }`; `verifyWebhookSignature(...)` for delivery/bounce receipts. Adapter:
  **SES / Resend** (env-selected), **NoopMailProvider** (deterministic, logs, no network).
  Bound via `useFactory` (ADR-0023 pattern), fail-closed in prod when unconfigured.
- **`WhatsAppProvider`** / `WHATSAPP_PROVIDER` token — `sendTemplate({ to, templateId,
  variables })` (India = template-gated) + `sendSession(...)` for in-window replies;
  `verifyWebhookSignature(...)`. Adapter: **WhatsApp Cloud API / Gupshup**, **Noop**.
  Fail-closed.
- **`SmsProvider` (MSG91) — REUSED** as the SMS channel (already built, ADR-0006); extend to
  carry a DLT template id per send if not already parameterized.
- **Queue seam decision (Risk #1):** a **`NotificationDispatchPort`** + **`CampaignSendPort`**
  behind DI tokens, bound to **`Sync*Adapter`s** by default (the proven ADR-0020 pattern) with
  a documented BullMQ migration path — OR, if the user approves installing `bullmq` (task #0),
  bound to `BullMq*Adapter`s writing to the `notifications` / `campaign-send` queues with
  `jobId`-based idempotency. **Default: sync-seam (green without new infra); BullMQ is
  ASK-USER.** Either binding: idempotent, retried, dead-letter on exhaustion when on BullMQ.

### Seed expansion (`prisma/seed.ts`)
- **Permission matrix** additions (`docs/03 §9`): `campaigns.view/create/edit/send/delete`
  (Marketing/Owner/Admin `all`, others none); `notifications.view` (own — all authed users);
  `forum.post` (student `own`/enrolled, faculty `assigned`), `forum.moderate`
  (faculty `assigned` / admin `all`); `gamification.view` (own). Public unsubscribe needs no
  auth (signed token).
- **Sample data:** default `notification_prefs` for the sample users; a seeded `badges`
  catalog (`docs/02 §19`) + one `user_badge` + a few `points_ledger` rows + a leaderboard-
  renderable set; one seeded `campaign_template` per channel (email + a WhatsApp/SMS template
  with a placeholder DLT id) + one draft `campaign`; one `forum_thread` + a couple of
  `forum_posts` on the sample batch; one sample `notification` (unread) for the sample student.

---

## 3. Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 0 | **PM gate — scope + engagement acceptance criteria + queue/DLT decisions.** Write **`docs/specs/phase-6-engagement.md`** (spec-first, matching the P4/P5 spec pattern): confirm the §1 OUT-of-scope gates vs `docs/02 §7.12/§7.14/§7.15/§19` + `docs/03 §7.13/§7.16` (no push; single-shot campaigns not automation; referrals OUT; live-class reminders = path-only; engagement dashboards P7). Produce the crisp **acceptance checklist** the QA + security waves assert against: (a) a graded assignment → the student gets an in-app notification + (if opted-in) email/WhatsApp, honoring quiet hours; (b) a campaign to a 3-recipient segment sends **exactly once per recipient** (idempotent), skips non-consented + suppressed recipients, and tracks delivery; (c) a lesson-completed event awards points **exactly once** (replay = no double-award) and a threshold crosses a badge; (d) a student can post only in an enrolled batch's thread (IDOR→404) and a reply notifies the thread author. Record the **queue decision** (sync-seam default vs BullMQ — see §7) + the **DLT/consent rule** (honor `marketing_opt_in`, suppression list, template-id-gated SMS/WhatsApp) + the **SSE-vs-polling** recommendation. Record CONFLICT-P6-1 (push), -2 (referrals), -3 (automation), -4 (live-class). | product-manager | — | **W1** (‖ #1) | §4: matches PRD acceptance criteria. `docs/02 §7.12/§7.14/§7.15`, `docs/03 §7.13/§7.16`. Spec + acceptance checklist + queue/DLT/SSE decisions signed off; conflicts recorded. |
| 1 | **Schema + migration + seed.** Add the 11 tables + enums + reverse relations per §2 (cuid PK, `tenant_id`, soft-delete + audit wired, `docs/05 §4` indexes incl. `notifications (user_id, read_at)`, **`campaign_recipients` per-recipient dedupe partial-unique**, **`points_ledger (user_id, reason, ref)` idempotency partial-unique**, **`user_badges (user_id, badge_id)` partial-unique**, **`forum_post_votes (post_id, user_id)` partial-unique**, `notification_prefs (user_id)` uniq). Forward-only migration applies clean over the P5 DB. Expand `seed.ts` per §2 (permission matrix + prefs + badges/points + campaign templates/draft + forum thread/posts + sample notification). Integration test: soft-delete filter + audit-on-mutation for each new table; **the four idempotency/dedupe uniques hold** (double-insert rejected); `points_ledger` append-only behavior. Run the full `AppModule` boot smoke test early (DEFECT-1 lesson). | db-architect | 0 | **W1** | §4: every table tenant_id + soft-delete + audit; migration forward-only; dedupe uniques. `docs/05 §3/§4/§10`. Migration + seed clean; extension + all dedupe-unique tests green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for — **Notifications** (`NotificationDto`, `ListNotificationsQuery` (unread filter), `MarkReadDto`, `NotificationPrefsDto` (matrix + quiet hours), SSE event shape), **Campaigns** (`CampaignDto` author/list, `SegmentDefDto` (audience filter), `CampaignTemplateDto`, `CampaignRecipientDto`, `CampaignMetricsDto`, public `UnsubscribeDto` (signed token)), **Gamification** (`PointsSummaryDto`, `BadgeDto`/`UserBadgeDto`, `LeaderboardEntryDto` (alias/opt-in-safe — **no PII beyond display name**), `StreakDto`), **Forum** (`ThreadDto`, `CreateThreadDto`, `PostDto`, `CreatePostDto` (parent_id), `ModerateDto`, `VoteDto`). Reuse `{data,meta,error}` + `Paginated<T>` + RFC-7807. Register in OpenAPI; regenerate `@repo/api-client`. **Type-level assertion that `LeaderboardEntryDto` cannot carry email/phone/PII**, and that notification/campaign DTOs never carry provider secrets or raw suppression internals. | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at boundary; leaderboard PII-minimal. `docs/04 §2.5/§2.14`. Client compiles; SDK methods exist for all endpoints; leaderboard/no-secret type assertions pass. |
| 3 | **`MailProvider` + `WhatsAppProvider` interfaces + adapters + Noop (integrations crux).** Two NEW provider seams following the established interface + DI `Symbol` token + Noop + `useFactory` + lazy-env-validate + fail-closed pattern (ADR-0006/0013/0023/0027): **`MailProvider`** (`send`, `verifyWebhookSignature`) with **SES + Resend** real adapters (env-selected) + **NoopMailProvider** (deterministic, no network); **`WhatsAppProvider`** (`sendTemplate` (DLT/template-gated for India), `sendSession`, `verifyWebhookSignature`) with **WhatsApp Cloud API / Gupshup** adapter + **Noop**. **Reuse `SmsProvider`/MSG91** as the SMS channel (parameterize the DLT template id per send if not already). Providers do NO business logic — vendor calls + signing only. Add env keys (SES/Resend/WhatsApp/DLT) to `.env.example` + the zod env schema; **fail-closed in prod when unconfigured**, Noop in dev/test. Unit tests: send shape + provider-message-id plumbing, webhook-signature verify pass/fail, fail-closed-when-unconfigured, Noop determinism (no live network); **no secret in any response/log**. | integrations | 1, 2 | **W3** | §4 + rule 7: vendor SDK only behind interface; env-validated; secrets via env; fail-closed. `docs/04 §2.10`. Mail + WhatsApp bound by token; SMS reused; Noop deterministic; fail-closed; unit tests green; no secret leak. |
| 4 | **Queue/dispatch seam + template registry (backend core-0).** Per the §7 queue decision: **`NotificationDispatchPort`** + **`CampaignSendPort`** behind DI tokens, bound to `Sync*Adapter`s (default, ADR-0020 pattern) **or** `BullMq*Adapter`s (if BullMQ approved) — with `jobId`/dedupe-key idempotency + retry/backoff + DLQ semantics documented either way. Build the **channel-agnostic template registry** (render a `NotificationType`/campaign template → per-channel `{subject, body}` from a typed payload, variable interpolation, **DLT-template-id passthrough** for SMS/WhatsApp). This is the shared substrate WS-1 + WS-2 both consume. Unit tests: sync/BullMQ adapter idempotency (same key = no double-dispatch), template render for each channel, DLT id passthrough, quiet-hours defer logic. | backend-builder | 1, 2, 3 | **W3** (‖ #3, shared dispatch concern) | §4 + `docs/04 §2.8/§2.9`: dispatch behind a port; idempotent; template registry. Adapter idempotency + template-render + quiet-hours unit tests green; BullMQ (if chosen) writes with `jobId`. |
| 5 | **Design-system primitives.** Add to `@repo/ui` ONLY what P6 needs and P0–P5 lacks, per `docs/07` + `docs/02 §12/§15` + `docs/03 §11/§15`: **NotificationBell** (unread badge, dropdown list, mark-read, SSE-fed live update, a11y live-region announcement), **NotificationItem**, **NotificationPrefsMatrix** (type×channel toggles + quiet-hours picker, keyboard-navigable), **BadgeChip / BadgeGrid**, **PointsBadge / StreakFlame** (reduced-motion aware), **LeaderboardTable** (opt-in, alias-safe), **ThreadList / ThreadCard**, **PostThread** (nested replies, upvote button, resolve/pin/report affordances), **CampaignBuilder shell** (segment step + template step + schedule step — reuses MultiStepForm), **AudienceSegmentFilter**, **CampaignMetricsCard**. All keyboard-first, focus-managed, AA, reduced-motion, with loading/empty/error; unit + a11y test each. | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard + SR labels + live-region for notifications); loading/empty/error; no color-only status; reduced-motion. `docs/07`, `docs/02 §15`, `docs/03 §15`. Each primitive unit+a11y tested; NotificationBell live-region announces; leaderboard alias-safe. |
| 6 | **Backend A — Notifications core module (WS-1).** NestJS `notifications` module, controller→service→repository, consuming `NotificationDispatchPort` (#4) + Mail/SMS/WhatsApp providers (#3). **`NotificationService.notify(userId, type, payload)`** → resolve prefs + quiet hours + suppressions → render templates (#4) → **fan out** to in-app (row) + email + sms + whatsapp per matrix, each via the dispatch port (idempotent). **Endpoints (own-scope):** `GET /me/notifications` (+ unread filter, paginated), `GET /me/notifications/stream` (**SSE**, authenticated, own-scoped), `POST /me/notifications/:id/read`, `POST /me/notifications/read-all`, `GET/PUT /me/notification-prefs`, public `GET /unsubscribe/:token` (signed). **Wire the deferred P4/P5 events** (`CONFLICT-4`, `-P5-2/-5`) to `notify(...)`: grade-ready, certificate-ready, lead/booking/registration/receipt confirmations. Own-scope + RBAC via guards; **IDOR→404** (a user reads only own notifications). Every fan-out audited at the dispatch boundary. | backend-builder | 1, 2, 3, 4 | **W4** | §4: own-scope RBAC; IDOR→404; fan-out honors prefs + quiet hours + suppressions; audit; no secret leak. `docs/02 §7.15`, `docs/03 §7.16`, `docs/04 §2.9`. Student reads own only; graded event fans out per prefs; SSE authenticated + own-scoped; unsubscribe honored. |
| 7 | **Backend B — Campaigns module (WS-2).** NestJS `campaigns` module (CRM Marketing surface), controller→service→repository, consuming `CampaignSendPort` (#4) + Mail/SMS/WhatsApp providers (#3). **CRM (all-scope, `campaigns.*`):** CRUD campaigns + templates, **build segment** (materialize `leads`/`students` filter → `campaign_recipients`, **skipping non-`marketing_opt_in` + suppressed**), schedule, send (queue via `CampaignSendPort`, **throttled**, **idempotent per-recipient** via `(campaign_id, recipient)` unique — replay = no-op), pause/cancel. **Provider webhook ingestion** (`POST /campaigns/webhooks/:channel`, **HMAC-verified** via provider `verifyWebhookSignature`, idempotent) → update `campaign_recipients.status` (delivered/read/failed) + aggregate `campaigns.metrics`. **Public** `GET/POST /unsubscribe/:token` (signed, adds to `notification_suppressions`). RBAC (`campaigns.send` = Marketing/Owner/Admin); every mutation audited; **DLT template id required for SMS/WhatsApp sends** (reject send if absent). | backend-builder | 1, 2, 3, 4 | **W4** (‖ #6, separate module) | §4: RBAC `all`-scope on campaigns; **idempotent per-recipient send**; consent/suppression honored; audit; webhook HMAC-verified. `docs/03 §7.13`, `docs/06 §13`. 3-recipient send = exactly once each; non-consented/suppressed skipped; delivery tracked; replay no-op; DLT-gated. |
| 8 | **Backend C — Gamification module (WS-3).** NestJS `gamification` module, controller→service→repository. **Event consumers (`GamificationService`):** subscribe to lesson-completed / assignment-on-time / assessment-passed / project-approved / certificate-issued / streak-day domain events → **award points/badges via the append-only ledger with a dedupe key `(user_id, reason, ref)`** (replay = no-op, anti-abuse). Streak derivation from daily-activity; badge award when `criteria` crosses. **Endpoints (own-scope + leaderboard):** `GET /me/gamification` (points, badges, streak), `GET /batches/:id/leaderboard` (**opt-in, alias/display-name only, no PII** — enrollment-scoped read; cache-aside per `docs/04 §2.7`). RBAC (`gamification.view` own); leaderboard opt-out honored. Award mutations audited (or ledger-is-audit — decide + record). **Idempotent by construction** (the dedupe unique from #1). | backend-builder | 1, 2 | **W4** (‖ #6/#7, separate module) | §4: own-scope RBAC; **idempotent award (no double-count on replay)**; leaderboard PII-minimal + opt-in; audit/ledger. `docs/02 §7.12/§7.13/§19`. Lesson-complete awards once; replay no double-award; badge threshold fires; leaderboard alias-safe + opt-out honored. |
| 9 | **Backend D — Forum module (WS-4).** NestJS `forum` module, controller→service→repository, consuming `NotificationService` (#6) for reply notifications. **Threads/posts (enrollment-scoped):** `GET /forum/threads?batchId` (enrolled-only read, IDOR→404), `POST /forum/threads` + `POST /forum/threads/:id/posts` (**students post only in enrolled batches**, ADR-0022 pattern), nested replies (`parent_id`), `POST /posts/:id/vote` (dedupe via `forum_post_votes` unique), `POST /threads/:id/resolve`. **Moderation (faculty/admin, assigned-scope, `forum.moderate`):** hide/pin/delete(soft)/unhide — audited. **Reply → `NotificationService.notify(threadAuthor, forum_reply, ...)`** (WS-1). Sanitize is enforced at render (frontend #10/#11) but the service **stores raw + validates length/shape**; server strips obvious HTML (defense-in-depth, P5 M-3). RBAC + enrollment/assigned scope; **IDOR→404**; every mutation audited. | backend-builder | 1, 2, 6 | **W5** (needs #6 for reply notify) | §4: enrollment-scope (student) / assigned-scope (faculty) RBAC; IDOR→404; moderation audited; reply notifies author. `docs/02 §7.14`. Student posts only in enrolled batch; faculty moderates assigned only; reply notifies; upvote deduped; cross-batch/cross-tenant blocked. |
| 10 | **LMS frontend — notifications + gamification + forum (student surface).** In `apps/lms` (Next.js PWA, extend existing shell): **NotificationBell** in the header (SSE-fed, unread badge, dropdown, mark-read) + a **Notifications** route (full list, filters, prefs page with matrix + quiet hours); fold **gamification** (PointsBadge, StreakFlame, BadgeGrid, opt-in LeaderboardTable) into the existing **Progress** surface (`docs/02 §7.10/§7.12`); a **Forum** route (ThreadList per enrolled course/batch, PostThread with nested replies, upvote, mark-resolved, report; **create thread/post only for enrolled batches** — UI hides what API forbids). **Sanitize all rendered forum + notification user content with DOMPurify** (resolves the carried UGC boundary). SSE with **polling fallback** where unavailable (offline/PWA). Own-scope only. loading/empty/error; a11y AA (keyboard, focus mgmt, notification live-region, reduced-motion). | frontend-builder | 6, 8, 9, 5, 2 | **W6** | §4: loading/empty/error; a11y (live-region + keyboard); own-scope only; **DOMPurify on forum/notification content**; no secret in bundle. `docs/02 §7.10/§7.12/§7.14/§7.15/§15`. Student sees own notifications + posts only in enrolled batches; SSE live badge with polling fallback; leaderboard opt-in. |
| 11 | **CRM frontend — campaigns + notifications-admin + forum-moderation (staff surface).** In `apps/crm` (Vite SPA, per-route files under `src/routes/`, TanStack Query over `@repo/api-client`, RHF+zod): **Marketing ▸ Campaigns** (list + **CampaignBuilder** (AudienceSegmentFilter → template → schedule → review) + **CampaignMetricsCard** (delivery/open/read) + pause/cancel, Email/WhatsApp/SMS with **DLT template id field**), **Admin ▸ Notifications** (template registry view / broadcast announcement compose), **forum moderation** views (report queue, hide/pin/resolve on assigned batches). RBAC-aware rendering (hide `campaigns.send`/`forum.moderate` when the API forbids; faculty sees only assigned-batch moderation). loading/empty/error; a11y AA (keyboard tables/drawers, SR labels, no color-only status); confirm on destructive (cancel campaign, hide post); no business logic in components (hooks). | frontend-builder | 7, 9, 5, 2 | **W6** (‖ #10) | §4: loading/empty/error; a11y; RBAC-aware (all/assigned-scoped); no business logic in components. `docs/03 §7.13/§7.16/§11/§15`. Marketing builds+schedules a campaign; metrics render; faculty moderates assigned only; destructive actions confirmed. |
| 12 | **Tests.** Unit (NotificationService fan-out honoring prefs/quiet-hours/suppressions; dispatch-port idempotency; template render + DLT passthrough; campaign segment build skips non-consent/suppressed; per-recipient dedupe; gamification award idempotency + badge-threshold + leaderboard alias-safety; forum enrollment-scope resolver; SSE auth). Integration (testcontainers PG/Redis + Noop Mail/SMS/WhatsApp): **the P6 headlines** — (a) graded event → in-app row + opted-in channels, **quiet-hours defers**, opted-out channels skipped; (b) campaign to a 3-recipient segment → **exactly one send per recipient (idempotent, replay/duplicate-webhook no-op)**, non-consented + suppressed skipped, delivery/read tracked via webhook, **DLT-gated send rejected without template id**, **unsubscribe suppresses future sends**; (c) lesson-completed → **points awarded exactly once (replay = no double-award)**, badge threshold fires, **leaderboard leaks no PII + honors opt-out**; (d) **forum IDOR** — student cannot read/post in a non-enrolled batch's thread (→404), faculty moderates only assigned batches, reply notifies the author; **cross-tenant** isolation on notifications/campaign_recipients/forum_posts/points_ledger (pay down S1-3). e2e (candidate): notification-center + forum-reply journey. a11y (axe) on new primitives + screens. Wire into CI. | qa-engineer | 6, 7, 8, 9, 10, 11 | **W7** | §4: unit + integration + e2e + a11y green; tests gate merge. `docs/02 §7.12/§7.14/§7.15`, `docs/03 §7.13`. Fan-out/quiet-hours + exactly-once campaign + idempotent gamification + forum-IDOR + cross-tenant proven. |
| 13 | **Security review.** **Campaign / messaging abuse (crux):** consent enforced (no marketing send without `marketing_opt_in`); **suppression/unsubscribe honored** (a suppressed recipient is never sent again); **DLT-template gating** (SMS/WhatsApp reject without an approved template id — India compliance); no unbounded send / no send-to-arbitrary-address injection; **provider webhook HMAC-verified** + idempotent (a forged delivery receipt can't corrupt status). **Notification IDOR:** a user reads/marks only own notifications (→404); **SSE stream authenticated + own-scoped** (no cross-user leakage on the stream). **Gamification anti-abuse:** award idempotency (dedupe key) can't be bypassed to farm points; ledger append-only; **leaderboard leaks no PII** (alias/display-name only) + opt-out honored. **Forum:** enrollment-scoped post/read (student can't post in non-enrolled batch → 404), assigned-scoped moderation, **UGC XSS** — DOMPurify on every rendered post/reply/notification (resolves carried P3 L-2 / P5 M-3 for this surface), stored-body length/shape validated. **Secret leakage:** Mail/WhatsApp/MSG91 secrets + webhook secrets never in responses/logs/bundle; unsubscribe token is a signed HMAC (not guessable/enumerable). **Cross-tenant** on all four new IDOR surfaces. Report high/crit as fix tasks; re-verify. | security-reviewer | 12 | **W8** | §4 + `docs/04 §7` gate: server RBAC + scope; consent/DLT enforced; no secret leak; audit; UGC sanitized. `docs/02 §17`, `docs/03 §17`, `docs/00 §7`. No high/crit open; consent/suppression/DLT, notification+forum IDOR, gamification anti-abuse, UGC-XSS, secret-leak, cross-tenant verified. |
| 14 | **Docs sync.** Update `README.md` (new modules + how to run/seed/verify P6; **Mail/WhatsApp providers Noop-by-default + how to set SES/Resend/WhatsApp keys + India DLT template ids**; the queue decision (sync-seam vs BullMQ) + how notifications/campaigns dispatch; how SSE + polling fallback work; how to exercise a campaign + unsubscribe). ADRs for P6 decisions (Mail/WhatsApp provider interfaces + Noop-until-keys + `useFactory`; NotificationService fan-out + prefs/quiet-hours/suppression model; queue seam sync-vs-BullMQ decision (extends ADR-0020); SSE-over-WebSocket + polling-fallback real-time seam; campaign per-recipient idempotency + DLT/consent gating; gamification append-only idempotent ledger + dedupe-key anti-abuse; leaderboard opt-in PII-minimization; forum enrollment/assigned-scope + UGC sanitization). Update `docs/05 §10` (the 11 P6 tables → Implemented P6). Create `docs/phase-6-followups.md` (web/native push → later; automation builder/drip + referrals/affiliate + AI copy → P8; forum full-text search + rich editor → P7; live-class feature + reminders real source; engagement dashboards → P7; BullMQ real worker/DLQ depth if sync-seam kept; carried S1-x + P4/P5 items). | docs-writer | 13 | **W8** | §4: short summary of what changed + how to verify. P6 closeout; `docs/05 §10` + ADRs + `docs/phase-6-followups.md` synced. |

---

## 4. Execution order (waves)

- **Wave 1:** #0 (product-manager — spec + acceptance + queue/DLT/SSE gate) ‖ #1
  (db-architect — schema + migration + seed; consumes #0's decisions for the seed but can
  start structural work immediately). Everything downstream depends on #1.
- **Wave 2 (parallel):** #2 (api-designer — contracts/SDK, needs #1) ‖ #5 (design-system —
  notification/gamification/forum/campaign primitives, needs nothing).
- **Wave 3 (parallel, shared dispatch concern):** #3 (integrations — Mail + WhatsApp
  providers + Noop, reuse SMS; needs #1+#2) ‖ #4 (backend — dispatch/queue seam + template
  registry; needs #1+#2+#3). Hard dependencies for the notification + campaign backends.
- **Wave 4 (parallel, separate modules):** #6 (backend — notifications core; needs #1+#2+#3+#4)
  ‖ #7 (backend — campaigns; needs #1+#2+#3+#4) ‖ #8 (backend — gamification; needs #1+#2).
  These three touch **separate NestJS modules** and separate tables → safe to parallelize; the
  shared substrate (#3/#4 providers + dispatch + templates) landed in W3.
- **Wave 5:** #9 (backend — forum; needs #1+#2 **and #6** for reply-notify). Sequenced after
  #6 because forum reply-notifications call `NotificationService`; keeping it its own wave
  avoids same-substrate contention with the W4 trio.
- **Wave 6 (parallel — different apps):** #10 (frontend — LMS student surface; needs
  #6+#8+#9+#5+#2) ‖ #11 (frontend — CRM staff surface; needs #7+#9+#5+#2). Different apps
  (`apps/lms` vs `apps/crm`) → no file contention.
- **Wave 7:** #12 (qa-engineer) — needs all backend + frontend landed.
- **Wave 8:** #13 (security-reviewer) → #14 (docs-writer).

> **Same-app / same-file contention notes:** the three W4 backend tasks are deliberately
> separate modules (notifications / campaigns / gamification) with separate repositories and
> tables — parallel-safe. Forum (#9) is pulled to W5 specifically because it depends on the
> notifications service (#6), not merely to serialize. The two frontend tasks (#10 LMS, #11
> CRM) are in different apps and run in parallel. Within W3, #3 (providers) and #4 (dispatch
> seam) share the "how does a message get sent" concern; #4 consumes #3's provider tokens, so
> land #3's interfaces/tokens first within the wave, then #4 wires the dispatch/template layer
> on them.

---

## 5. Reused engines (do NOT reinvent) — reuse map

| Need | Reuse (built) | Source |
|------|---------------|--------|
| SMS channel | `SmsProvider` / MSG91 | P0, ADR-0006 |
| Provider DI pattern (`useFactory`, Noop, fail-closed) | payment/video/storage/captcha | ADR-0013/0023/0027/0036 |
| Async-work seam (sync-adapter-behind-port, BullMQ migration path) | invoice-gen / webhook / cert-gen | ADR-0020/0029 |
| Idempotency discipline (unique-key = no double-effect) | payment idempotency + order→enrollment atomicity | ADR-0014 |
| RBAC + scope + IDOR→404 | `@RequirePermission` + `PermissionsGuard` + `ScopeInterceptor` | ADR-0009/0018/0022/0031 |
| Soft-delete + audit-on-mutation | Prisma extensions | ADR-0005 |
| Signed-token pattern (unsubscribe token) | `cert_uid` HMAC + `escapeJsonLd` | ADR-0028/0037 |
| DPDP consent record | `leads`/`bookings.consent` (`marketing_opt_in`, `ip_hash`) | P5, ADR-0038 |
| Deferred events waiting on fan-out | P4 grade/cert events, P5 lead/booking/registration/receipt | `CONFLICT-4`, `CONFLICT-P5-2/-5` |
| UGC sanitization | DOMPurify (LMS/CRM), `sanitize()` service | P4, P5 M-3 |
| Contracts + envelope + SDK | `@repo/types` + `{data,meta,error}` + `Paginated<T>` + `@repo/api-client` | P0–P5 |

---

## 6. Risks & open questions

1. **BullMQ is NOT installed — "queues already exist" is inaccurate (highest-leverage
   correction).** `docs/04 §2.8` specifies `email|sms|whatsapp|notifications|campaign-send`
   queues, but the repo processes async work via **synchronous idempotent adapters behind
   `*Port` DI tokens** (ADR-0020) — no `bullmq` dependency, no running workers. **Decision
   (default):** P6 ships the notification + campaign dispatch behind a **`*DispatchPort`
   sync-adapter** (idempotent, in-request) with a documented BullMQ migration path — **green
   with zero new infra**, consistent with every prior phase. **Installing `bullmq` + Redis
   workers is ASK-USER (§7)**; if approved, bind the `BullMq*Adapter`s (jobId idempotency,
   retry/backoff, DLQ). Either way, campaign bulk-send + notification fan-out are **idempotent
   by construction** (per-recipient / dedupe-key uniques), so correctness does not depend on
   the queue choice. Recorded as an ADR extending 0020.
2. **`MailProvider` + `WhatsAppProvider` do not exist yet (integrations crux).** Only
   `SmsProvider`/MSG91 is built. **Decision:** build both new interfaces + Noop + real adapters
   (SES/Resend, WhatsApp Cloud API/Gupshup) behind DI tokens, fail-closed, exactly like the
   existing providers; **Noop keeps P6 green** until keys. Real keys + DLT template ids are
   ASK-USER/user-supplied (§7). Recorded as an ADR.
3. **India DLT / consent compliance is load-bearing.** SMS + WhatsApp campaigns in India
   require **DLT-registered approved template ids** + explicit opt-in + unsubscribe.
   **Decision:** campaigns honor `marketing_opt_in` (from P5 consent), consult a
   **suppression/unsubscribe list** before every send, and **reject an SMS/WhatsApp send with
   no DLT template id**. QA + security assert non-consented/suppressed recipients are skipped
   and DLT-gating holds. The template ids are user-supplied per approved template (§7).
4. **Real-time seam: SSE vs WebSocket vs polling.** **Recommendation: SSE** (`GET
   /me/notifications/stream`) with an **interval-polling fallback** for the notification badge/
   toast. SSE is one-way (server→client), needs no new infra on the modular monolith, degrades
   gracefully behind proxies, and suits the PWA/offline reality (fall back to polling when the
   stream is unavailable). WebSockets are heavier and bidirectional (unneeded). **Decision:**
   SSE + polling fallback; recorded as an ADR. (If the user prefers polling-only for
   simplicity, the client polls `GET /me/notifications?unread` — the API is identical.)
5. **Gamification anti-abuse / idempotency.** Replayed domain events (at-least-once dispatch,
   webhook retries) must not double-award. **Decision:** the `points_ledger` and `user_badges`
   carry **partial-unique dedupe keys** (`(user_id, reason, ref)` / `(user_id, badge_id)`); the
   ledger is **append-only** (reversals = negative rows, audited). Leaderboard reads a cached
   aggregate. QA asserts replay-safety; security asserts you can't farm points by replaying.
6. **Leaderboard privacy.** `docs/02 §7.12` requires "opt-in, privacy-safe." **Decision:**
   leaderboard entries expose **display name / alias only** (no email/phone/PII), students
   **opt in** to appear, and opt-out removes them. `LeaderboardEntryDto` structurally omits
   PII (type-level assertion). Security verifies no PII on the endpoint.
7. **Forum is the widest UGC surface yet (XSS boundary).** Student-authored posts/replies +
   notification payloads render in LMS + CRM. **Decision:** DOMPurify on every render
   (resolves carried P3 L-2 / P5 M-3 for this surface); the service stores raw but
   length/shape-validated + strips obvious HTML (defense-in-depth). Enrollment-scoped
   post/read (IDOR→404), assigned-scoped moderation. Security verifies.
8. **Provider webhook ingestion (delivery/read receipts) is a new unauthenticated surface.**
   Mail/WhatsApp send delivery/read/bounce webhooks. **Decision:** each provider webhook is
   **HMAC-verified via `verifyWebhookSignature` (fail-closed when the secret is absent)** and
   **idempotent** by `provider_message_id` — reusing the P2 webhook discipline (ADR-0013/0020).
   A forged receipt cannot corrupt recipient status.
9. **CRM has no automated test infra (carried P4/P5).** CRM P6 screens are typecheck/lint/
   build-verified; unit tests are a carried gap. **Decision:** QA (#12) may stand up CRM test
   infra opportunistically; not required for the P6 gate (flag in followups). The backend +
   LMS + integration suites are the authoritative gate.
10. **Cross-tenant IDOR harness (S1-3).** Four fresh IDOR surfaces (notifications,
    campaign_recipients, forum_posts, points_ledger). Security (#13) adds cross-tenant
    isolation tests on each; full multi-tenant harness remains deferred.
11. **Connecting the deferred P4/P5 events without regressing them.** Wiring grade/cert/lead/
    booking/registration/receipt events to `NotificationService` must not change their existing
    emit/audit behavior. **Decision:** subscribe to the already-emitted events (no change to
    emitters); fan-out is additive. QA asserts the P4/P5 event/audit rows are unchanged and the
    new notification is additive.

---

## 7. Secrets / dependencies the user must supply or approve

**Dependencies requiring explicit approval before install (standing rule — do NOT `pnpm add`
without a yes):**
- **`bullmq` (+ its Redis worker wiring) — ASK USER, no default.** P6 is **green on the
  sync-seam** (Risk #1). Installing BullMQ turns the notification/campaign dispatch into real
  queued workers (jobId idempotency, retry/backoff, DLQ). *Default: sync-seam; BullMQ on
  approval.* Which + why is an ADR (extends 0020).
- **Mail SDK — ASK USER.** For the `MailProvider` real adapter: **AWS SES**
  (`@aws-sdk/client-sesv2`) *or* **Resend** (`resend`). The `MailProvider` interface isolates
  the choice; **Noop keeps P6 green** until approved. (`SES_*` / `RESEND_API_KEY` env vars
  already declared.)
- **WhatsApp SDK/client — ASK USER.** For the `WhatsAppProvider` adapter: **WhatsApp Cloud
  API** (direct `fetch`, likely no SDK needed) *or* **Gupshup** (SDK/HTTP). Noop until keys.
- **DOMPurify** for forum/notification UGC render — already approved/used P4; confirm the
  LMS + CRM render sinks are covered. **`isomorphic-dompurify`** if server-side sanitization is
  chosen — ASK USER if a new package.
- **SSE:** native to Next.js/Nest (no dependency); polling fallback is plain fetch. No install.

**Provider credentials — user-supplied (provider is Noop / fail-closed until set):**
- **Mail:** choose `MAIL_PROVIDER` (`ses|resend|noop`); for SES — `SES_REGION`,
  `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, verified sender domain; for Resend —
  `RESEND_API_KEY`, verified domain. Plus `MAIL_WEBHOOK_SECRET` for delivery/bounce receipts.
- **WhatsApp:** `WHATSAPP_PROVIDER` (`cloud_api|gupshup|noop`); for Cloud API —
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET` (HMAC); for Gupshup — its API key + app name. **Plus the approved
  WhatsApp message-template ids** (India template-gated).
- **SMS DLT (MSG91):** the existing `MSG91_AUTH_KEY`/`MSG91_SENDER`/`MSG91_TEMPLATE_ID` extend
  to campaigns; **India DLT-registered template ids per campaign template** are user-supplied.
- **Unsubscribe / notification signing secret:** `NOTIFICATION_SIGNING_SECRET` (HMAC) for the
  public unsubscribe token — env-only, zod-validated, never leaked (reuses the `cert_uid`
  signing model, ADR-0028). A dev default may be generated for local/test; **prod requires a
  real secret.**
- **All added to `.env.example` + the zod env schema; fail-closed in prod when unconfigured;
  Noop in dev/test** so `turbo run build lint test` is green without any live creds.

**NOT needed in P6:** no new payment keys (P2); no new storage keys beyond P4's (unless
campaign assets need it — kept OUT); no `LiveClassProvider` (deferred); the two exposed `cfat_`
Cloudflare video tokens **still need rotating** (carried from P3/P4/P5 followups).

**Product decisions (defaults chosen if no answer — confirmed in task #0):**
1. **Q1 (queue):** sync-seam default; BullMQ on approval. *Default: sync-seam.*
2. **Q2 (real-time):** SSE + polling fallback. *Default: SSE+polling.*
3. **Q3 (push):** OUT (in-app + email + SMS + WhatsApp only). *Default: no push (channels enum extensible).*
4. **Q4 (campaigns scope):** single scheduled campaigns; no automation builder/drip. *Default: single-shot.*
5. **Q5 (referrals/affiliate):** OUT of P6. *Default: OUT.*
6. **Q6 (DLT/consent):** honor `marketing_opt_in` + suppression list; SMS/WhatsApp send DLT-template-gated. *Default: enforced.*
7. **Q7 (leaderboard):** opt-in, alias/display-name only, no PII. *Default: opt-in + PII-minimal.*
8. **Q8 (mail/whatsapp vendor):** SES-or-Resend + Cloud-API-or-Gupshup — user picks; Noop until then. *Default: Noop.*

---

## 8. Definition of Done for the whole phase (gate to P7)

- [ ] Forward-only migration adds `notifications`, `notification_prefs`,
      `notification_suppressions`, `campaigns`, `campaign_templates`, `campaign_recipients`,
      `badges`, `user_badges`, `points_ledger`, `forum_threads`, `forum_posts`,
      `forum_post_votes` + the enums + reverse relations (cuid PK, `tenant_id`, soft-delete,
      `docs/05 §4` indexes incl. `notifications (user_id, read_at)` + the four idempotency/
      dedupe partial-uniques), wired to soft-delete + audit; seed creates the P6 permission
      matrix + prefs + badges/points + campaign templates/draft + forum thread/posts + a
      sample notification.
- [ ] zod DTOs for notifications/campaigns/gamification/forum + public unsubscribe in
      `@repo/types`, imported FE+BE; `@repo/api-client` regenerated; **`LeaderboardEntryDto`
      structurally omits PII**; no provider secret in any DTO.
- [ ] `MailProvider` + `WhatsAppProvider` behind interfaces + DI tokens (`useFactory`) with
      SES/Resend + Cloud-API/Gupshup adapters **fail-closed** until keys + Noop for dev/test;
      `SmsProvider`/MSG91 reused as the SMS channel; env zod-validated; **no secret to client/
      log.**
- [ ] Dispatch/queue seam (`NotificationDispatchPort` + `CampaignSendPort`) bound to sync
      adapters (default) or BullMQ (if approved) — idempotent, documented migration path; a
      channel-agnostic **template registry** with DLT-template-id passthrough.
- [ ] Backend: **notifications core** (`NotificationService` fan-out honoring prefs + quiet
      hours + suppressions across in-app/email/sms/whatsapp; own-scope center; **SSE** stream +
      polling fallback; the deferred P4/P5 events wired to real delivery); **campaigns**
      (segment build skipping non-consent/suppressed, scheduled + throttled + **idempotent
      per-recipient** send, provider-webhook delivery/read tracking, **DLT-gated**, public
      unsubscribe); **gamification** (event-driven **idempotent append-only ledger** + badges +
      streaks + **opt-in PII-minimal leaderboard**); **forum** (enrollment-scoped threads/posts,
      nested replies, deduped upvote, resolve, assigned-scoped moderation, **reply notifies
      author**) — all `@RequirePermission` + scope, **IDOR→404**, every mutation audited.
- [ ] `apps/lms`: NotificationBell (SSE + polling fallback) + Notifications route + prefs
      (matrix + quiet hours); gamification folded into Progress (points/badges/streak/opt-in
      leaderboard); Forum (enrolled-batch threads/posts/replies/upvote/resolve/report) — own-
      scope, DOMPurify on UGC, loading/empty/error, a11y AA. `apps/crm`: Marketing ▸ Campaigns
      (builder + metrics + DLT field + pause/cancel), Admin ▸ Notifications, forum moderation
      (assigned-scope) — RBAC-aware, loading/empty/error, a11y AA.
- [ ] **Acceptance proven by integration test:** (a) a graded assignment → in-app + opted-in
      channels, quiet-hours defers, opted-out skipped; (b) a 3-recipient campaign → **exactly
      one send per recipient (idempotent, replay/duplicate-webhook no-op)**, non-consented +
      suppressed skipped, delivery/read tracked, **DLT-gated send rejected without template
      id**, **unsubscribe suppresses future sends**; (c) lesson-completed → **points awarded
      exactly once (replay = no double-award)**, badge threshold fires, **leaderboard leaks no
      PII + honors opt-out**; (d) **forum IDOR** — student cannot read/post in a non-enrolled
      batch (→404), faculty moderates only assigned, reply notifies author.
- [ ] **Cross-tenant** isolation proven on notifications / campaign_recipients / forum_posts /
      points_ledger (S1-3 debt paid down for the new surfaces).
- [ ] Every mutating action (notification-prefs update, campaign send/pause/cancel, forum
      moderate, gamification reversal) writes an audit-log row with actor + before/after.
- [ ] Unit + integration + a11y green; `turbo run build lint test` + `test:integration` green.
- [ ] a11y AA pass on new `@repo/ui` primitives (NotificationBell/PrefsMatrix/BadgeGrid/
      LeaderboardTable/PostThread/CampaignBuilder) and the new LMS/CRM screens (keyboard,
      focus mgmt, notification live-region, reduced-motion, no color-only status).
- [ ] security-reviewer sign-off: no high/critical open on campaign consent/suppression/DLT,
      notification + forum IDOR, SSE own-scoping, gamification anti-abuse, leaderboard PII,
      UGC-XSS, provider-webhook forgery, secret leakage, cross-tenant.
- [ ] README + ADRs + `docs/phase-6-followups.md` synced; `docs/05 §10` reflects the 11 P6
      tables as Implemented (P6); push / automation builder / referrals / AI copy / forum
      search / live-class feature / engagement dashboards / BullMQ-worker-depth tracked as
      follow-ups.
```
