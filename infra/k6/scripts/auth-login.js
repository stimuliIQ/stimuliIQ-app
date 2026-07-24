// infra/k6/scripts/auth-login.js
//
// Journey: password login (docs/specs/phase-7-analytics-hardening.md WS-F, AC-70 journey
// #2's entry step; devops task instructions Wave 4 "Auth" bullet).
//
// ── WHY THIS SCRIPT DOES **NOT** RAMP TO THOUSANDS OF VUs ──────────────────────────────
// `POST /auth/login` sits behind `AuthIpRateLimitGuard`
// (apps/api/src/modules/auth/guards/auth-ip-rate-limit.guard.ts, AC-57): a FAIL-CLOSED
// fixed window of `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` (default 20) attempts per
// `AUTH_IP_RATE_LIMIT_WINDOW_SECONDS` (default 60s), keyed by **source IP + handler
// name**. A single k6 load-generator machine (or a single staging egress NAT) presents
// as ONE source IP, no matter how many VUs it runs. Ramping this endpoint to "10,000
// concurrent learners" the way lms-dashboard.js ramps VUs would therefore 429 almost
// immediately — that would be testing the rate limiter, not the login path, and every
// other scenario in this suite deliberately logs in ONCE per session (via
// `scripts/lib/session-pool.js`) for exactly this reason.
//
// What THIS script models instead: the real-world arrival rate of NEW login attempts
// (users starting a fresh session — first visit of the day, session expired, logged out
// and back in) — a small, steady trickle, NOT "10k users click login at once". It uses a
// `constant-arrival-rate` executor at `K6_LOGIN_ARRIVAL_RATE` per
// `K6_LOGIN_ARRIVAL_WINDOW_S`, defaulting to 10 logins / 60s — 50% of the API's default
// budget (20/60s), leaving headroom for jitter, other scenarios' `setup()` login calls
// sharing the same egress IP, and the guard's own bookkeeping overhead.
//
// ── IF YOU SPECIFICALLY NEED TO VALIDATE RAW LOGIN THROUGHPUT ABOVE THE DEFAULT BUDGET ──
// That is a DIFFERENT, narrower test than "model the 100k-concurrent-student target" and
// requires either (a) running from multiple distinct source IPs (k6 Cloud / multiple
// distributed load-generator hosts), or (b) coordinating a temporarily-raised
// `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` on the STAGING env only (never production) with
// whoever owns that config. Neither is done by this script — see
// infra/k6/README.md "Auth journey & the per-IP rate limiter".

import http from "k6/http";
import { sleep } from "k6";
import exec from "k6/execution";
import { BASE_URL } from "../config.js";
import { expandEmailPattern } from "./lib/session-pool.js";
import { stepMetrics, recordStep, writeThresholds, errorRateThresholds } from "./lib/metrics.js";
import { envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

const STUDENT_EMAIL_PATTERN = __ENV.K6_STUDENT_EMAIL_PATTERN || "student.load%03d@stimuliiq.test";
const STUDENT_POOL_SIZE = envInt("K6_STUDENT_POOL_SIZE", 50);
const STUDENT_PASSWORD = __ENV.K6_STUDENT_PASSWORD;

const LOGIN_ARRIVAL_RATE = envInt("K6_LOGIN_ARRIVAL_RATE", 10); // iterations per window — keep < 20 (default per-IP budget)
const LOGIN_ARRIVAL_WINDOW_S = envInt("K6_LOGIN_ARRIVAL_WINDOW_S", 60);
const LOGIN_TOTAL_DURATION_S = envInt("K6_LOGIN_TOTAL_DURATION_S", 300); // 5 min default run
const LOGIN_PRE_ALLOCATED_VUS = envInt("K6_LOGIN_PRE_ALLOCATED_VUS", 5);
const LOGIN_MAX_VUS = envInt("K6_LOGIN_MAX_VUS", 20);

if (!STUDENT_PASSWORD) {
  throw new Error(
    "[auth-login] K6_STUDENT_PASSWORD is not set. Provision a dedicated load-test " +
      "account pool on the target staging env and pass its shared password via env — " +
      "see infra/k6/README.md 'Provisioning load-test accounts'. Refusing to run with " +
      "no credential rather than silently failing every iteration with 401s.",
  );
}

const login = stepMetrics("login");

export const options = {
  scenarios: {
    auth_login: {
      executor: "constant-arrival-rate",
      rate: LOGIN_ARRIVAL_RATE,
      timeUnit: `${LOGIN_ARRIVAL_WINDOW_S}s`,
      duration: `${LOGIN_TOTAL_DURATION_S}s`,
      preAllocatedVUs: LOGIN_PRE_ALLOCATED_VUS,
      maxVUs: LOGIN_MAX_VUS,
    },
  },
  thresholds: {
    login_duration: writeThresholds(),
    login_errors: errorRateThresholds(),
  },
};

const emails = expandEmailPattern(STUDENT_EMAIL_PATTERN, STUDENT_POOL_SIZE);

export default function () {
  // Round-robin through the pool by global iteration count — models many distinct
  // "returning users" logging back in, rather than one account hammering /auth/login
  // (which would trip the ACCOUNT-keyed limiter too, apps/api/src/modules/auth/lib/
  // login-rate-limiter.ts, independently of the IP-keyed guard this script is designed
  // around).
  const email = emails[exec.scenario.iterationInTest % emails.length];

  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password: STUDENT_PASSWORD }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "auth_login" } },
  );

  recordStep(res, login, {
    "login: status is 200": (r) => r.status === 200,
    "login: sets access_token cookie": (r) => Boolean(r.cookies.access_token && r.cookies.access_token[0]),
    "login: sets csrf_token cookie": (r) => Boolean(r.cookies.csrf_token && r.cookies.csrf_token[0]),
    "login: not rate-limited (429)": (r) => r.status !== 429,
  });

  // Realistic post-login think-time (the user looks at the page they land on) — this
  // does NOT throttle the arrival rate itself (that's the executor's job); it just
  // keeps this VU "busy" for a plausible session-start duration before it's recycled.
  sleep(3 + Math.random() * 5);
}

export const handleSummary = buildHandleSummary("auth-login");
