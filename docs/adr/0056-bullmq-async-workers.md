# ADR 0056: BullMQ async workers — supersedes the sync-seam decision (ADR-0020/0039)

## Status
Accepted

## Context
ADR-0020 (P2: invoice-gen/webhook-processor) and ADR-0039 (P6: notification/campaign
dispatch) established a deliberate **sync-with-seam** pattern: every async-shaped
work item (invoice generation, Razorpay webhook processing, video-transcode webhook
processing, notification fan-out, campaign send, certificate/report PDF rendering)
runs **synchronously in the request cycle**, behind a `*Port` DI token whose sole
implementation is a `Sync*Adapter`. Each port's file header documents a "BullMQ
MIGRATION PATH" that was explicitly **not** built, because installing `bullmq` was a
standing ask-user-before-install dependency (`CLAUDE.md §1`) out of scope for P0–P8.

`docs/plans/phase-9-completion.md` task T18 (R1) is the user-approved trigger to
finally install `bullmq` and wire every one of those documented seams to real queues,
moving the work off the HTTP request path:

- Notification/campaign fan-out currently blocks the request on N sequential
  `MailProvider`/`SmsProvider`/`WhatsAppProvider` calls (`CAMPAIGN_SEND_BATCH_SIZE`,
  T5/R2, already caps a single call to 500 recipients — but even 500 sequential
  provider calls in one request is a meaningful latency/timeout risk).
- Invoice generation and Razorpay/video-transcode webhook processing hold the
  webhook HTTP connection open for the full DB-transaction + (future) PDF-render
  + storage-upload chain; a slow webhook ack risks the vendor's own retry/timeout
  policy firing spuriously.
- Certificate/report PDF rendering (`@react-pdf/renderer`) is CPU-bound work
  currently executed inline on the API process's event loop, competing with every
  other concurrent request for the same thread.

## Decision
Install `bullmq` (already present in `apps/api/package.json` per this task's
approval) and, for every port established by ADR-0020/0039, add a **second**
adapter implementation gated by a new `QUEUE_DRIVER` env var
(`apps/api/src/config/env.ts`, default `"sync"`):

| Port | Sync adapter (default, `QUEUE_DRIVER=sync`) | BullMQ adapter (`QUEUE_DRIVER=bullmq`) |
|---|---|---|
| `NotificationDispatchPort` | `SyncNotificationDispatchAdapter` | `BullMqNotificationDispatchAdapter` |
| `CampaignSendPort` | `SyncCampaignSendAdapter` | `BullMqCampaignSendAdapter` |
| `InvoiceGenPort` | `SyncInvoiceGenAdapter` | `BullMqInvoiceGenAdapter` |
| `WebhookProcessorPort` (commerce) | `SyncWebhookProcessorAdapter` | `BullMqWebhookProcessorAdapter` |
| `VideoWebhookProcessorPort` (lms) | `SyncVideoWebhookProcessorAdapter` | `BullMqVideoWebhookProcessorAdapter` |
| `CertificatePdfPort` | `SyncCertificatePdfAdapter` | `BullMqCertificatePdfAdapter` |
| `ReportPdfPort` | `SyncReportPdfAdapter` | `BullMqReportPdfAdapter` |

Two distinct queue-usage patterns:

1. **Fire-and-forget** (notification/campaign/invoice-gen/webhook-processors): the
   producer `queue.add()`s the job with `jobId: <dedupeKey>` (BullMQ-level
   idempotency, layered on top of the pre-existing DB-level uniques from
   ADR-0020/0039 — belt-and-braces, not a replacement) and returns immediately.
   `FIRE_AND_FORGET_JOB_OPTIONS` (`apps/api/src/queues/job-options.ts`): 5 attempts,
   exponential backoff, failed jobs retained (`removeOnFail: { count: 200 }`) as a
   pseudo-DLQ for inspection/manual retry.
2. **RPC-style** (certificate/report PDF): the producer enqueues AND
   `await`s the result via `job.waitUntilFinished(queueEvents, RPC_JOB_TIMEOUT_MS)`
   — the caller (`CertificatesService`/`ExportsService`) keeps its existing
   "await bytes, then upload via StorageProvider" call shape unchanged, but the
   actual `@react-pdf/renderer` CPU work now runs in the separate worker process,
   not on the API process's event loop.

A single **worker entrypoint** (`apps/api/src/worker.ts`, run via
`pnpm --filter @stimuliiq/api run worker` / `node dist/worker.js`) boots the SAME
`AppModule` as the API (via `NestFactory.createApplicationContext`, no HTTP
listener) and registers one BullMQ `Worker` per queue. Each worker's processor
function delegates to the **exact same `Sync*Adapter` class** the API process uses
when `QUEUE_DRIVER=sync` (resolved from the shared Nest DI container, or
constructed directly with the same provider dependencies) — there is only ONE
implementation of "what happens when a job runs"; `QUEUE_DRIVER` only decides
whether it runs inline or in the worker.

`QUEUE_DRIVER` defaults to `"sync"` — **the Jest unit suite is unaffected and stays
fully synchronous and Redis-free**; BullMQ `Queue`/`Worker` instances are
constructed ONLY inside the `bullmq` branch of each module's `useFactory`, never
eagerly.

## Consequences
- Staging/production can now set `QUEUE_DRIVER=bullmq` and deploy the worker as a
  separate process/container, moving all seven work items off the request path —
  closing R1 exactly as scoped.
- The 1500+ existing unit tests require **zero changes** to stay green (verified:
  `QUEUE_DRIVER=sync` is the default and every `Sync*Adapter`'s call-site behaviour
  is byte-for-byte unchanged).
- A production deploy that sets `QUEUE_DRIVER=bullmq` on the API but forgets to run
  the worker process silently accumulates jobs in Redis with no consumer — this is
  an operational risk, not a code-level fail-closed gate (unlike the vendor
  provider modules, `QUEUE_DRIVER` has no "boot-throw if misconfigured" check,
  because a missing worker is a deploy-topology problem, not a credential problem;
  `apps/api/src/worker.ts` logs a loud warning on the inverse misconfiguration
  — a worker process running against `QUEUE_DRIVER=sync`, which does nothing).
- `docs/04 §2.8`'s "queues already provisioned" wording, called out as
  aspirational-not-actual in ADR-0039, is now **actually true** as of this ADR.
- The pseudo-DLQ (`removeOnFail: { count: N }`) is a starting point, not full DLQ
  tooling (no replay UI, no alerting on failed-job accumulation) — deferred to a
  future observability wave, same deferral pattern ADR-0039 used for P6.
- `ioredis` is pinned to a single resolved version workspace-wide
  (`package.json` → `pnpm.overrides`) because `bullmq`'s own transitive `ioredis`
  dependency and `apps/api`'s direct `ioredis` dependency (already used by
  `RedisService`) resolved to two structurally-incompatible versions under pnpm's
  per-package isolation, breaking TypeScript's structural typing for
  `bullmq`'s `ConnectionOptions`. `apps/api/src/queues/queue-connection.ts` also
  sidesteps this class of conflict going forward by passing BullMQ **plain
  connection options** (host/port/password/db parsed from `REDIS_URL`) rather than
  a shared `ioredis.Redis` instance — BullMQ constructs its own internally-typed
  client from those options, so this file never imports `ioredis` types at all.

## Alternatives considered
- **Migrate every port fully to BullMQ-only (remove the Sync adapters).** Rejected
  — would break `QUEUE_DRIVER=sync` for local dev/CI (no Redis dependency
  required to run `pnpm test`), and removes the fallback path this ADR
  explicitly preserves for environments without a worker deployment.
- **A single generic `GenericJobPort<T>` instead of seven distinct ports.**
  Rejected — the seven ports (`NotificationDispatchPort` et al.) already exist
  from ADR-0020/0039 with distinct, well-documented input/output contracts;
  collapsing them into one generic port would be a larger, riskier refactor for
  no correctness benefit, and breaks the "swap one binding, zero caller changes"
  migration promise both prior ADRs made.
- **`@nestjs/bullmq` (the official NestJS wrapper package) instead of plain
  `bullmq`.** Rejected for this task — only `bullmq` was the user-approved
  dependency (`CLAUDE.md §1`, this task's kickoff instructions name it
  explicitly); the wrapper adds `@Processor()`/`@Process()` decorator sugar this
  codebase's `useFactory`-first provider-module convention (ADR-0023/DEFECT-1)
  doesn't need, and the worker entrypoint achieves the same result with plain
  `bullmq.Worker` instances resolved from the shared `AppModule` context.
- **Passing a shared `ioredis.Redis` instance as BullMQ's `connection` (rather
  than plain options).** Attempted first; rejected after hitting the
  cross-package structural-typing conflict described above. Plain connection
  options are also BullMQ's own documented default pattern.

## Related
Supersedes/extends ADR-0020 (Invoice generation and webhook processing via
SYNC-with-seam) and ADR-0039 (P6 notification/campaign dispatch via sync-seam).
