// infra/k6/scripts/lms-dashboard.js
//
// Journey: student login → dashboard read path (docs/specs/phase-7-analytics-hardening.md
// AC-70 journey #2, first half; devops task "LMS student dashboard read path").
//
// Models the PROPOSED "10,000 concurrent learners" target (docs/00 §7, AC-70 — PROPOSED,
// pending user sign-off per LOCK-D6). Authenticates a SMALL pool of accounts once in
// `setup()` (see scripts/lib/session-pool.js for why — the per-IP auth rate limiter),
// then every VU round-robins across that pool and repeatedly hits the two hottest
// student-facing LMS reads:
//   - GET /api/v1/me/dashboard    (continue-learning rail, progress rings)
//   - GET /api/v1/me/enrollments  (My Courses list)
// with a realistic think-time between actions (a real student doesn't hammer refresh).
//
// Thresholds: plain reads (AC-51/71: p95<300ms, p99<450ms), error rate <1% (AC-71).

import http from "k6/http";
import { sleep } from "k6";
import exec from "k6/execution";
import { BASE_URL } from "../config.js";
import {
  loginPool,
  pickSession,
  ensureFreshSession,
  authParams,
  expandEmailPattern,
} from "./lib/session-pool.js";
import { stepMetrics, recordStep, readThresholds, errorRateThresholds } from "./lib/metrics.js";
import { buildRampStages, envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

const STUDENT_EMAIL_PATTERN = __ENV.K6_STUDENT_EMAIL_PATTERN || "student.load%03d@stimuliiq.test";
const STUDENT_POOL_SIZE = envInt("K6_STUDENT_POOL_SIZE", 50);
const STUDENT_PASSWORD = __ENV.K6_STUDENT_PASSWORD;

// PROPOSED (AC-70, LOCK-D6): 10,000 concurrent learners. Tune down for interim/smoke
// runs via K6_LMS_DASHBOARD_VUS — see infra/k6/README.md "Reaching 10k VUs from one
// machine" for the realistic ceiling of a single (non-distributed) k6 instance.
const TARGET_VUS = envInt("K6_LMS_DASHBOARD_VUS", 10000);

if (!STUDENT_PASSWORD) {
  throw new Error(
    "[lms-dashboard] K6_STUDENT_PASSWORD is not set — see infra/k6/README.md " +
      "'Provisioning load-test accounts'.",
  );
}

const dashboard = stepMetrics("lms_dashboard");
const enrollments = stepMetrics("lms_enrollments");

export const options = {
  scenarios: {
    lms_dashboard: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildRampStages(TARGET_VUS),
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    lms_dashboard_duration: readThresholds(),
    lms_dashboard_errors: errorRateThresholds(),
    lms_enrollments_duration: readThresholds(),
    lms_enrollments_errors: errorRateThresholds(),
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

  const dashboardRes = http.get(`${BASE_URL}/api/v1/me/dashboard`, authParams(session, { tags: { name: "lms_dashboard" } }));
  recordStep(dashboardRes, dashboard, {
    "dashboard: status is 200": (r) => r.status === 200,
    "dashboard: has data envelope": (r) => {
      try {
        return JSON.parse(r.body).data !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(1 + Math.random() * 2);

  // A student opening the dashboard very often also opens "My Courses" in the same
  // sitting — model that as a high-probability (not universal) follow-on read.
  if (Math.random() < 0.6) {
    const enrollmentsRes = http.get(
      `${BASE_URL}/api/v1/me/enrollments`,
      authParams(session, { tags: { name: "lms_enrollments" } }),
    );
    recordStep(enrollmentsRes, enrollments, {
      "enrollments: status is 200": (r) => r.status === 200,
    });
  }

  // Realistic dwell time before the next dashboard refresh/navigation.
  sleep(4 + Math.random() * 8);
}

export const handleSummary = buildHandleSummary("lms-dashboard");
