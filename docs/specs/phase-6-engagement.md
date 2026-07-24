# Spec: Phase 6 — Engagement (Notifications, Campaigns, Gamification, Forum)

> Written by: product-manager · Phase: P6 · Date: 2026-07-03
> Consumed by: db-architect (#1), api-designer (#2), integrations (#3), backend-builder (#4, #6, #7, #8, #9),
> design-system (#5), frontend-builder (#10, #11), qa-engineer (#12), security-reviewer (#13), docs-writer (#14).
>
> **Architecture decisions are LOCKED** (baked into ACs). Do not re-open queue/SSE/DLT choices.
> Every numbered AC below maps directly to a test in task #12 and a security check in task #13.

---

## Why (purpose + which metric it moves)

Phase 6 is the phase that finally **sends**. P4 wrote grade/certificate domain events and audit rows
but deferred fan-out (CONFLICT-4). P5 lead/booking/registration/receipt confirmations enqueued the
event but deferred real delivery (CONFLICT-P5-2, -5). P6 builds the fan-out engine, the Mail and
WhatsApp provider seams those deferred events have been waiting on, and three more workstreams —
bulk campaigns, gamification, and threaded forum — to close the learning engagement loop.

**Metrics moved:**

| Metric | Direction | Mechanism |
|--------|-----------|-----------|
| WAU/MAU in-batch (target ≥ 0.6) | Up | Forum discussion, gamification streaks, timely grade/deadline notifications pull students back |
| Program completion % (target ≥ 60%) | Up | On-time grade notifications, deadline reminders, streak mechanics reduce drop-off |
| Lead→paid conversion (target ≥ 15%) | Up | Lead/booking/payment confirmation emails/WhatsApp now actually send (P5 enqueued, P6 delivers) |
| Certified outcomes per month (North Star) | Up | Certificate-ready notification prompts students to download and share, driving referrals |

---

## Users and roles affected

| Role | Scope | New capabilities in P6 |
|------|-------|------------------------|
| Student | own / enrolled batches | Receive in-app + email + SMS + WhatsApp notifications; manage delivery preferences + quiet hours; earn XP, badges, streaks; opt into leaderboard; create + reply to forum threads in enrolled batches; upvote, mark-resolved |
| Faculty / Mentor | assigned batches | Moderate forum threads/posts in assigned batches (hide/pin/resolve); receive forum-reply notifications; post in forum threads for assigned batches |
| Counsellor | — | Receive lead/booking confirmation delivery confirmation; no new CRM screens |
| Marketing | all | Build and send email/WhatsApp/SMS campaigns; manage campaign templates (with DLT template ids); view per-recipient delivery metrics; pause/cancel campaigns |
| Admin / Owner | all | All of the above; broadcast announcements; manage notification template registry; view all campaign metrics |
| Ops / Branch Manager | branch | View branch-scoped notifications and forum state |
| Public (unauthenticated) | n/a | Unsubscribe from marketing comms via signed token link |

RBAC is server-enforced (`@RequirePermission` + `ScopeInterceptor`). The UI hides what the API
already forbids. A student can never read another student's notifications or forum posts outside
their enrolled batch. Faculty moderate only assigned batches.

---

## Locked Architecture Decisions (gate-confirmed, not up for debate)

**LOCK-D1: Dispatch = sync-seam (default)**
Notification fan-out and campaign send dispatch are routed through `NotificationDispatchPort` and
`CampaignSendPort` behind DI tokens, bound to synchronous idempotent adapters (ADR-0020 pattern).
BullMQ is not installed. Correctness comes from DB-level dedupe unique constraints — not queue
semantics. A documented BullMQ migration path exists. This is the default; BullMQ requires explicit
user approval and an ADR extending ADR-0020.

**LOCK-D2: Mail provider = Resend (real adapter); WhatsApp = WhatsApp Cloud API (real adapter)**
Both new provider interfaces follow the DI token + Noop + `useFactory` + fail-closed pattern of
ADR-0006/ADR-0013/ADR-0023/ADR-0027. Noop keeps P6 green until credentials are supplied.
`SmsProvider`/MSG91 is reused as the SMS channel (already built, ADR-0006).

**LOCK-D3: Real-time = SSE + polling fallback**
`GET /me/notifications/stream` is a Server-Sent-Events endpoint (authenticated, own-scoped).
The LMS client falls back to interval polling of `GET /me/notifications?unread=true` when SSE
is unavailable (offline / PWA / proxy). No WebSockets. No VAPID/web-push.

**LOCK-D4: India DLT/DPDP compliance is enforced, not optional**
Every SMS and WhatsApp send (transactional or campaign) requires a `dlt_template_id` field on
the template. A send without a `dlt_template_id` is rejected at the service layer with a 422
`DLT_TEMPLATE_ID_REQUIRED` error. Campaign sends honor `marketing_opt_in` from P5 consent and
consult the `notification_suppressions` table before every send.

**LOCK-D5: Leaderboard is opt-in and PII-minimal**
Leaderboard entries expose display name or alias only. Email, phone, enrollment ID, and all other
PII are excluded at the DTO level. Students who have not opted in are excluded from the
leaderboard query. Opt-out removes the student from the projection immediately.

---

## Part 1 — Locked Scope Decisions

### LOCK-1: Push Notifications — OUT of P6

Web Push (VAPID/service-worker) and native mobile push are OUT. P6 ships in-app notification
center + email + SMS + WhatsApp only. The `NotificationChannel` enum is extensible so push can
be added in a later engagement or mobile phase without schema changes. This resolves the PRD
conflict recorded as **CONFLICT-P6-1** (`docs/02 §7.15` lists push; P6 defers it).

### LOCK-2: Referral / Affiliate Programs — OUT of P6

The `referrals` table exists in `docs/05 §3`; the program logic (reward attribution, payouts,
referral code tracking) is a commerce-depth / marketing-depth item. Deferred. The campaign
segment builder does not surface referral codes in P6. Recorded as **CONFLICT-P6-2**.

### LOCK-3: Marketing Automation Builder — OUT of P6 (→ P8)

`docs/03 §19` mentions an automation builder (if-this-then-that, drip sequences). P6 ships
single-shot scheduled campaigns only (audience → template → schedule → send → track). Multi-step
journeys with conditional branching are P8. Recorded as **CONFLICT-P6-3**.

### LOCK-4: Live-Class Feature — Deferred; Reminder Notification Path Only

`live_classes` as a schedulable entity is not built in P6 (carried since P3). P6 wires the
live-class reminder notification template and fan-out path so it is ready when the live-class
scheduler is built. No `LiveClassProvider` is instantiated; no live-class CRM screens are added.
Recorded as **CONFLICT-P6-4**.

### LOCK-5: Engagement Analytics Dashboards — OUT of P6 (→ P7)

P6 writes all the raw tracking rows (`campaign_recipients.status`, `points_ledger`,
`campaigns.metrics`, forum upvote/post counts). The dashboards that visualize engagement ROI,
gamification analytics, and forum health are P7.

### LOCK-6: Forum Richness — Plain Text Only

P6 ships sanitized plain-text posts with markdown-ish rendering. No rich text editor, no
attachments, no `@mentions`, no full-text search (tsvector/Meilisearch deferred to P7), no
inline media.

---

## Part 2 — User Stories by Workstream

### WS-1: Notifications Core

- As a student, I receive an in-app notification when an assignment is graded so I can act on the
  feedback immediately.
- As a student, I see an unread badge on the notification bell and a toast when a new notification
  arrives, updated in real time via SSE without a page refresh.
- As a student, I can open the notifications center and see a paginated list of all my
  notifications (newest first) with read/unread distinction.
- As a student, I can mark individual notifications as read or mark all as read at once.
- As a student, I can configure which notification types I receive on which channels (in-app,
  email, SMS, WhatsApp) via a preferences matrix.
- As a student, I can set quiet hours so non-urgent channels (email, SMS, WhatsApp) are deferred
  outside my active window; in-app notifications always arrive immediately.
- As a student, I can click a one-click unsubscribe link in any marketing email and be immediately
  suppressed from further marketing sends without needing to log in.
- As a student, I receive a confirmation email/WhatsApp after registering, booking a slot, or
  completing a payment — channels I have opted into at the time of consent (deferred events from
  P5 now fan out).
- As a student, I receive an in-app + opted-in channel notification when my certificate is ready
  (deferred event from P4 now fans out).
- As a faculty member, I receive a notification when a student posts in a forum thread I am
  participating in.

### WS-2: Campaigns (CRM — Marketing Role)

- As a marketing user, I can create a campaign template per channel (email, WhatsApp, SMS) with
  a name, subject (email), body, variable placeholders, and — for WhatsApp and SMS — a
  `dlt_template_id` (India DLT-approved template identifier).
- As a marketing user, I can save a campaign template without a `dlt_template_id` for email but
  cannot save one for WhatsApp or SMS without a `dlt_template_id`.
- As a marketing user, I can build a campaign by selecting a template, defining an audience
  segment (filters on `leads`/`students`: stage, program interest, batch, status, source,
  enrollment status), scheduling a send time, and previewing the recipient count before
  confirming.
- As a marketing user, I can see exactly which recipients were excluded from the segment because
  they have `marketing_opt_in = false` or appear on the suppression list, before sending.
- As a marketing user, I can schedule a campaign for a future `schedule_at` or send it immediately.
- As a marketing user, I can pause or cancel a campaign that is in `scheduled` or `sending` state.
- As a marketing user, I can view per-recipient delivery status (queued / sent / delivered / read /
  failed) and aggregate campaign metrics (sent count, delivery rate, read rate, failure count).
- As a marketing user, I see delivery/read receipts updated automatically as provider webhooks
  arrive (no manual refresh required).

### WS-3: Gamification

- As a student, I earn XP points automatically when I complete a lesson, submit an assignment
  on time, pass an assessment, have a project approved, or maintain a daily streak.
- As a student, I receive a badge when I cross a defined threshold (e.g., first project
  completed, perfect attendance, streak milestones, top of batch).
- As a student, I can see my current XP total, all earned badges, and my active streak length
  in my Progress view.
- As a student, I can opt in to appear on the batch leaderboard, choosing a display name or
  alias; my real name, email, and other PII are never visible to other students on the
  leaderboard.
- As a student, I can opt out of the leaderboard at any time and my entry is removed.
- As a student, the same event (e.g., completing a specific lesson) can only award me points
  once, even if the event is replayed due to a system retry.

### WS-4: Forum / Community

- As a student enrolled in a batch, I can view the forum threads for that batch.
- As a student enrolled in a batch, I can create a new forum thread with a title and post body.
- As a student, I can post a reply to any thread or nested reply to any post within threads of
  my enrolled batches.
- As a student, I can upvote a post once; a second tap on the same post removes my upvote
  (toggle). I cannot upvote my own post.
- As a student who asked a question, I can mark the thread as resolved (linking the helpful
  post). I can also mark my own thread as unresolved to re-open discussion.
- As a student, I receive an in-app notification when someone replies to a thread I authored.
- As a faculty member, I can moderate forum threads and posts in batches assigned to me: hide
  a post with a reason, pin a thread, unhide a post, and soft-delete a post. Each moderation
  action is audit-logged.
- As a faculty member, I can see a moderation report queue of reported posts in my assigned
  batches in the CRM.
- As an admin, I can moderate forum content across all batches.
- As any user, rendered forum post content is sanitized and cannot execute injected scripts.

---

## Part 3 — Acceptance Criteria (Given / When / Then)

> ACs are numbered sequentially. QA task #12 tests them all; security task #13 asserts the
> security-marked ACs. The four **headline ACs** are: **AC-6** (graded assignment → fan-out),
> **AC-27** (campaign exactly-once), **AC-44** (lesson-complete gamification idempotency),
> **AC-56** (forum IDOR). Total AC count: **78**.

---

### WS-1A: In-App Notification Center

**AC-1 — Notification created on grade event**
Given a student whose submission has just been graded (domain event emitted by P4 grading service),
When `NotificationService.notify(userId, 'grade_ready', payload)` is called,
Then a `notifications` row exists with `user_id = student`, `type = 'grade_ready'`, `read_at = null`,
`tenant_id` matching the student's tenant, and `payload` containing the assignment ID and score.

**AC-2 — Unread badge count is accurate**
Given a student with 3 unread notifications,
When the student calls `GET /me/notifications?unread=true`,
Then the response has `meta.total = 3` and all returned rows have `read_at = null`.

**AC-3 — Mark single notification read**
Given a student with an unread notification `id = X`,
When the student POSTs to `POST /me/notifications/X/read`,
Then the response is 200, the `notifications` row has `read_at` set to a non-null timestamp,
and a subsequent `GET /me/notifications?unread=true` does not include `X`.

**AC-4 — Mark all read**
Given a student with 5 unread notifications,
When the student POSTs to `POST /me/notifications/read-all`,
Then the response is 200 and all 5 rows for that student have `read_at` set; the student's
subsequent unread count is 0.

**AC-5 — IDOR: student reads only own notifications**
Given Student A's notification ID `N-A` and Student B,
When Student B calls `GET /me/notifications` or `POST /me/notifications/N-A/read`,
Then `N-A` never appears in Student B's list and the mark-read call returns 404 (not 403 —
IDOR-safe, no information leakage about the existence of N-A).

---

### WS-1B: Notification Fan-Out (the headline AC — four-channel, prefs-aware)

**AC-6 — HEADLINE: Graded assignment → in-app + opted-in channels, prefs honored**
Given Student S has `notification_prefs` with `grade_ready × in_app = true`, `grade_ready × email = true`,
`grade_ready × whatsapp = false`, `grade_ready × sms = false`,
And Student S is not on the suppression list for email,
And the current server time is outside Student S's configured quiet hours,
When an assignment is graded (domain event fires → `NotificationService.notify(S.id, 'grade_ready', {...})`),
Then:
- An `in_app` `notifications` row is created for Student S (channel recorded in `channels` JSON),
- `MailProvider.send(...)` is called exactly once with the rendered grade-ready email body,
- `WhatsAppProvider.sendTemplate(...)` is NOT called,
- `SmsProvider.send(...)` is NOT called,
- The `notifications` row `channels` field records `{in_app: true, email: true, whatsapp: false, sms: false}`.

**AC-7 — All channels opted out → only in-app**
Given Student S has all non-in-app channels set to `false` in their `notification_prefs`,
When a notification is dispatched for Student S,
Then only the in-app row is created; no external provider (`MailProvider`, `WhatsAppProvider`,
`SmsProvider`) is called. In-app cannot be disabled.

**AC-8 — Missing prefs → default prefs applied server-side**
Given Student S has no `notification_prefs` row,
When a notification is dispatched,
Then the service applies the system default preference matrix (in-app enabled, other channels
per configured defaults) without error. No 500 is returned.

**AC-9 — Quiet hours: non-urgent channels deferred**
Given Student S's quiet hours are `{start: "22:00", end: "07:00", tz: "Asia/Kolkata"}`,
And the current time in `Asia/Kolkata` is 23:30,
And a non-urgent `announcement` notification fires,
When the fan-out runs,
Then the in-app row is created immediately, but `MailProvider.send` and
`WhatsAppProvider.sendTemplate` and `SmsProvider.send` are NOT called at this time; they
are scheduled to dispatch after 07:00 IST (the deferred send is recorded in the dispatch
port with the appropriate defer timestamp).

**AC-10 — Quiet hours do not apply to urgent notifications**
Given the same quiet hours as AC-9 and a `certificate_ready` notification typed as urgent
in the server config,
When the notification dispatches at 23:30 IST,
Then `MailProvider.send` is called immediately (urgent overrides quiet hours).

**AC-11 — Suppressed user: external channel skipped**
Given Student S appears in `notification_suppressions` for channel `email` with reason `unsubscribe`,
When a notification for Student S fires that includes the email channel in their prefs,
Then `MailProvider.send` is NOT called; the in-app row is still created. The channels JSON
reflects `{email: false}` with a reason note.

**AC-12 — Provider Noop does not throw in dev/test**
Given `MAIL_PROVIDER=noop` and `WHATSAPP_PROVIDER=noop` environment variables,
When a notification fan-out runs,
Then `NoopMailProvider.send(...)` and `NoopWhatsAppProvider.sendTemplate(...)` return
deterministic success responses without making any network calls; no error is thrown.

**AC-13 — Provider fail-closed in prod when unconfigured**
Given `MAIL_PROVIDER=resend` and `RESEND_API_KEY` is absent (empty or unset),
When the NestJS application boots in production mode (`NODE_ENV=production`),
Then the application fails to start with a descriptive config-validation error before
accepting any HTTP traffic. No partial-boot state is reachable.

---

### WS-1C: SSE Real-Time Delivery

**AC-14 — SSE stream is authenticated and own-scoped**
Given an authenticated student opens `GET /me/notifications/stream` (SSE),
Then the connection is established with `Content-Type: text/event-stream`; the stream emits
only events whose `user_id` matches the authenticated student; no other student's notifications
appear on this stream.

**AC-15 — SSE stream rejects unauthenticated requests**
Given a request to `GET /me/notifications/stream` with no valid JWT,
Then the server responds 401 before opening any SSE connection.

**AC-16 — SSE delivers new notification within 2 seconds**
Given an authenticated student with an open SSE connection,
When `NotificationService.notify(student.id, ...)` creates a new `notifications` row,
Then an SSE event is emitted on the stream within 2 seconds containing the notification
payload (type, id, read_at = null).

**AC-17 — Polling fallback delivers latest unread**
Given a student who cannot use SSE (e.g., polling-only client),
When the client polls `GET /me/notifications?unread=true`,
Then the response includes all unread notifications for that student, ordered by
`created_at DESC`, and the response time is < 300 ms (p95) for up to 100 notifications.

---

### WS-1D: Notification Preferences

**AC-18 — Student reads their own prefs**
Given Student S,
When `GET /me/notification-prefs` is called,
Then the response includes the full `type × channel` matrix and `quiet_hours` for Student S.
If no row exists, system defaults are returned (not a 404).

**AC-19 — Student updates prefs**
Given Student S with in-app prefs currently set,
When `PUT /me/notification-prefs` is called with a valid `NotificationPrefsDto`,
Then the `notification_prefs` row is upserted (created if absent, updated if present), an
audit-log entry is written, and a subsequent `GET /me/notification-prefs` reflects the change.

**AC-20 — Student cannot update another student's prefs**
Given Student S authenticated,
When any attempt is made to update another user's notification prefs (e.g., by supplying
a different user ID in the request),
Then the API returns 403 or 404 (own-scope enforced server-side; no URL parameter is trusted
from the client for user identity).

---

### WS-1E: Unsubscribe (India DPDP Compliance)

**AC-21 — Public unsubscribe link is signed HMAC, not guessable**
Given a marketing email sent to a recipient's email address,
When the unsubscribe URL in the email is inspected,
Then it contains a signed token derived from `HMAC(NOTIFICATION_SIGNING_SECRET, userId + channel + nonce)`;
the recipient's raw user ID or email is not directly decodable from the URL without the signing secret.

**AC-22 — Unsubscribe adds to suppression list**
Given a valid signed unsubscribe token for user S on channel `email`,
When `POST /unsubscribe/:token` is called (no authentication required),
Then a `notification_suppressions` row is created for `user_id = S`, `channel = email`,
`reason = 'unsubscribe'`, and the response is 200 with a confirmation message; no login is required.

**AC-23 — Suppressed recipient never receives future sends**
Given user S is on the `notification_suppressions` table for `channel = email`,
When any subsequent notification fan-out or campaign send targets user S on the email channel,
Then `MailProvider.send` is NOT called for user S on that send. The suppression check is
evaluated before provider dispatch, not after.

**AC-24 — Tampered unsubscribe token is rejected**
Given an unsubscribe token where one character is flipped,
When `POST /unsubscribe/:token` is called,
Then the API returns 400 `INVALID_TOKEN` with no suppression row created and no information
about the targeted user is exposed.

---

### WS-1F: Deferred P4/P5 Events Now Fan Out

**AC-25 — Certificate-ready notification delivered (CONFLICT-4 resolved)**
Given a certificate has been issued for Student S (P4 domain event),
And Student S has `certificate_ready × in_app = true` and `certificate_ready × email = true` in prefs,
When the P6 notification consumer processes the certificate-issued event,
Then an in-app `notifications` row is created for Student S and `MailProvider.send(...)` is called
with a rendered certificate-ready email; the P4 domain event and audit rows are unchanged (fan-out
is additive).

**AC-26 — Payment receipt email delivered (CONFLICT-P5-2 resolved)**
Given a payment was verified and an enrollment was created (P5 payment-verified event),
And the student opted in to email at registration (`marketing_opt_in = true` or transactional allowed),
When the P6 notification consumer processes the event,
Then `MailProvider.send(...)` is called with the rendered payment receipt email; the P5 enrollment
audit rows are unchanged.

---

### WS-2A: Campaigns — Exactly-Once Send (the headline AC)

**AC-27 — HEADLINE: Campaign to a 3-recipient segment sends exactly once per recipient**
Given a campaign with 3 recipients (R1, R2, R3) in `campaign_recipients` with `status = 'queued'`,
When the campaign is sent (via `CampaignSendPort` dispatch),
Then:
- Each of R1, R2, R3 receives exactly one send call to the relevant provider adapter,
- The `campaign_recipients` rows for R1, R2, R3 transition to `status = 'sent'` with `sent_at` set,
- Replaying the same dispatch (simulating a retry or duplicate webhook) results in a no-op
  (the rows are already in `sent` or later state; no second provider call is made),
- The total provider send calls across both the original and the replay is exactly 3.

**AC-28 — Per-recipient dedupe unique prevents double-insert**
Given a `campaign_recipients` row already exists for `(campaign_id = C, lead_id = L)`,
When a second insert of the same `(C, L)` pair is attempted (e.g., due to a segment re-build),
Then the DB constraint `partial_unique(campaign_id, coalesce(lead_id, student_id, user_id))`
rejects the duplicate with a conflict error; the service handles this as a no-op (not a 500).

**AC-29 — Non-consented recipients excluded from segment**
Given a segment build query targets leads where `marketing_opt_in IS NULL OR marketing_opt_in = false`,
When the campaign `campaign_recipients` rows are materialized,
Then zero rows are created for leads/students with `marketing_opt_in = false` or `null`;
no provider call is made for those recipients even if they match other segment filters.

**AC-30 — Suppressed recipients skipped**
Given recipient R appears on `notification_suppressions` for the campaign's channel,
When the campaign send runs,
Then no provider call is made for R; R's `campaign_recipients` row transitions to `status = 'failed'`
with `error = 'suppressed'`; the overall campaign is not aborted.

**AC-31 — DLT template id required for SMS/WhatsApp campaign**
Given a campaign with `channel = 'whatsapp'` and the selected `campaign_template` has `dlt_template_id = null`,
When a user attempts to trigger send (either immediate or scheduled),
Then the API returns 422 `DLT_TEMPLATE_ID_REQUIRED` and no `campaign_recipients` rows are created,
no provider call is made, and the campaign status remains `draft` or `scheduled` (unchanged).

**AC-32 — DLT template id not required for email campaigns**
Given a campaign with `channel = 'email'` and `campaign_template.dlt_template_id = null`,
When the campaign is sent,
Then no 422 error is returned; the send proceeds normally.

**AC-33 — Unsubscribe during campaign suppresses future sends to that recipient**
Given campaign C is in `sending` state with recipient R1 at `status = 'queued'`,
When R1 clicks the unsubscribe link (adding them to `notification_suppressions`) before their
individual send is dispatched,
Then when the dispatch reaches R1, the suppression check fires and R1's row transitions to
`status = 'failed'` with `error = 'suppressed'`; no provider call is made for R1.

**AC-34 — Empty segment is handled gracefully**
Given a campaign's segment filters match zero eligible recipients (e.g., all have opted out),
When the campaign send is triggered,
Then the campaign transitions to `status = 'sent'` with zero recipients; `campaigns.metrics`
records `{sent: 0, delivered: 0, read: 0, failed: 0}`; no error is returned to the caller;
a structured log entry records the empty segment.

**AC-35 — Campaign can be paused mid-send**
Given campaign C is `status = 'sending'` with some recipients still `queued`,
When a marketing user calls the pause endpoint,
Then the campaign transitions to `status = 'paused'`; dispatch for remaining `queued` recipients
halts; already-sent recipients are unaffected; the campaign can subsequently be resumed.

**AC-36 — Campaign can be cancelled**
Given campaign C is `status = 'scheduled'` or `status = 'paused'`,
When a marketing user with `campaigns.send` permission calls the cancel endpoint,
Then the campaign transitions to `status = 'cancelled'`; all `queued` recipient rows transition
to `status = 'failed'` with `error = 'campaign_cancelled'`; an audit-log entry is written.

---

### WS-2B: Campaigns — Delivery Tracking via HMAC-Verified Webhook

**AC-37 — Provider webhook updates recipient status**
Given a campaign recipient row with `provider_message_id = 'M1'` and `status = 'sent'`,
When the Resend/WhatsApp Cloud API posts a delivery webhook to `POST /campaigns/webhooks/:channel`
with `provider_message_id = 'M1'` and `event = 'delivered'`,
And the webhook body passes `MailProvider.verifyWebhookSignature(...)` (valid HMAC),
Then the `campaign_recipients` row for `provider_message_id = 'M1'` transitions to
`status = 'delivered'` with `delivered_at` set; `campaigns.metrics.delivered` is incremented.

**AC-38 — Duplicate/replayed webhook is a no-op**
Given the same webhook payload for `provider_message_id = 'M1'` with `event = 'delivered'`
arrives a second time,
When the handler processes it,
Then the row's `delivered_at` is not overwritten; no duplicate audit row is created;
`campaigns.metrics.delivered` is not double-incremented; the handler returns 200.

**AC-39 — Forged webhook is rejected (fail-closed)**
Given a webhook request where the HMAC signature header does not match the expected signature
computed with `MAIL_WEBHOOK_SECRET`,
When `POST /campaigns/webhooks/email` is called,
Then the handler returns 401 without processing the payload; no DB row is updated.

**AC-40 — Webhook arrives before send row committed — race handled**
Given a provider delivers a webhook for `provider_message_id = 'M1'` before the corresponding
`campaign_recipients.provider_message_id` field has been written (race condition),
When the handler looks up `M1` and finds no matching row,
Then the handler returns 200 (not 500); the event is silently discarded or queued for a
brief retry; no crash occurs; the eventually-committed row will pick up its status on the
next webhook or a reconciliation pass.

---

### WS-2C: Campaign RBAC

**AC-41 — Campaigns require campaigns.send permission**
Given a user with only `campaigns.view` (not `campaigns.send`) permission,
When they attempt to trigger campaign send, pause, or cancel,
Then the API returns 403 regardless of campaign status.

**AC-42 — Marketing user cannot build segment targeting non-consented leads**
Given a marketing user attempts to build a segment explicitly filtering `marketing_opt_in = false`,
When the segment is materialized,
Then zero recipients are added (the service layer ignores non-consented entries regardless of
the filter definition — consent exclusion is not bypassable via the segment filter API).

---

### WS-3A: Gamification — Idempotent Award (the headline AC)

**AC-43 — Points awarded for lesson completion**
Given Student S completes lesson L for the first time (domain event: `lesson_completed`,
`ref = L.id`, `userId = S.id`),
When `GamificationService` processes the event,
Then a `points_ledger` row is appended with `user_id = S.id`, `delta > 0`,
`reason = 'lesson_completed'`, `ref = L.id`.

**AC-44 — HEADLINE: Lesson-complete event replayed → no double award**
Given a `points_ledger` row already exists with `(user_id = S.id, reason = 'lesson_completed', ref = L.id)`,
When the `lesson_completed` domain event for the same `(S.id, L.id)` is processed again
(e.g., at-least-once replay, webhook retry),
Then the partial-unique constraint on `(user_id, reason, ref) WHERE deleted_at IS NULL`
prevents a second row from being inserted; the service handles the conflict as a no-op (not a 500);
Student S's XP total remains unchanged from before the replay.

**AC-45 — Badge awarded on threshold crossing**
Given Student S has accumulated enough XP to cross the `first_project_completed` badge threshold,
And the `user_badges` table has no row for `(user_id = S.id, badge_id = first_project_completed)`,
When `GamificationService.checkAndAwardBadges(S.id)` is called after the triggering event,
Then a `user_badges` row is created with `user_id = S.id`, `badge_id = first_project_completed`,
`awarded_at = now()`.

**AC-46 — Badge not double-awarded on replay**
Given `user_badges` already has a row `(user_id = S.id, badge_id = first_project_completed)`,
When the triggering event is replayed,
Then the partial-unique constraint on `(user_id, badge_id) WHERE deleted_at IS NULL` prevents a
second row; the service handles the conflict as a no-op.

**AC-47 — Ledger is append-only: no mutation of existing rows**
Given a `points_ledger` row with `id = R1`, `delta = 10`,
When any service operation attempts to UPDATE the `delta`, `reason`, or `ref` fields of `R1` directly,
Then the operation is rejected (enforced at the service layer — updates to ledger rows are not
permitted; only INSERT of new rows with positive or negative deltas is allowed).

**AC-48 — Reversal is a negative-delta row**
Given an erroneous award must be reversed,
When an authorized service action reverses it,
Then a new `points_ledger` row is appended with `delta < 0` and an audit-log entry is written;
the original row is unchanged; `deleted_at` on the original row is NOT set (append-only principle).

**AC-49 — Gamification summary endpoint (own-scope)**
Given Student S is authenticated,
When `GET /me/gamification` is called,
Then the response contains `{ totalPoints: number, badges: BadgeDto[], streakDays: number }`
where `totalPoints` is the SUM of all non-deleted `points_ledger.delta` rows for `S.id`
and `badges` contains all non-deleted `user_badges` with badge detail joined.
Student T's gamification data does not appear in the response.

**AC-50 — Leaderboard is opt-in and PII-minimal**
Given the batch leaderboard for Batch B is requested via `GET /batches/B/leaderboard`,
Then the response list contains only students who have opted in (`leaderboard_opt_in = true`);
each entry is `{ rank: number, displayName: string, totalPoints: number }`;
the response MUST NOT contain email, phone, enrollment ID, real name (if a custom alias was
set), or any field not in `LeaderboardEntryDto`. This is asserted by a response-key scan test.

**AC-51 — Leaderboard opt-out honored immediately**
Given Student S is on the leaderboard for Batch B (`leaderboard_opt_in = true`),
When Student S sets `leaderboard_opt_in = false` via `PUT /me/gamification/prefs`,
Then a subsequent `GET /batches/B/leaderboard` does not include Student S's entry.
No stale cached entry persists for more than the configured cache TTL (default: 60 seconds).

**AC-52 — Leaderboard is enrollment-scoped**
Given Student S is enrolled in Batch B but NOT in Batch C,
When Student S calls `GET /batches/C/leaderboard`,
Then the API returns 404 (enrollment-scoped IDOR — the existence of Batch C is not revealed
to a non-enrolled student).

---

### WS-4A: Forum — Enrollment-Scoped Access (the headline AC)

**AC-53 — Student views threads in enrolled batch**
Given Student S is enrolled in Batch B,
When `GET /forum/threads?batchId=B` is called by Student S,
Then the response includes all non-hidden threads for Batch B, with `meta.total >= 0`.

**AC-54 — Student views zero threads in batch with no threads**
Given Student S is enrolled in Batch B with no forum threads,
When `GET /forum/threads?batchId=B` is called,
Then the response is 200 with `data = []` and `meta.total = 0` (not a 404).

**AC-55 — Student cannot view threads in a non-enrolled batch**
Given Student S is NOT enrolled in Batch C,
When Student S calls `GET /forum/threads?batchId=C`,
Then the API returns 404 (IDOR-safe: the existence and content of Batch C's threads are not
revealed to Student S; not 403).

**AC-56 — HEADLINE: Student cannot post in a non-enrolled batch**
Given Student S is enrolled in Batch B but NOT in Batch C,
When Student S attempts to `POST /forum/threads` with `batchId = C`,
Then the API returns 404 (IDOR-safe, no information leakage about Batch C);
no `forum_threads` row is created.

**AC-57 — Student creates a thread in enrolled batch**
Given Student S is enrolled in Batch B,
When Student S POSTs to `POST /forum/threads` with `{ batchId: B, title: "...", body: "..." }`,
Then the response is 201; a `forum_threads` row is created with `author_id = S.id`,
`batch_id = B`, `status = 'open'`, `tenant_id = tenant`.

**AC-58 — Student posts a reply**
Given thread T exists in Batch B and Student S is enrolled in Batch B,
When Student S POSTs to `POST /forum/threads/T/posts` with `{ body: "..." }`,
Then the response is 201; a `forum_posts` row is created with `thread_id = T`,
`author_id = S.id`, `parent_id = null`, `status = 'visible'`.

**AC-59 — Student posts a nested reply**
Given post P exists in thread T and Student S is enrolled,
When Student S POSTs to `POST /forum/threads/T/posts` with `{ body: "...", parentId: P.id }`,
Then a `forum_posts` row is created with `parent_id = P.id`.

**AC-60 — Reply notifies thread author**
Given thread T was created by Student A, and Student B replies,
When Student B's reply post is created,
Then `NotificationService.notify(A.id, 'forum_reply', { threadId: T.id, postId: newPost.id })`
is called exactly once; an in-app `notifications` row appears for Student A.

**AC-61 — Upvote is deduped: one per user per post**
Given Student S has already upvoted post P (a `forum_post_votes` row exists for `(P.id, S.id)`),
When Student S attempts to upvote P again,
Then the partial-unique constraint on `(post_id, user_id)` rejects the second insert;
the service returns 200 (or 204 as a toggle-off) without error; `forum_posts.upvotes` is not
incremented a second time.

**AC-62 — Student cannot upvote their own post**
Given Student S authored post P,
When Student S attempts to upvote P,
Then the API returns 422 `CANNOT_VOTE_OWN_POST`; no `forum_post_votes` row is created.

**AC-63 — Concurrent upvote race — at-most-one row**
Given two concurrent requests from Student S1 and Student S2 each attempting to upvote post P
at the same moment,
When both requests arrive simultaneously,
Then exactly 2 `forum_post_votes` rows are created (one per student); `forum_posts.upvotes`
reflects exactly 2; no duplicate rows exist; no 500 is returned.

---

### WS-4B: Forum — Moderation

**AC-64 — Faculty moderates only assigned batches**
Given Faculty F is assigned to Batch B but not Batch C,
When Faculty F attempts to hide a post in Batch C's thread via the `forum.moderate` permission,
Then the API returns 404 (assigned-scope, IDOR-safe).

**AC-65 — Faculty hides a post in assigned batch**
Given Faculty F is assigned to Batch B and post P is in a thread in Batch B,
When Faculty F calls the hide endpoint with a reason,
Then `forum_posts.status` becomes `hidden`, `hidden_by = F.id`, `hidden_reason` is set, and
an audit-log entry is written with `actor = F.id`, `before = {status: 'visible'}`,
`after = {status: 'hidden', hidden_reason: ...}`.

**AC-66 — Faculty pins a thread**
Given Faculty F is assigned to Batch B,
When Faculty F pins thread T in Batch B,
Then `forum_threads.status = 'pinned'` and `forum_threads.pinned = true`; audit-log entry written.

**AC-67 — Admin moderates all batches**
Given an admin user and a thread in any batch,
When the admin calls any moderation endpoint,
Then the action succeeds regardless of batch assignment (all-scope).

**AC-68 — Student cannot use moderation endpoints**
Given a student with no `forum.moderate` permission,
When the student calls any hide/pin/delete moderation endpoint,
Then the API returns 403.

**AC-69 — Soft-delete of a post**
Given Faculty F calls the delete endpoint for post P in an assigned batch,
Then `forum_posts.deleted_at` is set to now(); `forum_posts.status` does not necessarily
change to hidden but the post does not appear in any student-facing list query; an audit-log
entry is written.

---

### WS-4C: Forum — UGC Sanitization

**AC-70 — XSS payload in forum post body is sanitized on render**
Given a student posts body content containing `<script>alert(document.cookie)</script>`,
When any client (LMS student view or CRM moderation view) renders the post,
Then DOMPurify strips the `<script>` tag before HTML is inserted into the DOM;
`document.cookie` is NOT accessible from the rendered output.
This is asserted by a render-level test that checks the sanitized output string does not
contain `<script` or `onerror` or `javascript:` after sanitization.

**AC-71 — Forum post body length is validated at the API boundary**
Given a `POST /forum/threads` or `POST /forum/threads/:id/posts` request with a body exceeding
the configured maximum character limit (e.g., 10,000 characters),
When the request is processed,
Then the API returns 422 `BODY_TOO_LONG` before any DB write occurs.

---

### WS-5: Cross-Cutting Security and Compliance

**AC-72 — Cross-tenant isolation on notifications**
Given Tenant A's notification `N-A` and an authenticated user from Tenant B (including an admin
of Tenant B),
When any Tenant B user calls any notifications endpoint with `N-A`'s ID,
Then the API returns 404; the `tenant_id` filter is applied at the repository query level before
any RBAC check.

**AC-73 — Cross-tenant isolation on campaign_recipients**
Given Tenant A's `campaign_recipients` row and a Tenant B admin,
When any Tenant B user queries campaigns or recipients,
Then Tenant A's rows do not appear; all queries are scoped by `tenant_id`.

**AC-74 — Cross-tenant isolation on forum_posts**
Given Tenant A's `forum_posts` row and a Tenant B student,
When any Tenant B student queries forum threads or posts,
Then Tenant A's posts do not appear; the query filters on `tenant_id` before scope/IDOR checks.

**AC-75 — Cross-tenant isolation on points_ledger**
Given Tenant A's `points_ledger` rows and a Tenant B admin,
When any Tenant B user queries gamification data,
Then Tenant A's ledger rows do not appear.

**AC-76 — No provider secret in any HTTP response or structured log**
Given any API endpoint or background dispatch that calls `MailProvider`, `WhatsAppProvider`,
or `SmsProvider`,
When the operation completes (success or error),
Then the HTTP response body, HTTP response headers, and structured log entries do NOT contain
`RESEND_API_KEY`, `SES_SECRET_ACCESS_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
`MSG91_AUTH_KEY`, `MAIL_WEBHOOK_SECRET`, or `NOTIFICATION_SIGNING_SECRET`. This is asserted
by scanning all response bodies and log outputs in the integration test suite.

**AC-77 — Unsubscribe token never contains raw user ID or email in cleartext**
Given a valid unsubscribe URL generated by the system,
When the URL's token parameter is base64-decoded (without knowing the signing secret),
Then the raw `user_id` UUID and the user's email address are NOT recoverable in plaintext
without HMAC verification with `NOTIFICATION_SIGNING_SECRET`.

**AC-78 — India DLT compliance: every SMS and WhatsApp template requires dlt_template_id**
Given a request to create or update a `campaign_templates` row with `channel = 'sms'` or
`channel = 'whatsapp'` and `dlt_template_id = null` or `dlt_template_id = ''`,
When the request is validated at the API boundary (zod + NestJS pipe),
Then the API returns 422 `DLT_TEMPLATE_ID_REQUIRED`; no `campaign_templates` row is created or
updated without a non-empty `dlt_template_id`.

---

## Part 4 — Edge Cases and Error States

### WS-1: Notifications

| Scenario | Expected behavior |
|----------|-------------------|
| Quiet-hours boundary: current time equals `quiet_hours.start` exactly | The send is deferred (boundary is inclusive — treat start as "now entering quiet") |
| Quiet-hours boundary: current time equals `quiet_hours.end` exactly | The send is dispatched (end is inclusive — treat end as "now exiting quiet") |
| Quiet hours span midnight (e.g., 22:00–07:00) — timezone difference | Service evaluates in the user's configured `quiet_hours.tz`; no off-by-one on day boundary |
| Urgent notification during quiet hours | Dispatched immediately; urgency is a per-`NotificationType` server config flag |
| All channels disabled for a type (in-app only always on) | Only in-app row created; no external calls; not an error |
| `notification_prefs.quiet_hours = null` | No quiet hours applied; all sends dispatched immediately |
| Notification fan-out where `MailProvider` throws a network error | Error is caught, logged (without secret), and the in-app row is still created; overall fan-out does not abort; error is recorded in the channels field |
| SSE connection dropped mid-stream (client offline) | Server detects closed connection and cleans up the stream subscription; no goroutine/handler leak; client reconnects and falls back to polling |
| SSE behind a reverse proxy that buffers SSE | Documented: `X-Accel-Buffering: no` header is set on the SSE response; fallback to polling is the safety net |
| Student has 500+ notifications; mark-all-read | Operation completes in a single batch UPDATE scoped to `user_id`; no N+1 per row; response < 800 ms |

### WS-2: Campaigns

| Scenario | Expected behavior |
|----------|-------------------|
| DLT template id missing on WhatsApp/SMS template | 422 `DLT_TEMPLATE_ID_REQUIRED` at template save; also re-checked at campaign send as defense-in-depth |
| Segment filter matches 10,000 recipients | Materialization runs in a paginated batch insert; no single query loads all 10k rows into memory; operation completes without timeout |
| Provider rate limit hit during send | The per-channel throttle in `CampaignSendPort` backs off; partial sends already dispatched retain `status = 'sent'`; campaign status moves to `paused` or retries after backoff |
| Webhook arrives before `campaign_recipients` send row is committed | Handler returns 200 and discards (or defers); no 500 crash; eventual consistency handled by reconciliation or the next webhook |
| Campaign cancelled while one recipient's send is in-flight | In-flight send completes (provider already called); only truly-queued rows are skipped; no double-send |
| Campaign's `schedule_at` passes without processing (server restarted) | On next boot, the dispatch seam picks up `scheduled` campaigns past their `schedule_at`; no campaign is silently dropped |
| Email hard bounce webhook | Recipient added to `notification_suppressions` with `reason = 'bounce'`; future sends to that address skipped |

### WS-3: Gamification

| Scenario | Expected behavior |
|----------|-------------------|
| Multiple events arrive concurrently for the same user and same ref | DB unique constraint serializes; only one ledger row is created; service handles conflict as no-op |
| `points_ledger` SUM query when user has 0 rows | Returns `totalPoints = 0`; not an error |
| Badge catalog is empty (no badges seeded) | `GET /me/gamification` returns `badges = []`; no error |
| Leaderboard for a batch with 0 opted-in students | Returns `data = []`, `meta.total = 0`; not a 404 |
| Student's total XP decreases due to a reversal row | `totalPoints` is the SUM including the negative delta; the LMS renders this correctly without going below zero display (display floor = 0 if needed) |
| Leaderboard cache TTL during opt-out | Opt-out takes effect within the cache TTL (60 s default); no opt-out can be silently ignored beyond TTL |

### WS-4: Forum

| Scenario | Expected behavior |
|----------|-------------------|
| Student posts in batch they were enrolled in but have since been unenrolled | The enrollment check is evaluated at request time; after unenrollment, `POST /forum/threads` for that batch returns 404 |
| Faculty reassigned from Batch B to Batch C | After reassignment, moderation calls for Batch B return 404 for that faculty member; Batch C calls succeed |
| Thread has 0 posts | `GET /forum/threads/:id/posts` returns `data = []`, `meta.total = 0`; not a 404 |
| Student reports a post (report mechanism) | A `forum_post_votes`-adjacent report flag is set; post does not auto-hide; the CRM moderation queue surfaces it to faculty |
| Concurrent reply and thread-resolve by two students | Both operations complete; the resolve marks the thread; the reply is still created; no deadlock or 500 |
| Forum post body is empty string | API returns 422 `BODY_REQUIRED`; no row created |
| Cross-batch reply attempt (post ID from Batch C, thread in Batch B) | The thread-level enrollment check catches the mismatch; returns 404 |

---

## Part 5 — Scope Boundary (In vs. Out)

### In Scope (P6)

| Workstream | What ships |
|-----------|------------|
| WS-1 Notifications core | In-app center (unread badge, list, mark-read/all), `NotificationService` fan-out (in-app + email + SMS + WhatsApp), per-user `type × channel` prefs + quiet hours, SSE stream + polling fallback, signed unsubscribe, connect deferred P4/P5 events |
| WS-2 Campaigns | CRM campaign builder (audience segment, template, schedule), email + WhatsApp + SMS channels, per-recipient dedupe idempotency, delivery/read tracking via HMAC-verified webhooks, suppression/consent enforcement, DLT-gated sends, pause/cancel |
| WS-3 Gamification | Append-only idempotent XP ledger, badges catalog + award, streaks (daily activity derived), opt-in PII-minimal batch leaderboard (display name / alias only), event-driven awards from existing P3/P4 domain events |
| WS-4 Forum | Enrollment-scoped thread/post CRUD, nested replies, deduped upvote, mark-resolved, faculty/admin soft-moderation (hide/pin/delete) in assigned/all scope, reply → author notification, DOMPurify sanitization on all UGC |
| Providers | `MailProvider` (Resend real adapter + Noop) + `WhatsAppProvider` (WhatsApp Cloud API real adapter + Noop) — new; `SmsProvider`/MSG91 reused |
| LMS UI | NotificationBell (SSE-fed), Notifications route + prefs page, gamification folded into Progress, Forum route (enrolled batches) |
| CRM UI | Marketing ▸ Campaigns (builder, metrics, DLT field), Admin ▸ Notifications (template registry, broadcast), Forum moderation views (assigned-scope) |

### Explicitly Out of P6 (with justification)

| Item | Deferred to | Recorded conflict |
|------|-------------|-------------------|
| Web Push (VAPID / service-worker push) / native mobile push | Later engagement or mobile phase | CONFLICT-P6-1 |
| Referral / affiliate program logic | Commerce-depth phase (no date) | CONFLICT-P6-2 |
| Marketing automation builder (drip sequences, if-this-then-that) | P8 | CONFLICT-P6-3 |
| Live-class scheduling / `LiveClassProvider` | Deferred since P3; reminder notification path only ships in P6 | CONFLICT-P6-4 |
| Engagement analytics dashboards (campaign ROI, gamification, forum health) | P7 | No conflict — P7 consumes P6 tracking rows |
| BullMQ real cluster / Redis worker / DLQ depth | P7 hardening (sync-seam is the default per LOCK-D1) | No conflict — ADR extends ADR-0020 |
| Forum full-text search | P7 (tsvector / Meilisearch) | No conflict |
| Forum rich editor (WYSIWYG), attachments, @mentions | Later forum-depth phase | No conflict |
| Support ticket system | Not a P6 engagement feature | No conflict |
| Bookmarks (LMS convenience) | P7 | No conflict |
| AI-drafted campaign copy / lead-scoring AI | P8 | No conflict |
| CRM test infra (automated) | Carried gap — QA may stand up opportunistically; not a gate | Carried P4/P5 followup |
| Playwright e2e (browser) | Carried stub since P1 — notification-center + forum journeys are candidates | Carried |
| Blog / landing-page CMS authoring UI | CMS phase (not named in CLAUDE.md §6 P6) | No conflict |

---

## Part 6 — Conflict Log

| Conflict ID | PRD section | PRD says | P6 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-P6-1 | `docs/02 §7.15` | "In-app center + **push** + email + WhatsApp" | Push (VAPID/native) is OUT of P6 | `NotificationChannel` enum is extensible; push slots in a later phase. Channels shipped: in_app + email + sms + whatsapp. |
| CONFLICT-P6-2 | `docs/03 §7.13` | "Referral + affiliate programs" under Marketing | Referral/affiliate program logic is OUT of P6 | The `referrals` table schema exists but the program logic (attributions, payouts) is a commerce-depth item with no P6 dependency. Deferred. |
| CONFLICT-P6-3 | `docs/03 §19` | "Automation builder (if-this-then-that for ops)" | Automation builder is OUT of P6 (→ P8) | P6 ships single-shot scheduled campaigns only. Multi-step journeys require a workflow engine — P8 scope. |
| CONFLICT-P6-4 | `docs/02 §7.4`, `docs/03 §7.10` | Live-class reminders as part of the live-class feature | Live-class feature itself (scheduler, LiveClassProvider) is deferred since P3 | P6 wires the live-class reminder notification template and fan-out path; the live-class scheduler is not built. The reminder fires when the live-class event source is eventually built. |

---

## Part 7 — India DLT / DPDP Consent Rules (Testable)

These rules are enforced by the service layer and are not overridable by any request parameter.

**Rule C-1 (marketing_opt_in gate):**
Before any marketing campaign send to a lead or student, the service checks `marketing_opt_in`
on the consent record. If `marketing_opt_in` is `false` or `null`, the recipient is excluded.
Verified by AC-29.

**Rule C-2 (suppression/unsubscribe gate):**
Before any notification or campaign dispatch to an external channel (email, SMS, WhatsApp),
`notification_suppressions` is queried for `(user_id/email/phone, channel)`. If a record exists
(regardless of reason), the send is skipped. Verified by AC-11, AC-23, AC-30, AC-33.

**Rule C-3 (DLT template id gate — SMS and WhatsApp):**
Every `campaign_templates` row with `channel = 'sms'` or `channel = 'whatsapp'` must carry
a non-empty `dlt_template_id`. This is enforced at the zod schema level in `@repo/types`
(field is required for those channels, not nullable) and re-checked at campaign send as
defense-in-depth. A send call to `SmsProvider` or `WhatsAppProvider` that does not carry a
`dlt_template_id` in its parameters is rejected before any provider call. Verified by AC-31, AC-78.

**Rule C-4 (transactional vs. marketing channel separation):**
Transactional notifications (grade_ready, certificate_ready, payment_receipt, booking_confirmation)
may be sent to any channel the user has opted into in their `notification_prefs`, regardless of
`marketing_opt_in`. The `marketing_opt_in` gate applies only to campaign (marketing) sends.
Verified by AC-6, AC-25, AC-26.

**Rule C-5 (unsubscribe honored within one send cycle):**
A user who clicks unsubscribe during an active campaign send will not receive subsequent sends
in that campaign even if their row was already `queued`. The suppression check is evaluated
per-recipient at dispatch time, not once at campaign start. Verified by AC-33.

---

## Part 8 — Data and Permissions Impact

### New Tables (all: cuid PK, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, wired to soft-delete + audit Prisma extensions)

| Table | Key index(es) + dedupe constraint | Notes |
|-------|----------------------------------|-------|
| `notifications` | `(user_id, read_at)`, `(tenant_id, user_id, created_at DESC)` | In-app center; `channels` Json, `payload` Json |
| `notification_prefs` | UNIQUE `(tenant_id, user_id)` | One row per user; `matrix` Json + `quiet_hours` Json |
| `notification_suppressions` | `(tenant_id, channel, user_id)`, `(tenant_id, channel, email)`, `(tenant_id, channel, phone)` | Suppression/unsubscribe list; multi-key lookup |
| `campaigns` | `(tenant_id, status, schedule_at)` | `metrics` Json, `segment` Json |
| `campaign_templates` | `(tenant_id, channel)` | `dlt_template_id` required for sms/whatsapp |
| `campaign_recipients` | PARTIAL UNIQUE `(campaign_id, COALESCE(lead_id, student_id, user_id)) WHERE deleted_at IS NULL`; `(campaign_id, status)`; `(provider_message_id)` | Per-recipient dedupe; webhook lookup by `provider_message_id` |
| `badges` | UNIQUE `(tenant_id, key)` | Catalog; seeded |
| `user_badges` | PARTIAL UNIQUE `(user_id, badge_id) WHERE deleted_at IS NULL` | One award per badge per user |
| `points_ledger` | PARTIAL UNIQUE `(user_id, reason, ref) WHERE deleted_at IS NULL`; `(tenant_id, user_id, created_at)` | Append-only; idempotent awards |
| `forum_threads` | `(tenant_id, batch_id, status)`; `(tenant_id, program_id, status)` | Scoped to batch or program |
| `forum_posts` | `(thread_id, created_at DESC)`; `(author_id)` | `parent_id` for nesting; sanitized on render |
| `forum_post_votes` | PARTIAL UNIQUE `(post_id, user_id) WHERE deleted_at IS NULL` | One vote per user per post |

### New Enums

`NotificationType` (`grade_ready | certificate_ready | live_reminder | forum_reply | announcement | lead_confirmation | booking_confirmation | payment_receipt | welcome`),
`NotificationChannel` (`in_app | email | sms | whatsapp`),
`CampaignChannel` (`email | whatsapp | sms`),
`CampaignStatus` (`draft | scheduled | sending | sent | paused | cancelled | failed`),
`RecipientStatus` (`queued | sent | delivered | read | failed`),
`SuppressionReason` (`unsubscribe | bounce | complaint`),
`ThreadStatus` (`open | resolved | hidden | pinned`),
`PostStatus` (`visible | hidden`).

### RBAC Permissions (new entries in `role_permissions`)

| Permission | Student | Faculty | Branch Mgr | Admin/Owner | Marketing | Support |
|------------|:-------:|:-------:|:----------:|:-----------:|:---------:|:-------:|
| `notifications.view` | own | own | own | all | own | own |
| `notification_prefs.edit` | own | own | own | all | own | own |
| `campaigns.view` | — | — | — | all | all | — |
| `campaigns.create` | — | — | — | all | all | — |
| `campaigns.edit` | — | — | — | all | all | — |
| `campaigns.send` | — | — | — | all | all | — |
| `campaigns.delete` | — | — | — | all | all | — |
| `gamification.view` | own | own | — | all | — | — |
| `gamification.prefs.edit` | own | own | — | all | — | — |
| `forum.read` | enrolled | assigned | branch | all | — | — |
| `forum.post` | enrolled | assigned | all | all | — | — |
| `forum.moderate` | — | assigned | branch | all | — | — |

Data scope semantics:
- `enrolled` = enrollment check against `batchId` in the request; IDOR→404 for non-enrolled.
- `assigned` = batch `faculty_id = currentUser.id` check; IDOR→404 for unassigned.
- `own` = resource `user_id = currentUser.id`; IDOR→404 for mismatched user.

---

## Part 9 — Dependencies (Agents and Modules)

| Dependency | Source | Consumed by |
|------------|--------|-------------|
| P3/P4 domain events (`lesson_completed`, `assignment_graded`, `assessment_passed`, `project_approved`, `certificate_issued`) | P3 lesson module, P4 submissions/certificates module | WS-3 GamificationService (award points), WS-1 NotificationService (fan-out) |
| P5 domain events (`lead_created`, `booking_created`, `payment_verified`, `enrollment_created`) | P5 public/funnel module | WS-1 NotificationService (fan-out — CONFLICT-P5-2/-5 resolved) |
| `SmsProvider` / MSG91 | P0, ADR-0006 | WS-1 + WS-2 SMS channel (reused) |
| DPDP consent record (`leads.consent.marketing_opt_in`, `bookings.consent.marketing_opt_in`) | P5, ADR-0038 | WS-2 segment build (consent gate) |
| `@RequirePermission` + `PermissionsGuard` + `ScopeInterceptor` | P0/P1, ADR-0009/0018/0022/0031 | All WS-1–4 backend modules |
| Soft-delete + audit Prisma extensions | P0, ADR-0005 | All 11 new tables |
| Signed-token pattern (HMAC, ADR-0028) | P4 cert_uid pattern | WS-1 unsubscribe token, WS-2 webhook secret verify |
| `@repo/types` zod DTOs | API designer task #2 | All backend + frontend tasks |
| `@repo/api-client` SDK (regenerated) | API designer task #2 | LMS + CRM frontends |
| `@repo/ui` primitives (NotificationBell, PrefsMatrix, BadgeGrid, LeaderboardTable, PostThread, CampaignBuilder) | Design system task #5 | Frontend tasks #10, #11 |
| DOMPurify (pre-approved, P4 ADR) | P4 integrations | Frontend tasks #10, #11 — all UGC render sinks |
| `enrollment` membership check (batch → student enrollment) | P1/P2 enrollments module | WS-4 forum RBAC scope resolver |
| Redis (cache-aside for leaderboard) | P0 infra | WS-3 leaderboard endpoint (TTL: 60 s default) |
| `MailProvider` / `WhatsAppProvider` (new, P6 integrations task #3) | Task #3 | WS-1 fan-out, WS-2 campaign send |
| `NotificationDispatchPort` / `CampaignSendPort` (new sync-seam, P6 backend task #4) | Task #4 | WS-1 NotificationService, WS-2 CampaignService |

---

## PRD Conflict Log (P6)

| Conflict ID | PRD section | PRD says | P6 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-P6-1 | `docs/02 §7.15` | Push notifications (in-app + push + email + WhatsApp) | Push is OUT of P6 | `NotificationChannel` enum extensible; push adds without schema change. Tracked in `docs/phase-6-followups.md`. |
| CONFLICT-P6-2 | `docs/03 §7.13` | Referral + affiliate programs under Marketing | Referral program logic OUT of P6 | `referrals` table schema exists; program logic is commerce-depth. Tracked in followups. |
| CONFLICT-P6-3 | `docs/03 §19` | Automation builder (if-this-then-that) | OUT of P6, → P8 | Single-shot campaigns ship; drip builder requires workflow engine (P8). Tracked in followups. |
| CONFLICT-P6-4 | `docs/02 §7.4` + `docs/03 §7.10` | Live class reminders as part of live-class feature | Live-class feature (scheduler, LiveClassProvider) deferred; reminder fan-out path ships in P6 | Notification template + fan-out path ready; no live-class entity built. Tracked in followups. |

---

*Spec authored by `product-manager` for Phase 6, Task #0. Effective date: 2026-07-03.*
