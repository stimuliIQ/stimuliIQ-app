// infra/k6/scripts/lib/summary.js
//
// Shared `handleSummary()` builder — archives every run's full metrics JSON tagged with
// the git commit SHA + run date (AC-74: "Load test results are archived and diffable
// across phases"), while still printing k6's normal human-readable summary to stdout.
//
// Uses k6's official jslib summary formatter (https://jslib.k6.io/k6-summary/0.1.0/) —
// this is a REMOTE import fetched by the k6 binary at script-load time (same origin
// family as k6 itself; this is the standard, documented way to customize
// `handleSummary()` output without vendoring a copy). Requires outbound HTTPS access
// from wherever `k6 run` executes to jslib.k6.io.
//
// Archived files land in `infra/k6/results/<scriptName>-<RUN_TAG>.json` — see
// `infra/k6/results/.gitignore` (raw run output is not committed; a human/CI archival
// step decides what's worth keeping long-term per README "Archiving results (AC-74)").

import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { RUN_TAG } from "../../config.js";

/**
 * @param {string} scriptName e.g. "lms-dashboard" — used as the archived file's prefix.
 * @returns {(data: object) => Record<string, string>} pass this directly as the
 *   module's `handleSummary` export.
 */
export function buildHandleSummary(scriptName) {
  return function handleSummary(data) {
    const path = `infra/k6/results/${scriptName}-${RUN_TAG}.json`;
    return {
      stdout: textSummary(data, { indent: " ", enableColors: true }),
      [path]: JSON.stringify(
        {
          script: scriptName,
          runTag: RUN_TAG,
          generatedAt: new Date().toISOString(),
          metrics: data.metrics,
          rootGroup: data.root_group,
        },
        null,
        2,
      ),
    };
  };
}
