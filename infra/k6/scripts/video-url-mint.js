// infra/k6/scripts/video-url-mint.js
//
// Journey: signed video-url mint — "the hot per-lesson call" (devops task instructions;
// docs/specs/phase-7-analytics-hardening.md AC-70 journey #2's second half: "...
// video-stream-URL mint → lesson-progress ping").
//
// Hits `GET /api/v1/lessons/:id/stream-url` (apps/api/src/modules/lms/lessons.controller.ts)
// — explicitly documented in that controller as "the sharpest security edge in the LMS"
// and the single most latency-sensitive per-lesson call (mints a short-TTL signed HLS
// URL via VideoProvider on every call, never cached client-side). This script then
// follows with `PUT /api/v1/me/lessons/:id/progress` (the position-ping write) to
// complete the AC-70 journey, since a real player always pings progress shortly after
// starting playback.
//
// Models the PROPOSED "1,000 concurrent video-stream-URL mints" target (AC-70,
// pending sign-off per LOCK-D6). Uses the same small-pool-plus-round-robin pattern as
// lms-dashboard.js (see scripts/lib/session-pool.js) to stay under the auth IP rate
// limit; each VU discovers ONE playable lesson for its assigned session on its first
// iteration (via the enrollments + curriculum reads) and caches it locally, so the
// curriculum lookup itself never pollutes the stream-url-mint latency metric.
//
// Thresholds: stream-url mint is a read (AC-51/71: p95<300ms, p99<450ms); the progress
// ping is a write (p95<800ms, p99<1200ms). Error rate <1% for both (AC-71).

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
import {
  stepMetrics,
  recordStep,
  readThresholds,
  writeThresholds,
  errorRateThresholds,
} from "./lib/metrics.js";
import { buildRampStages, envInt } from "./lib/stages.js";
import { buildHandleSummary } from "./lib/summary.js";

const STUDENT_EMAIL_PATTERN = __ENV.K6_STUDENT_EMAIL_PATTERN || "student.load%03d@stimuliiq.test";
const STUDENT_POOL_SIZE = envInt("K6_STUDENT_POOL_SIZE", 50);
const STUDENT_PASSWORD = __ENV.K6_STUDENT_PASSWORD;

// PROPOSED (AC-70, LOCK-D6): 1,000 concurrent video-stream-URL mints.
const TARGET_VUS = envInt("K6_VIDEO_MINT_VUS", 1000);

if (!STUDENT_PASSWORD) {
  throw new Error(
    "[video-url-mint] K6_STUDENT_PASSWORD is not set — see infra/k6/README.md " +
      "'Provisioning load-test accounts'.",
  );
}

const streamUrlMint = stepMetrics("stream_url_mint");
const progressPing = stepMetrics("progress_ping");
const lessonDiscovery = stepMetrics("lesson_discovery"); // sanity-only, not threshold-gated

export const options = {
  scenarios: {
    video_url_mint: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildRampStages(TARGET_VUS),
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    stream_url_mint_duration: readThresholds(),
    stream_url_mint_errors: errorRateThresholds(),
    progress_ping_duration: writeThresholds(),
    progress_ping_errors: errorRateThresholds(),
  },
};

export function setup() {
  const emails = expandEmailPattern(STUDENT_EMAIL_PATTERN, STUDENT_POOL_SIZE);
  const sessions = loginPool(emails, STUDENT_PASSWORD);
  return { sessions };
}

// Per-VU lesson cache — module-scope state persists across this VU's iterations but is
// never shared with other VUs (each k6 VU is an isolated JS runtime). Populated lazily
// on the VU's first iteration.
let cachedLesson = null;

function discoverPlayableLesson(session) {
  const enrollmentsRes = http.get(
    `${BASE_URL}/api/v1/me/enrollments`,
    authParams(session, { tags: { name: "lesson_discovery_enrollments" } }),
  );
  recordStep(enrollmentsRes, lessonDiscovery, {
    "discovery: enrollments status 200": (r) => r.status === 200,
  });
  if (enrollmentsRes.status !== 200) return null;

  let enrollmentId;
  try {
    const items = JSON.parse(enrollmentsRes.body).data;
    enrollmentId = Array.isArray(items) && items.length > 0 ? items[0].enrollmentId : undefined;
  } catch {
    return null;
  }
  if (!enrollmentId) return null;

  const curriculumRes = http.get(
    `${BASE_URL}/api/v1/me/enrollments/${enrollmentId}/curriculum`,
    authParams(session, { tags: { name: "lesson_discovery_curriculum" } }),
  );
  recordStep(curriculumRes, lessonDiscovery, {
    "discovery: curriculum status 200": (r) => r.status === 200,
  });
  if (curriculumRes.status !== 200) return null;

  try {
    const curriculum = JSON.parse(curriculumRes.body).data;
    for (const module of curriculum.modules ?? []) {
      for (const lesson of module.lessons ?? []) {
        if (lesson.hasVideo && !lesson.locked) {
          return lesson.id;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export default function (data) {
  const session = pickSession(data.sessions, exec.vu.idInTest);
  ensureFreshSession(session);

  if (!cachedLesson) {
    cachedLesson = discoverPlayableLesson(session);
    if (!cachedLesson) {
      // Fail loud but scoped to this VU only — one under-seeded test account must not
      // silently under-report load; it must visibly show up as a setup/data problem to
      // fix (see infra/k6/README.md "Provisioning load-test accounts": every pool
      // account needs at least one active enrollment with a ready video lesson).
      throw new Error(
        `[video-url-mint] VU ${exec.vu.idInTest} (session ${session.email}) has no ` +
          "enrolled, ready, unlocked video lesson to mint a stream-url for. Seed this " +
          "account with an active enrollment + a ready video lesson before running.",
      );
    }
  }

  const mintRes = http.get(
    `${BASE_URL}/api/v1/lessons/${cachedLesson}/stream-url`,
    authParams(session, { tags: { name: "stream_url_mint" } }),
  );
  const minted = recordStep(mintRes, streamUrlMint, {
    "stream-url: status is 200": (r) => r.status === 200,
    "stream-url: returns a signed url": (r) => {
      try {
        const body = JSON.parse(r.body).data;
        return typeof body?.url === "string" && body.url.length > 0;
      } catch {
        return false;
      }
    },
    "stream-url: never leaks provider_asset_id": (r) => !r.body.includes("provider_asset_id"),
  });

  // Simulate a short viewing interval before the player pings progress (real players
  // ping on a throttled onTimeUpdate interval, every 5-10s — this models one ping, not
  // the full watch session, matching the AC-70 journey's granularity).
  sleep(2 + Math.random() * 4);

  if (minted) {
    const positionS = Math.floor(10 + Math.random() * 300);
    const pingRes = http.put(
      `${BASE_URL}/api/v1/me/lessons/${cachedLesson}/progress`,
      JSON.stringify({ lastPositionS: positionS }),
      authWriteParams(session, {
        headers: { "Content-Type": "application/json" },
        tags: { name: "progress_ping" },
      }),
    );
    recordStep(pingRes, progressPing, {
      "progress ping: status is 200": (r) => r.status === 200,
    });
  }

  sleep(3 + Math.random() * 5);
}

export const handleSummary = buildHandleSummary("video-url-mint");
