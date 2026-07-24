// infra/k6/config.js
//
// Shared target-resolution helper for the Phase-7 Wave-4 k6 load-test suite
// (docs/plans/phase-7.md task #17, docs/specs/phase-7-analytics-hardening.md WS-F).
// qa-engineer's actual test scripts (built separately, in this same wave) should
// import BASE_URL from this file rather than reading `__ENV.K6_BASE_URL` directly, so
// every script shares one guard rail.
//
// SAFETY RAILS (docs/specs/phase-7-analytics-hardening.md edge-case table, WS-F):
//   - k6 MUST run against a DEDICATED STAGING environment — never CI, never the
//     live/production origin, never a developer's localhost API.
//   - The payment journey (AC-73) exclusively uses Razorpay TEST mode — that is
//     enforced by the STAGING environment's own Razorpay key configuration
//     (rzp_test_*), not by this file; this file only guards the HTTP target.
//
// USAGE (see infra/k6/README.md for the full runbook):
//   K6_BASE_URL=https://staging-api.stimuliiq.com k6 run infra/k6/scripts/<script>.js
//
// This file intentionally has NO import of the `k6` runtime module — it is plain
// JS so it can be unit-reasoned-about/lint-checked outside the k6 binary too.

const DISALLOWED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /\.local$/i,
  // Known production hostnames — extend this list as real prod domains are
  // provisioned. Never let a load test target these, even by accident/typo.
  /^stimuliiq\.com$/i,
  /^www\.stimuliiq\.com$/i,
  /^api\.stimuliiq\.com$/i,
  /^app\.stimuliiq\.com$/i,
];

// NOTE: this deliberately does NOT use the WHATWG `URL` global — the k6 JS runtime
// (goja) does not provide `URL`/`URLSearchParams` as a global, and the obvious
// alternative (`import { URL } from "k6/experimental/url"`) is not resolvable on every
// k6 build (observed: it triggers a failed "automatic extension resolution" binary
// rebuild on at least one distribution channel). A hand-rolled parser limited to exactly
// what this guard needs (scheme + hostname [+ port]) avoids that dependency entirely and
// was verified against a real `k6 run` (qa-engineer, Phase-7 Wave 4 load-test task).
function parseHttpUrl(rawUrl) {
  const match = /^(https?):\/\/([^/:?#]+)(:\d+)?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(rawUrl);
  if (!match) {
    return null;
  }
  const protocol = `${match[1].toLowerCase()}:`;
  const hostname = match[2].toLowerCase();
  const port = match[3] ?? "";
  return { protocol, hostname, origin: `${protocol}//${hostname}${port}` };
}

function assertSafeTarget(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "[infra/k6/config.js] K6_BASE_URL is not set. k6 MUST target a dedicated staging " +
        "environment — never CI, never production, never localhost. Example:\n" +
        "  K6_BASE_URL=https://staging-api.stimuliiq.com k6 run infra/k6/scripts/<script>.js",
    );
  }

  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    throw new Error(`[infra/k6/config.js] K6_BASE_URL is not a valid http(s) URL: "${rawUrl}"`);
  }

  if (DISALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new Error(
      `[infra/k6/config.js] K6_BASE_URL host "${parsed.hostname}" is disallowed — k6 must ` +
        "target a dedicated STAGING environment, never localhost/production. If this host " +
        "genuinely IS the staging origin, add an explicit staging pattern here rather than " +
        "removing the guard.",
    );
  }

  return parsed.origin;
}

// K6_BASE_URL — REQUIRED, no default. Deliberately does NOT fall back to any value
// (e.g. localhost:4000) — a missing/unset target must fail loudly, not silently run
// against whatever the k6 binary's environment happens to have lying around.
export const BASE_URL = assertSafeTarget(typeof __ENV !== "undefined" ? __ENV.K6_BASE_URL : process.env.K6_BASE_URL);

// Optional: a human-readable tag for the run, used when archiving results (AC-74).
// Defaults to the current date if unset; qa-engineer's scripts should still prefer
// tagging with the actual git commit SHA (e.g. `K6_RUN_TAG=$(git rev-parse --short
// HEAD)`) when archiving a report.
export const RUN_TAG =
  (typeof __ENV !== "undefined" ? __ENV.K6_RUN_TAG : process.env.K6_RUN_TAG) ||
  new Date().toISOString().slice(0, 10);
