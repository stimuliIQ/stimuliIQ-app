# ADR 0047: Observability activation — Sentry SaaS + hosted OTel collector + pino, no-op-safe by default

## Status
Accepted

## Context
The stack (Sentry + OpenTelemetry + pino) was already declared in `docs/04 §2.13` (**LOCK-D3**)
and the SDKs were installed since P0, but `observability/{otel,sentry,logger}.ts` remained
stubbed/no-op. P7's WS-C requires activating this wiring — correlation ids, PII scrubbing,
trace propagation across module + provider boundaries, and new `/health`, `/health/ready`, and
`/metrics` endpoints — without introducing a different stack (AC-41 through AC-50).

## Decision
- **Sentry SaaS** (not self-hosted GlitchTip) is the error-reporting backend, configured via
  `SENTRY_DSN`/`SENTRY_ENVIRONMENT`. A `beforeSend` scrubbing hook strips email, phone, and any
  `Authorization`/cookie/token header from every event before it leaves the process (AC-43).
  When `SENTRY_DSN` is unset, the adapter is a no-op — the app never crashes or blocks a
  request because Sentry is unreachable or misconfigured (errors are logged locally instead).
- **OpenTelemetry** exports traces via the vendor-neutral OTLP protocol to a **hosted OTel
  collector** (`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME`), also no-op when unset. Spans
  cross module and provider boundaries — a single trace contains the parent HTTP span plus
  child spans for the service call and the provider-adapter call (e.g. `CampaignService` →
  `CampaignSendPort` → `MailProvider` adapter), never a fragmented, disconnected set of spans
  (AC-46).
- **pino** remains the structured logger. Secrets/JWTs/password hashes are redacted (never
  logged, extending the AC-76/P6 pattern to every P7-touched surface, AC-47); email and phone
  are masked (e.g. `j***@e***.com`, `+91XXXXX1234`) rather than logged in cleartext (AC-48).
- **A single correlation-id resolver** is the one source of truth for request identity: it
  reads a client-supplied `X-Request-Id` if present and well-formed (length/character-capped —
  see the client-supplied-id hardening in `docs/phase-7-followups.md` L-2), else mints a fresh
  uuid. That same id is (a) echoed as a response header, (b) embedded as the `traceId` field of
  every RFC-7807 error body (AC-44, AC-45), and (c) attached via async-local-storage to every
  structured log line for that request — including log lines emitted from a deferred/background
  dispatch continuation, so the two can be joined for diagnosis (AC-50). No endpoint or module
  computes its own id.
- **`GET /metrics` is bearer-token-gated (`METRICS_TOKEN`) and fail-closed** — a missing/invalid
  token returns 403; if `METRICS_TOKEN` is unset in a non-test environment, the endpoint refuses
  all requests rather than exposing RED/USE metrics unauthenticated.
- **`GET /health`** (liveness, unauthenticated) returns a minimal `{ status: "ok" }` payload
  with no package versions, stack traces, hostnames, connection strings, or env var contents
  (AC-41), and is rate-limited despite being unauthenticated (AC-49). **`GET /health/ready`**
  additionally pings DB + Redis and returns 503 (not 200) if either is down, still leaking only
  a per-dependency boolean/status label (AC-42).

## Consequences
- Zero behavior change when unconfigured — dev/CI stay fully green with no-op Sentry/OTel
  adapters, matching the Noop-by-default posture of every other provider interface in this
  codebase (`StorageProvider`, `MailProvider`, etc.).
- Activation is purely an ops/env-var task (tracked in the README activation checklist), not a
  code change — this is deliberate so staging/prod activation carries zero deploy risk.
- A single correlation-id resolver eliminates the class of bug where the response header, the
  log line, and the error body disagree on the request's id.
- Fail-closed `/metrics` prevents an unauthenticated actor from scraping internal traffic-shape
  data (RED/USE metrics can reveal which endpoints are hot, at what rate, with what error
  ratio — itself sensitive).
- `/health`/`/health/ready` being unauthenticated-but-rate-limited means uptime monitors work
  without credentials while still being protected from being turned into a load-generation or
  log-flooding vector.

## Alternatives considered
- **Self-hosted GlitchTip** (or another OSS Sentry-compatible backend). Rejected — adds
  infrastructure to provision, patch, and operate; Sentry SaaS's free/team tier is sufficient at
  current scale and matches the stack already declared in `docs/04 §2.13`.
- **A vendor-specific OTel SDK/exporter** (e.g. a Honeycomb- or Grafana-Cloud-specific package)
  instead of the standard OTLP exporter. Rejected — OTLP-over-HTTP is vendor-neutral, so
  swapping the collector target later requires only an env-var change, not a dependency or code
  change.
- **Per-endpoint/per-guard correlation-id generation.** Rejected — this is exactly the
  fragmentation AC-44/AC-45 exist to prevent; a single resolver function is mandatory.
- **Network-isolation-only protection for `/metrics`** (trust the VPC, no token). Rejected — the
  Railway/ECS Fargate deployment targets do not guarantee the metrics port is unreachable from
  the public internet; a bearer token is portable across both deploy targets.

## Related
Extends the RFC-7807 error envelope pattern used across P0–P6; activates the stack declared
(but stubbed) in `docs/04 §2.13`.
