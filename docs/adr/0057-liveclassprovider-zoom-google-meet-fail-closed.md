# ADR 0057: LiveClassProvider interface — Zoom + Google Meet adapters, fail-closed in prod

## Status
Accepted

## Context
`CLAUDE.md §1` names `LiveClassProvider` (behind `ZoomMeeting SDK + Google Meet`) as a
required swappable integration, but it was never built through P0–P8 —
`docs/go-live-checklist.md` Tier 2 called this out explicitly ("Live classes — entirely
absent... `Attendance.liveClassId` is a nullable, FK-less column with no writer"),
blocking LMS §7.4 / CRM §7.10 and the acceptance criterion "attendance auto-marks within
60s of joining a live class." `docs/plans/phase-9-completion.md` T15/T20 is the
user-approved trigger to build it, following the exact same provider-interface +
fail-closed-in-prod pattern already established for Video (ADR-0023/0027), Storage
(ADR-0027), Payment (ADR-0013), Mail/WhatsApp (ADR-0040), and Captcha (ADR-0036).

## Decision
`apps/api/src/modules/lms/providers/live-class/live-class-provider.interface.ts` defines
`LiveClassProvider` (`createMeeting`, `getJoinUrl`, `endMeeting`,
`verifyWebhookSignature`, `parseRecordingEvent`) behind the `LIVE_CLASS_PROVIDER` DI
token. Three adapters:

- **`ZoomLiveClassProvider`** (primary) — Server-to-Server OAuth + Meetings API v2.
  Attendee `getJoinUrl` uses Zoom's per-registrant Meeting Registrants API, so a
  different student's URL does not admit this user (defence-in-depth on top of the
  backend's own enrollment/RBAC gate). Webhooks are HMAC-verified
  (`v0:<timestamp>:<rawBody>` against `x-zm-signature`); Zoom's one-time
  `endpoint.url_validation` challenge is handled explicitly before signature
  verification (it carries no signature to verify).
- **`GoogleMeetLiveClassProvider`** (secondary) — Workspace service-account + Calendar
  API `conferenceData`. Meet has **no per-user join-URL scoping** (one shared
  `hangoutLink` for every attendee) and **no verifiable webhook signature scheme** —
  `verifyWebhookSignature` therefore always returns `false` for this adapter
  (fail-closed), and attendance/recording sync for Meet must be **polled** via the Meet
  REST API rather than trusted via webhook. The backend's enrollment + RBAC + scope gate
  remains the primary access control for Meet, same as Zoom's registrant-URL is
  defence-in-depth on top of it, not a replacement for it.
- **`NoopLiveClassProvider`** — dev/test default; deterministic fake URLs, no network
  calls.

`LiveClassProviderModule` (mirrors `VideoProviderModule`/`StorageProviderModule` exactly)
binds `LIVE_CLASS_PROVIDER` via `useFactory` (not `useClass` — same DEFECT-1/ADR-0023
optional-constructor-param DI-reflection issue) and **fails closed in production**:
`LIVE_CLASS_PROVIDER=noop` in prod boot-throws; `zoom`/`google_meet` with missing
credentials (`ZOOM_ACCOUNT_ID`/`ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`/
`ZOOM_WEBHOOK_SECRET_TOKEN` or `GOOGLE_SERVICE_ACCOUNT_EMAIL`/
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`/`GOOGLE_MEET_IMPERSONATE_USER_EMAIL`) also
boot-throws in prod, exactly like `MailProviderModule` (ADR-0040) and closing the B2/T2
asymmetry `docs/go-live-checklist.md` identified for Video/Storage.

The interface's security contract (documented inline) requires: `createMeeting`'s
`hostJoinUrl` is never surfaced to a non-host caller; `getJoinUrl` is called only AFTER
the caller has verified enrollment + RBAC (`liveclass.join`, own scope) — identical
contract to `VideoProvider.mintSignedHlsUrl` (ADR-0021); recording `downloadUrl`s are
vendor-authenticated and must be re-hosted via `StorageProvider`, never returned
directly to a client.

`live_classes.provider_meeting_id`/`join_url` are populated from `createMeeting`;
`attendance.live_class_id` (nullable/FK-less since P3, `docs/phase-3-followups.md`) now
carries a real FK, written by the webhook/poll event consumer on
`participant_joined`/`participant_left` events — closing the "attendance auto-marks
within 60s" acceptance criterion.

## Consequences
- Swapping the primary live-class vendor (or adding a third) is a new adapter class plus
  a DI rebind — zero changes to the LiveClass feature module, matching every other
  provider in `CLAUDE.md §1`.
- Zoom and Google Meet are **code-complete and unit-tested against mocked vendor
  responses** as of this ADR; **staging verification is credential-gated** (real Zoom
  S2S OAuth app + webhook subscription, or a real Google Workspace service account) per
  `docs/plans/phase-9-completion.md` decision #1 — tracked in
  `docs/phase-9-followups.md`, not blocking this ADR's acceptance.
- Google Meet's lack of per-user join-URL scoping and webhook signatures is a documented
  **vendor limitation**, not an adapter bug — any future all-Meet deployment must accept
  that live-class attendance sync runs on a polling cadence, not a push webhook, and that
  meeting-link sharing is a policy/trust boundary rather than a technical one.
- The application will **not boot in production** with `LIVE_CLASS_PROVIDER=noop` or with
  a selected real adapter missing credentials — this is the same fail-closed posture B2
  established for Video/Storage/Payment/SMS in this same phase.

## Alternatives considered
- **Zoom-only (no Google Meet adapter).** Rejected — `docs/plans/phase-9-completion.md`
  decision #1 asked which vendor is primary but kept both in scope; a second adapter also
  proves the interface is genuinely vendor-agnostic, not accidentally Zoom-shaped.
- **Polling-only architecture for both vendors (skip Zoom webhooks).** Rejected for
  Zoom — Zoom's Meetings API webhook + signature scheme is mature and push-based
  attendance sync comfortably meets the ≤60s SLA with far less load than polling; Meet is
  polling-only strictly because the vendor offers no webhook alternative, not by choice.
- **A single `hangoutLink`-style shared URL for Zoom too (skip registrant scoping).**
  Rejected — Zoom's Meeting Registrants API is available and per-user scoping is free
  defence-in-depth; using it costs one extra API call per join, not an architecture
  change.

## Related
Extends the provider-interface pattern from ADR-0006 (SMS), ADR-0013 (Payment),
ADR-0023/0027 (Video/Storage `useFactory` DI + fail-closed), ADR-0036 (Captcha/Analytics),
ADR-0040 (Mail/WhatsApp fail-closed-in-prod). Attendance-writer counterpart to ADR-0024
(progress write path).
