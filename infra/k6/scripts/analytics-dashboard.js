// infra/k6/scripts/analytics-dashboard.js
//
// Journey: CRM staff dashboard/report read (docs/specs/phase-7-analytics-hardening.md
// AC-70 journey #3; devops task "Analytics dashboard read (MV + Redis cache path)").
//
// Hits the KPI dashboard endpoints backed by the Phase-7 materialized-view/read-model +
// Redis cache-aside layer (apps/api/src/modules/analytics/analytics.controller.ts,
// LOCK-D1: "never the live write-path DB"):
//   - GET /api/v1/crm/reports/revenue      (AC-1, HEADLINE)
//   - GET /api/v1/crm/reports/enrollments  (AC-7)
//   - GET /api/v1/crm/reports/funnel       (AC-10)
//   - GET /api/v1/crm/reports/attendance   (AC-14/16 — no batchId = tenant-wide
//     aggregate, requires an Admin/Owner/Finance-equivalent account, see README)
//
// Deliberately does NOT include engagement/campaigns/gamification/forum-health in this
// default rotation — those require a real `programId`/`campaignId`/`batchId` from the
// target tenant's seeded data (EngagementReportQuery.programId is REQUIRED, unlike the
// four above which need only the from/to date range). Extend `REPORT_ENDPOINTS` below
// with real ids once staging has stable seeded entities if deeper dashboard coverage is
// wanted — see infra/k6/README.md.
//
// Models the PROPOSED "100 concurrent CRM staff sessions" target (AC-70, LOCK-D6).
// Uses the small-pool-plus-round-robin session pattern (scripts/lib/session-pool.js) —
// staff accounts are NOT behind the same per-IP volume concern as the 10k-learner
// journeys (100 concurrent sessions is well under the login rate limit even without
// pooling), but the pool pattern is used anyway for consistency and to keep `setup()`'s
// login traffic identical in shape across every script in this suite.
//
// Thresholds: dashboard AGGREGATE reads get the wider AC-53 budget (p95<500ms,
// p99<750ms) — heavier than a plain read because it's an aggregate, bounded because it
// never hits the live write-path DB (LOCK-D1). Error rate <1% (AC-71).

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
import { stepMetrics, recordStep, dashboardThresholds, errorRateThresholds } from "./lib/metrics.js";
import { buildRampStages, envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

const STAFF_EMAIL_PATTERN = __ENV.K6_STAFF_EMAIL_PATTERN || "staff.load%02d@stimuliiq.test";
const STAFF_POOL_SIZE = envInt("K6_STAFF_POOL_SIZE", 10);
const STAFF_PASSWORD = __ENV.K6_STAFF_PASSWORD;

// PROPOSED (AC-70, LOCK-D6): 100 concurrent CRM staff sessions.
const TARGET_VUS = envInt("K6_ANALYTICS_VUS", 100);

if (!STAFF_PASSWORD) {
  throw new Error(
    "[analytics-dashboard] K6_STAFF_PASSWORD is not set — see infra/k6/README.md " +
      "'Provisioning load-test accounts'. This pool needs reports.*.view permission at " +
      "'all' scope (Admin/Owner/Finance-equivalent) to exercise the no-filter aggregate " +
      "views (AC-16) — a Branch-Manager/Counsellor/Faculty-scoped account will get valid " +
      "but narrower (branch/own/assigned) responses, which is also fine for load-shape " +
      "purposes but will not exercise the all-tenant aggregate path.",
  );
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const today = new Date();
const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
const FROM = isoDate(thirtyDaysAgo);
const TO = isoDate(today);

const REPORT_ENDPOINTS = [
  { name: "analytics_revenue", path: `/api/v1/crm/reports/revenue?from=${FROM}&to=${TO}` },
  { name: "analytics_enrollments", path: `/api/v1/crm/reports/enrollments?from=${FROM}&to=${TO}` },
  { name: "analytics_funnel", path: `/api/v1/crm/reports/funnel?from=${FROM}&to=${TO}` },
  { name: "analytics_attendance", path: `/api/v1/crm/reports/attendance?from=${FROM}&to=${TO}` },
];

const metricsByName = Object.fromEntries(REPORT_ENDPOINTS.map((e) => [e.name, stepMetrics(e.name)]));

export const options = {
  scenarios: {
    analytics_dashboard: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildRampStages(TARGET_VUS),
      gracefulRampDown: "30s",
    },
  },
  thresholds: Object.fromEntries(
    REPORT_ENDPOINTS.flatMap((e) => [
      [`${e.name}_duration`, dashboardThresholds()],
      [`${e.name}_errors`, errorRateThresholds()],
    ]),
  ),
};

export function setup() {
  const emails = expandEmailPattern(STAFF_EMAIL_PATTERN, STAFF_POOL_SIZE);
  const sessions = loginPool(emails, STAFF_PASSWORD);
  return { sessions };
}

export default function (data) {
  const session = pickSession(data.sessions, exec.vu.idInTest);
  ensureFreshSession(session);

  // A real staff session opens the Overview dashboard and clicks between a couple of
  // widgets in one sitting — model 1-2 report reads per iteration rather than one.
  const howMany = 1 + (Math.random() < 0.5 ? 1 : 0);
  const shuffled = [...REPORT_ENDPOINTS].sort(() => Math.random() - 0.5).slice(0, howMany);

  for (const endpoint of shuffled) {
    const res = http.get(`${BASE_URL}${endpoint.path}`, authParams(session, { tags: { name: endpoint.name } }));
    recordStep(res, metricsByName[endpoint.name], {
      [`${endpoint.name}: status is 200`]: (r) => r.status === 200,
      [`${endpoint.name}: has freshness metadata`]: (r) => {
        try {
          const body = JSON.parse(r.body).data;
          return typeof body?.asOf === "string" && typeof body?.stale === "boolean";
        } catch {
          return false;
        }
      },
    });
    sleep(1 + Math.random() * 2);
  }

  sleep(5 + Math.random() * 10);
}

export const handleSummary = buildHandleSummary("analytics-dashboard");
