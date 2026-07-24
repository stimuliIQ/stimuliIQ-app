# ADR 0041: India DLT/consent gating for SMS/WhatsApp campaigns — enforced at three layers

## Status
Accepted

## Context
India regulates commercial SMS and WhatsApp Business messaging under the **DLT
(Distributed Ledger Technology) framework** (TRAI) — a message can only be sent using a
DLT-registered, pre-approved template. Separately, the **DPDP Act** requires explicit,
recorded consent for marketing communications and a working opt-out mechanism. P5 already
records DPDP consent on `leads`/`bookings` (`{marketing_opt_in, tos_version, timestamp,
ip_hash}`, ADR-0038) but nothing in P0–P5 enforces DLT template gating or an unsubscribe
mechanism against it — that enforcement was explicitly deferred to P6
(`CONFLICT-P5-2/-5`).

P6 ships bulk SMS/WhatsApp campaigns (WS-2). Shipping this without DLT/consent enforcement
would create real regulatory and abuse exposure (unsolicited commercial messages, TRAI
non-compliance) — this is called out as load-bearing, not optional, in the P6 spec (LOCK-D4)
and Risk #3 of the phase-6 plan.

## Decision
Three independently-enforced compliance rules, each verified by a distinct AC and applied at
a different layer so no single bypass defeats them all:

**Rule C-1 — `marketing_opt_in` consent gate (segment-build layer).**
Before `campaign_recipients` rows are materialized from a `leads`/`students` segment filter,
the service checks each candidate's consent record. `marketing_opt_in = false` or `null`
excludes the recipient — **not bypassable via the segment filter API**, even if a marketing
user explicitly filters for non-consented leads (AC-29, AC-42). Transactional notifications
(grade-ready, certificate-ready, payment-receipt) are exempt from this gate (Rule C-4) — they
follow the recipient's `notification_prefs` channel opt-in instead.

**Rule C-3 — `dlt_template_id` required (template-create + send layers, defense-in-depth).**
Every `campaign_templates` row with `channel = 'sms'` or `channel = 'whatsapp'` must carry a
non-empty `dlt_template_id`:
1. **At template create/update** — enforced at the zod schema level in `@repo/types` (the
   field is required, not nullable, for those two channels); rejected 422
   `DLT_TEMPLATE_ID_REQUIRED` before any DB write (AC-78).
2. **At campaign send** — re-checked as defense-in-depth even though template creation should
   have already guaranteed it (covers templates created before this rule, or any data-layer
   edge case); rejected 422 `DLT_TEMPLATE_ID_REQUIRED`, no `campaign_recipients` rows created,
   no provider call made (AC-31).
3. **At the dispatch adapter** — `SmsProvider.send(...)` and `WhatsAppProvider.sendTemplate(...)`
   are called with the DLT template id as a required parameter; a call without one is a
   caller bug caught by the type system, not a runtime possibility.

Email campaigns are exempt from Rule C-3 (AC-32) — DLT applies only to SMS/WhatsApp under
Indian telecom regulation.

**Rule C-2 — suppression/unsubscribe gate (dispatch layer, evaluated per-recipient, not
once at campaign start).**
Before every notification or campaign dispatch to an external channel,
`notification_suppressions` is queried for `(user_id/email/phone, channel)`. Any matching row
(`unsubscribe`, `bounce`, or `complaint`) skips the send (AC-11, AC-23, AC-30, AC-33). This is
evaluated **at the moment of dispatch**, not once when the campaign is queued — a recipient
who unsubscribes mid-send (while other recipients in the same campaign are still `queued`) is
still suppressed when their turn arrives (Rule C-5, AC-33).

## Consequences
- A campaign cannot reach a non-consented or suppressed recipient through any code path —
  three independent checks (segment build, template validation, dispatch-time suppression
  lookup) each close a different bypass.
- SMS/WhatsApp campaign authoring in the CRM requires a real DLT-approved template id from
  day one; the CRM builder surfaces this as a required field (`docs/plans/phase-6.md` task
  #11). Marketing users must have their templates DLT-registered with the telecom operator
  before P6 campaigns can send SMS/WhatsApp.
- Email campaigns have a lighter compliance bar (no DLT), consistent with Indian regulation
  applying DLT specifically to telecom-carried SMS/WhatsApp, not email.
- This closes `CONFLICT-P5-2` and `CONFLICT-P5-5` for the SMS/WhatsApp channel — the
  compliance framework those conflicts deferred is now built and enforced.

## Alternatives considered
- **Enforce DLT only at template creation (single layer).** Rejected — a template created
  before the rule existed, or a data-layer bypass, would slip through with no send-time
  check. Defense-in-depth at two enforcement points (create + send) costs one extra guard
  clause and closes that gap.
- **Enforce consent only at segment-build time (no per-recipient re-check at dispatch).**
  Rejected — fails Rule C-5 (AC-33): a user who unsubscribes after their `campaign_recipients`
  row is materialized but before their individual send is dispatched would still receive the
  message. Per-recipient dispatch-time suppression check is required.
- **Trust the segment filter's own consent predicate (rely on the marketing user's filter
  choice).** Rejected — AC-42 explicitly requires the exclusion to hold even when a marketing
  user attempts to filter for non-consented leads; consent enforcement must live in the
  service layer, not be delegated to the caller's filter definition.
