// apps/api/src/queues/job-options.ts
//
// Shared BullMQ job-options presets (docs/plans/phase-9-completion.md T18 / R1).
// Every BullMq*Adapter uses one of these so retry/backoff/DLQ behaviour is consistent
// across queues instead of being redefined ad hoc per adapter.

import type { JobsOptions } from "bullmq";

/**
 * Fire-and-forget jobs (notification dispatch, campaign send, invoice gen, webhook
 * processing): the producer enqueues and returns immediately; the worker retries with
 * exponential backoff on failure. Failed jobs are RETAINED (not removed) up to
 * `removeOnFail.count` — this is the pseudo-DLQ: a failed job stays visible in the
 * queue's failed set for inspection/manual retry instead of vanishing silently.
 */
export const FIRE_AND_FORGET_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: true,
  removeOnFail: { count: 200 },
};

/**
 * RPC-style jobs (certificate PDF render, report PDF render): the producer AWAITS the
 * job result via `job.waitUntilFinished()` within the same request. Fewer retries and
 * a shorter backoff — a slow/failing render should surface back to the caller quickly
 * rather than holding the HTTP request open through 5 exponential-backoff attempts.
 */
export const RPC_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 500 },
  removeOnComplete: true,
  removeOnFail: { count: 100 },
};

/** How long an RPC-style producer waits for the worker's result before giving up. */
export const RPC_JOB_TIMEOUT_MS = 30_000;
