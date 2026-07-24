# ADR 0043: SSE + polling fallback for real-time notification delivery

## Status
Accepted

## Context
P6's notification center needs a live-updating unread badge and toast (`docs/02 §7.15`)
without a page refresh. Three real-time transports were candidates: WebSockets, Server-Sent
Events (SSE), and interval polling. The modular monolith has no existing WebSocket/SSE
infrastructure; whatever is chosen must work behind the LMS's PWA/offline posture (P3,
ADR-0025 — hand-written PWA, no Workbox) and must not require new infra (Redis pub/sub,
sticky sessions) to ship P6.

## Decision
**`GET /me/notifications/stream`** is a **Server-Sent-Events** endpoint (authenticated via
the existing JWT/cookie auth, own-scoped — a user's stream emits only their own
notifications, AC-14). SSE is chosen over WebSockets because the traffic is one-way
(server→client only — the client never needs to push back over the same channel), SSE needs
no new infra beyond a long-lived HTTP response, and it degrades more gracefully behind
reverse proxies than WebSockets (plain HTTP, works through most proxies with
`X-Accel-Buffering: no` set to disable buffering).

The LMS client (`apps/lms`) uses SSE when available and **falls back to interval polling**
of `GET /me/notifications?unread=true` when SSE cannot be established (offline/PWA restart,
a proxy that doesn't support streaming, or a dropped connection that doesn't reconnect). The
polling endpoint is the same authenticated, own-scoped, paginated read used by the
notification list — no separate API surface for the fallback.

**Implementation is an in-memory subscriber map inside the sync-seam dispatch adapter**
(ADR-0039): when a user's SSE connection opens, the request handler registers a callback in
a process-local `Map<userId, response[]>`; `NotificationService.notify(...)` looks up the
map and writes an SSE event to any open connection for that user, in addition to creating the
DB row. This is deliberately the simplest implementation that satisfies AC-16 (delivery
within 2 seconds) without introducing Redis pub/sub.

**Documented single-instance limitation:** because the subscriber map is in-process memory,
a user's SSE stream is only live-updated by notifications dispatched **on the same API
instance** that holds their open connection. In a horizontally-scaled deployment (multiple
API instances behind a load balancer), a notification dispatched on instance B will not reach
a user whose SSE connection is pinned to instance A — that user's badge updates only via the
polling fallback until their SSE reconnects to the instance handling their dispatch (or their
next poll interval). This is an accepted limitation for the current single-instance-friendly
P6 deployment shape and is tracked as an open follow-up (`docs/phase-6-followups.md` M-1) —
the durable fix is Redis pub/sub (broadcasting the event to all instances) paired with the
BullMQ migration path from ADR-0039, not a P6 requirement.

## Consequences
- No new dependency, no new infra (no Redis pub/sub, no WebSocket library) — SSE is native to
  Next.js/NestJS via a plain streaming HTTP response.
- The notification badge/toast updates live for the common case (single API instance, or a
  user whose connection happens to be pinned to the instance handling their own event) and
  degrades to polling otherwise — never a hard failure, matching AC-17.
- Horizontal scaling silently reduces real-time freshness for cross-instance dispatch until
  Redis pub/sub is added; this must not be mistaken for a correctness bug — the notification
  row and channel dispatch (email/SMS/WhatsApp) still happen correctly, only the **live SSE
  push** is instance-local.
- A malformed/dropped SSE connection is cleaned up server-side (no handler/goroutine leak);
  the client's own reconnect logic falls back to polling.

## Alternatives considered
- **WebSockets.** Rejected — bidirectional capability is unneeded (server→client only), adds
  a new protocol/library dependency, and is harder to get right behind arbitrary reverse
  proxies than plain HTTP/SSE.
- **Polling-only (no SSE).** Considered as the simplicity-first fallback option (the phase-6
  plan explicitly allows this if preferred). Rejected as the primary transport because it adds
  latency (interval-bound) and constant request load for a use case (unread badge) that
  benefits from sub-2-second delivery; SSE is not materially harder to build and the polling
  path is needed anyway as the fallback, so both are built.
- **Redis pub/sub from day one (multi-instance-correct SSE).** Rejected as a P6 requirement —
  adds infra and complexity not needed to satisfy any P6 acceptance criterion (single-instance
  dev/staging shape); documented as the correct fix when horizontal scaling is prioritized
  (P7 hardening candidate).

## Related
Locked by the P6 spec as LOCK-D3. The dispatch-adapter subscriber map lives alongside the
sync-seam adapters from ADR-0039.
