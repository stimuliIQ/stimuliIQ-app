// infra/k6/scripts/lib/metrics.js
//
// Shared metric/threshold helpers for the Phase-7 Wave-4 k6 suite
// (docs/plans/phase-7.md task #17, docs/specs/phase-7-analytics-hardening.md WS-F).
//
// Every scenario script defines its own per-step Trend (latency) + Rate (error) custom
// metrics using the factories below, so:
//   - thresholds are declared once per journey step, not copy-pasted ad hoc, and
//   - the "error rate < 1% across all journeys" (AC-71) rule is enforced the SAME way
//     everywhere: a request counts as an error whenever its `check(...)` fails — not
//     k6's default `http_req_failed` (which only flags network-level failures / the
//     `expectedStatuses` you explicitly configure, and would silently miss e.g. an
//     unexpected 500 with a 2xx-shaped body).
//
// PROPOSED numeric SLOs (docs/specs/phase-7-analytics-hardening.md AC-51/53/71 — need
// explicit user sign-off per LOCK-D6; encoded here as documented, tunable constants):
//   - READ endpoints:              p95 < 300ms, p99 < 450ms  (1.5x p95, AC-71)
//   - WRITE endpoints:              p95 < 800ms, p99 < 1200ms (1.5x p95, AC-71)
//   - Dashboard AGGREGATE reads:    p95 < 500ms, p99 < 750ms  (AC-53, 1.5x p95 per AC-71)
//   - Error rate:                   < 1% for every journey (AC-71)

import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

export const READ_P95_MS = 300;
export const READ_P99_MS = 450;
export const WRITE_P95_MS = 800;
export const WRITE_P99_MS = 1200;
export const DASHBOARD_P95_MS = 500;
export const DASHBOARD_P99_MS = 750;
export const MAX_ERROR_RATE = 0.01;

/** Threshold array for a "read" journey step (AC-51, AC-71). */
export function readThresholds() {
  return [`p(95)<${READ_P95_MS}`, `p(99)<${READ_P99_MS}`];
}

/** Threshold array for a "write" journey step (AC-51, AC-71). */
export function writeThresholds() {
  return [`p(95)<${WRITE_P95_MS}`, `p(99)<${WRITE_P99_MS}`];
}

/** Threshold array for a materialized-view/read-replica-backed dashboard aggregate (AC-53). */
export function dashboardThresholds() {
  return [`p(95)<${DASHBOARD_P95_MS}`, `p(99)<${DASHBOARD_P99_MS}`];
}

/** Threshold array for an error-rate custom Rate metric (AC-71: < 1%). */
export function errorRateThresholds() {
  return [`rate<${MAX_ERROR_RATE}`];
}

/**
 * Creates a { duration, errors } custom-metric pair for one named journey step
 * (e.g. "login", "dashboard", "stream_url_mint"). Use the returned metrics directly
 * in `options.thresholds` and in `recordStep()` below.
 */
export function stepMetrics(name) {
  return {
    duration: new Trend(`${name}_duration`, true),
    errors: new Rate(`${name}_errors`),
  };
}

/**
 * Runs `check()` against a response, feeds the pass/fail into the step's error-rate
 * metric, and records the response duration into the step's latency Trend — all in one
 * call so every scenario script records results identically.
 *
 * @param {import('k6/http').RefinedResponse} res
 * @param {{ duration: import('k6/metrics').Trend, errors: import('k6/metrics').Rate }} metric
 * @param {Record<string, (res: import('k6/http').RefinedResponse) => boolean>} checks
 * @returns {boolean} true if every check passed
 */
export function recordStep(res, metric, checks) {
  const ok = check(res, checks);
  metric.errors.add(!ok);
  metric.duration.add(res.timings.duration);
  return ok;
}
