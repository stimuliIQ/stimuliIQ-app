# ADR 0039: P6 notification/campaign dispatch via sync-seam (extends ADR-0020) — BullMQ deferred

## Status
Accepted

## Context
`docs/04 §2.8` names `email|sms|whatsapp|notifications|campaign-send` as queues that are
"already provisioned." Verification during P6 planning (Glob/Grep against the live tree)
confirmed the opposite: **no `bullmq` dependency exists** in `apps/api/package.json` and no
worker process runs. Every prior async-work seam (`invoice-gen`, `webhook-processor`,
`sync-certificate-pdf`) uses the SYNC-with-seam pattern established in ADR-0020 — a
synchronous idempotent adapter behind a `*Port` DI token, with a documented (but unbuilt)
BullMQ migration path.

P6 introduces two new fan-out surfaces that are naturally queue-shaped: notification
delivery (`NotificationService.notify` → in-app + email + SMS + WhatsApp) and bulk campaign
send (`CampaignService.send` → N recipients). Both need retry-safe, idempotent dispatch.
Installing BullMQ now would satisfy `docs/04 §2.8` literally but is a standing
ask-user-before-install dependency (`CLAUDE.md §1`, phase-6 plan §7) and expands scope
(Redis worker process, deploy topology, DLQ tooling) beyond the four named P6 workstreams.

## Decision
P6 ships **`NotificationDispatchPort`** and **`CampaignSendPort`** DI tokens, bound by
default to **`SyncNotificationDispatchAdapter`** and **`SyncCampaignSendAdapter`** —
synchronous, in-request, idempotent adapters following the exact ADR-0020 template. Neither
adapter depends on BullMQ or Redis for correctness:

- Correctness comes from **DB-level partial-unique dedupe constraints**
  (`campaign_recipients` per-recipient dedupe, `points_ledger`/`user_badges` award dedupe),
  not from queue semantics or `jobId` deduplication.
- Both sync adapters expose a **`throttle()` no-op hook** — a method that a `BullMq*Adapter`
  would use to enforce per-channel/provider send-rate limits. In the sync adapter it is a
  documented no-op (or a simple in-process rate check); its presence means swapping to a
  `BullMqNotificationDispatchAdapter` / `BullMqCampaignSendAdapter` later requires **zero
  interface change** — only a new class implementing the same port plus a DI binding swap in
  `AppModule`, identical to the ADR-0020 migration path.
- Quiet-hours deferral (AC-9) is implemented as a **recorded defer timestamp** on the sync
  adapter's dispatch record; a scheduled sweep (or the next notify call) re-evaluates and
  dispatches once the window closes. This is intentionally the same "poll/sweep" shape a
  BullMQ delayed-job would use, so the migration is additive, not a rewrite.

BullMQ + Redis workers remain **ASK-USER, no default** (phase-6 plan §7). This ADR does not
install `bullmq`; it documents the seam so installing it later is a binding swap, not a
redesign.

## Consequences
- P6 is shippable and green with **zero new infra** (no Redis worker process, no BullMQ
  dependency) — consistent with every prior phase.
- Notification fan-out and campaign send correctness is **independent of the queue
  implementation**: the per-recipient/dedupe-key uniques (ADR pattern from ADR-0014) make
  replay/retry a no-op regardless of sync or BullMQ dispatch.
- `docs/04 §2.8`'s "queues already provisioned" wording remains **inaccurate** until BullMQ
  is actually installed; this is called out explicitly here and in
  `docs/phase-6-followups.md` rather than silently editing `docs/04` to imply queues exist.
- The real DLQ/observability depth (dead-letter inspection UI, backoff tuning, worker
  autoscaling) is deferred to P7 hardening, as it was for invoice-gen/webhook processing in
  P2.
- If a message dispatch fails mid-request (e.g., `MailProvider.send` throws), the sync
  adapter catches, logs (secret-free), and records the failure on the recipient/notification
  row rather than aborting the whole fan-out — matching AC-9/AC-11's "in-app row still
  created" behavior.

## Alternatives considered
- **Install BullMQ now for P6 (full queue-and-worker P6 scope).** Rejected as the default —
  it is a new standing dependency requiring explicit user approval (`CLAUDE.md §1`), expands
  the deploy topology, and is not required for any P6 acceptance criterion (all correctness
  guarantees come from DB uniques, not queue semantics). Available on approval as a drop-in
  binding swap.
- **Fire-and-forget dispatch with no interface.** Rejected — violates `CLAUDE.md §1` rule 7
  (every external call behind a provider interface) and removes the seam that makes a future
  BullMQ swap a binding change instead of a rewrite.
- **A hand-rolled in-process job queue (e.g., a simple array + setInterval).** Rejected —
  adds bespoke queue semantics to maintain and test for no correctness benefit over the
  simpler synchronous-adapter-plus-DB-unique approach; also diverges from the ADR-0020
  precedent other engineers already understand.

## Related
Extends ADR-0020 (Invoice generation and webhook processing via SYNC-with-seam).
