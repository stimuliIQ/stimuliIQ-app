// infra/k6/scripts/notifications.js
//
// Journey: notification fan-out / notifications list (devops task instructions
// "Notification fan-out / notifications list").
//
// The actual SEND side of notification fan-out (campaign dispatch, SSE push) is
// deliberately NOT exercised here — this suite never triggers real email/SMS/WhatsApp
// sends (docs/specs/phase-7-analytics-hardening.md WS-F edge-case table: "Test-mode/Noop
// providers ... no real message volume is sent to real recipients", enforced by the
// STAGING env's own provider config, not by this script). What this script load-tests is
// the CONSUMPTION side every one of those fanned-out notifications lands on:
//   - GET /api/v1/me/notifications             (the list read — also the documented SSE
//     polling FALLBACK, apps/api/src/modules/notifications/notifications.controller.ts)
//   - POST /api/v1/me/notifications/:id/read    (occasional mark-read write)
// This is the actual hot path at scale: thousands of concurrent students' notification
// bells polling/listing, not the comparatively low-volume admin-triggered send action.
//
// Uses the same small-pool-plus-round-robin session pattern as lms-dashboard.js (see
// scripts/lib/session-pool.js) to respect the auth IP rate limit.
//
// Thresholds: list is a read (AC-51/71: p95<300ms, p99<450ms); mark-read is a write
// (p95<800ms, p99<1200ms). Error rate <1% for both (AC-71).

import http from "k6/http";
import { sleep } from "k6";
import exec from "k6/execution";
import { BASE_URL } from "../config.js";
import {
  loginPool,
  pickSession,
  ensureFreshSession,
  authParams,
  authWriteParams,
  expandEmailPattern,
} from "./lib/session-pool.js";
import { stepMetrics, recordStep, readThresholds, writeThresholds, errorRateThresholds } from "./lib/metrics.js";
import { buildRampStages, envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

const STUDENT_EMAIL_PATTERN = __ENV.K6_STUDENT_EMAIL_PATTERN || "student.load%03d@stimuliiq.test";
const STUDENT_POOL_SIZE = envInt("K6_STUDENT_POOL_SIZE", 50);
const STUDENT_PASSWORD = __ENV.K6_STUDENT_PASSWORD;

// Not a spec-numbered AC target — sized as a plausible subset of the 10k-learner
// population simultaneously polling their notification bell; suite default, tunable.
const TARGET_VUS = envInt("K6_NOTIFICATIONS_VUS", 2000);

if (!STUDENT_PASSWORD) {
  throw new Error(
    "[notifications] K6_STUDENT_PASSWORD is not set — see infra/k6/README.md " +
      "'Provisioning load-test accounts'.",
  );
}

const notificationsList = stepMetrics("notifications_list");
const notificationMarkRead = stepMetrics("notification_mark_read");

export const options = {
  scenarios: {
    notifications: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildRampStages(TARGET_VUS),
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    notifications_list_duration: readThresholds(),
    notifications_list_errors: errorRateThresholds(),
    notification_mark_read_duration: writeThresholds(),
    notification_mark_read_errors: errorRateThresholds(),
  },
};

export function setup() {
  const emails = expandEmailPattern(STUDENT_EMAIL_PATTERN, STUDENT_POOL_SIZE);
  const sessions = loginPool(emails, STUDENT_PASSWORD);
  return { sessions };
}

export default function (data) {
  const session = pickSession(data.sessions, exec.vu.idInTest);
  ensureFreshSession(session);

  // Alternate between the "unread badge" poll (most common — the SSE-fallback poll
  // interval) and a full-list open.
  const unreadOnly = Math.random() < 0.7;
  const listRes = http.get(
    `${BASE_URL}/api/v1/me/notifications?limit=20${unreadOnly ? "&unread=true" : ""}`,
    authParams(session, { tags: { name: "notifications_list" } }),
  );
  const listed = recordStep(listRes, notificationsList, {
    "notifications list: status is 200": (r) => r.status === 200,
    "notifications list: data is an array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).data);
      } catch {
        return false;
      }
    },
  });

  // A student opening the panel occasionally taps one notification (marks it read).
  if (listed && Math.random() < 0.3) {
    let firstId;
    try {
      const items = JSON.parse(listRes.body).data;
      firstId = Array.isArray(items) && items.length > 0 ? items[0].id : undefined;
    } catch {
      firstId = undefined;
    }

    if (firstId) {
      const readRes = http.post(
        `${BASE_URL}/api/v1/me/notifications/${firstId}/read`,
        null,
        authWriteParams(session, { tags: { name: "notification_mark_read" } }),
      );
      recordStep(readRes, notificationMarkRead, {
        "mark-read: status is 200": (r) => r.status === 200,
      });
    }
  }

  // Poll cadence — the SSE fallback documented interval is ~10-20s; this VU sleeps for a
  // comparable window before its next poll.
  sleep(10 + Math.random() * 10);
}

export const handleSummary = buildHandleSummary("notifications");
