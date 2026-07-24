# ADR 0048: Scheduling via `@nestjs/schedule` cron (no BullMQ) for MV refresh + report dispatch

## Status
Accepted

## Context
The phase-7 plan's Decision 3 asked whether to introduce BullMQ now for P7's two new scheduled
behaviors — periodic materialized-view refresh (ADR-0046) and recurring scheduled-report
dispatch (WS-B, AC-37/38/39) — or to stay consistent with the sync-seam pattern P6 chose for
notification/campaign dispatch (ADR-0039, itself extending ADR-0020). `bullmq` has never been
installed in this codebase; a documented (but unbuilt) migration path to it has been carried
since P2.

## Decision
**`@nestjs/schedule`** cron decorators drive both new scheduled behaviors, staying consistent
with the standing sync-seam architecture:

- A `refreshAnalyticsViews` cron job invokes the `refresh_analytics_views()` procedure
  (ADR-0046) on a configurable interval (default every 5 minutes).
- A `dispatchScheduledReports` cron job queries `report_schedules` (ADR-0051) for rows due to
  run and dispatches each via the existing `MailProvider`/Resend sync-seam (ADR-0039/0040) — no
  new dispatch mechanism is introduced for reports.

**Report dispatch re-evaluates the recipient's current RBAC scope at send time**, not at
schedule-creation time: immediately before building the report query, the job looks up the
recipient's live role/branch/assigned-batch assignment. This directly satisfies AC-37 — a
Branch Manager reassigned to a different branch between schedule creation and the next send
receives that new branch's data, never a scope snapshot captured when the schedule was defined.
`report_schedules` therefore never stores a "who can see what" snapshot — only the report type,
filters, cadence, and recipient identity.

**Both cron jobs are gated off entirely when `NODE_ENV=test`** — no cron registration happens in
the test module bootstrap, so no background timer ever fires during a unit/integration test
run. Failures in either job are caught and logged via structured pino output (never silently
dropped, AC-38); scheduled-report failures are additionally recorded so an admin-visible
failure list can be built without inventing new retry infrastructure.

BullMQ is still not installed.

## Consequences
- No new infrastructure — `@nestjs/schedule` is an in-process cron scheduler with no Redis/queue
  dependency of its own.
- MV refresh and report dispatch run in the same Node process as request handling. Under heavy
  load, a slow cron tick (e.g. a very large report query) could compete with request handling
  for the primary DB's connection pool — this is one of the specific signals the k6 load test
  (task #17) should surface as evidence for or against a future BullMQ migration, not something
  assumed benign.
- Consistent with SSE's documented single-instance limitation (ADR-0043): in a
  horizontally-scaled deployment, `@nestjs/schedule` cron jobs fire on every instance unless
  explicitly leader-elected. P7 ships single-instance-safe by relying on the current
  single-instance deployment shape; this is flagged as a pre-condition for horizontal API
  scaling, not solved by this ADR.
- Send-time scope re-evaluation means a demoted, reassigned, or deactivated recipient's next
  scheduled report reflects their *current* authority, closing the AC-37 gap by construction
  rather than by a periodic re-sync job.

## Alternatives considered
- **Introduce BullMQ now for both MV refresh and report dispatch.** Rejected per Decision 3 —
  staying consistent with the P6 sync-seam call (ADR-0039); no P7 acceptance criterion requires
  queue-level retry/backoff semantics that cron plus structured error logging cannot already
  satisfy.
- **Capture RBAC scope at schedule-creation time and reuse it verbatim at send time.** Rejected
  — directly violates AC-37 and risks a demoted or reassigned user's report leaking data outside
  their current authority.
- **An external cron trigger** (e.g. a scheduled GitHub Actions workflow calling an internal
  endpoint). Rejected — adds a second scheduling system to operate and secure (the triggered
  endpoint would need its own authentication) for no benefit over an in-process cron, given the
  current single-instance deployment shape.

## Related
Extends ADR-0039 (sync-seam dispatch) into scheduled/cron territory. MV refresh is consumed by
ADR-0046; report dispatch consumes the `report_schedules` table from ADR-0051.
