// infra/k6/scripts/public-funnel.js
//
// Journey: anonymous browse of the public marketing/SEO funnel (devops task
// instructions "Public funnel (program list/detail — the SEO/marketing read path)";
// docs/specs/phase-7-analytics-hardening.md AC-70 journey #1 read-only portion).
//
// Hits ONLY the anonymous, unauthenticated catalog reads:
//   - GET /api/v1/public/programs        (list — filters + cursor pagination)
//   - GET /api/v1/public/programs/:slug  (detail — picks a slug from the list response)
//
// DELIBERATELY DOES NOT call `POST /public/leads`, `POST /public/register`, or any
// `POST /public/enroll/*` endpoint — per the task instructions, this suite never
// exercises the Razorpay TEST charge path in load (AC-73: load test never touches a
// live payment gateway; the write side of the funnel is a separate, smaller-scale
// concern the product decided NOT to load-test here). No auth, no session pool needed —
// this is the one fully anonymous scenario in the suite.
//
// Thresholds: plain public reads (AC-51/71: p95<300ms, p99<450ms), error rate <1%
// (AC-71). No explicit numeric concurrency target is given for this journey in AC-70
// (only learners/streams/CRM-staff have PROPOSED numbers) — the default VU count below
// is sized proportionally to a plausible marketing-traffic share and is clearly a
// suite-authored default, not a spec AC; tune via K6_PUBLIC_FUNNEL_VUS.

import http from "k6/http";
import { sleep } from "k6";
import { BASE_URL } from "../config.js";
import { stepMetrics, recordStep, readThresholds, errorRateThresholds } from "./lib/metrics.js";
import { buildRampStages, envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

// Not a spec-numbered AC target (see file header) — suite default, tunable.
const TARGET_VUS = envInt("K6_PUBLIC_FUNNEL_VUS", 1000);

const programsList = stepMetrics("public_programs_list");
const programDetail = stepMetrics("public_program_detail");

export const options = {
  scenarios: {
    public_funnel: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildRampStages(TARGET_VUS),
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    public_programs_list_duration: readThresholds(),
    public_programs_list_errors: errorRateThresholds(),
    public_program_detail_duration: readThresholds(),
    public_program_detail_errors: errorRateThresholds(),
  },
};

export default function () {
  const listRes = http.get(`${BASE_URL}/api/v1/public/programs?limit=12`, {
    tags: { name: "public_programs_list" },
  });
  const listed = recordStep(listRes, programsList, {
    "programs list: status is 200": (r) => r.status === 200,
    "programs list: has items array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).data?.items);
      } catch {
        return false;
      }
    },
  });

  sleep(1 + Math.random() * 3); // browsing the list before clicking into a card

  if (listed) {
    let slug;
    try {
      const items = JSON.parse(listRes.body).data.items;
      if (Array.isArray(items) && items.length > 0) {
        slug = items[Math.floor(Math.random() * items.length)].slug;
      }
    } catch {
      slug = undefined;
    }

    if (slug) {
      const detailRes = http.get(`${BASE_URL}/api/v1/public/programs/${slug}`, {
        tags: { name: "public_program_detail" },
      });
      recordStep(detailRes, programDetail, {
        "program detail: status is 200": (r) => r.status === 200,
      });
    }
  }

  sleep(2 + Math.random() * 6); // reading the program detail page
}

export const handleSummary = buildHandleSummary("public-funnel");
