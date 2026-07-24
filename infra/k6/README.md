# k6 load testing (Phase-7 Wave 4)

`infra/k6/config.js` (devops-owned target plumbing, `docs/plans/phase-7.md` task #16) +
the scripts under `infra/k6/scripts/` (qa-engineer-owned, task #17) together implement
the load-test suite modeling `docs/specs/phase-7-analytics-hardening.md` WS-F toward the
100k-concurrent-student target. Every script imports `BASE_URL`/`RUN_TAG` from
`config.js` — nothing in `scripts/` reads `__ENV.K6_BASE_URL` directly.

## Scripts (`infra/k6/scripts/`)

| Script | Journey | Auth | PROPOSED peak VUs (env override) |
|---|---|---|---|
| `auth-login.js` | Password login — new-session arrival rate, NOT a VU ramp (see below) | none (this IS the login) | `constant-arrival-rate`: 10 logins/60s (`K6_LOGIN_ARRIVAL_RATE`/`K6_LOGIN_ARRIVAL_WINDOW_S`) |
| `lms-dashboard.js` | Student dashboard + My Courses read | pre-authed pool | 10,000 (`K6_LMS_DASHBOARD_VUS`) |
| `video-url-mint.js` | Signed video-url mint → progress ping | pre-authed pool | 1,000 (`K6_VIDEO_MINT_VUS`) |
| `public-funnel.js` | Anonymous program list → detail (SEO/marketing) | none | 1,000 (`K6_PUBLIC_FUNNEL_VUS`, suite default — not an AC-70 number) |
| `notifications.js` | Notification list (SSE-poll fallback) + occasional mark-read | pre-authed pool | 2,000 (`K6_NOTIFICATIONS_VUS`, suite default — not an AC-70 number) |
| `analytics-dashboard.js` | CRM staff revenue/enrollment/funnel/attendance dashboard reads | pre-authed pool | 100 (`K6_ANALYTICS_VUS`) |

All numeric concurrency targets are **PROPOSED** (`docs/specs/phase-7-analytics-hardening.md`
LOCK-D6) — sourced from `docs/00-product-strategy.md §7` (10k concurrent learners / 1k
concurrent streams / 100 concurrent CRM staff) and pending explicit user sign-off. Where
AC-70 gives no explicit number (public funnel, notifications), the default is a suite-authored
sizing choice, clearly commented as such in the script — tune freely via its env var.

**Never load-tests**: `POST /public/leads`, `POST /public/register`, or any
`POST /public/enroll/*` (no Razorpay TEST charge path is exercised — AC-73), and no
scenario logs in once-per-VU (see "Auth journey & the per-IP rate limiter" below).

## Non-negotiable rules

1. **k6 runs against a dedicated STAGING environment only.** Never CI, never
   production, never a developer's localhost API. `infra/k6/config.js` enforces this
   at import time — an unset or disallowed `K6_BASE_URL` throws immediately.
2. **k6 is never wired into `.github/workflows/ci.yml`.** There is no `k6` CI job and
   there must never be one — load tests are triggered manually (or via a separate,
   opt-in scheduled workflow if a human decides to add one later), against staging.
3. **The payment journey (AC-73) exclusively uses Razorpay TEST mode.** This is
   enforced by the STAGING environment's own Razorpay key configuration
   (`rzp_test_*`), independent of this scaffolding — never point a load test at an
   environment configured with live Razorpay keys.
4. **Notification channels use test-mode/Noop providers during the load test**
   (edge-case table, WS-F) — no real email/SMS/WhatsApp volume goes to real
   recipients. This is a staging-environment configuration concern, not something
   the k6 scripts themselves can enforce — confirm the staging env's
   `MAIL_PROVIDER`/`WHATSAPP_PROVIDER`/MSG91 config before running a large ramp.

## How to run (against a real staging environment)

```bash
# Install the k6 binary (pre-approved, docs/plans/phase-7.md Decision 8) — NOT an npm
# dependency, a standalone CLI. See https://k6.io/docs/get-started/installation/
#   macOS:   brew install k6
#   Linux:   see k6's apt/yum repo instructions
#   Windows: choco install k6  (or winget install k6 --id GrafanaLabs.k6)

# Point at the dedicated staging origin — REQUIRED, no default:
export K6_BASE_URL=https://staging-api.stimuliiq.com

# Optional — tag the run for archiving (AC-74); prefer the git commit SHA:
export K6_RUN_TAG=$(git rev-parse --short HEAD)

# Credentials for the load-test account pools — see "Provisioning load-test accounts"
# below. REQUIRED for every script except public-funnel.js (fully anonymous).
export K6_STUDENT_PASSWORD='...'   # lms-dashboard.js, video-url-mint.js, notifications.js, auth-login.js
export K6_STAFF_PASSWORD='...'     # analytics-dashboard.js

k6 run infra/k6/scripts/<script>.js
```

If `K6_BASE_URL` is unset, points at `localhost`/`127.0.0.1`, or matches a known
production hostname, `infra/k6/config.js` throws before any request is made.

Run one script at a time unless staging is sized for the combined load — each script is
independently a full ramp-to-peak-and-back profile.

## Auth journey & the per-IP rate limiter

`POST /auth/login` is behind `AuthIpRateLimitGuard`
(`apps/api/src/modules/auth/guards/auth-ip-rate-limit.guard.ts`, AC-57): a **fail-closed**
fixed window of `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` (default **20**) attempts per
`AUTH_IP_RATE_LIMIT_WINDOW_SECONDS` (default **60s**), keyed by **source IP + handler**.
A single k6 load-generator host (or a single staging egress NAT) is ONE source IP no
matter how many VUs it runs — so this suite is deliberately built around two rules:

1. **`auth-login.js` is the only script that calls `/auth/login` repeatedly**, and it uses
   a `constant-arrival-rate` executor at **10 logins/60s by default** — half the API's
   default budget, modeling the realistic rate of *new* session starts (not "10,000 users
   click login simultaneously", which nothing in the real system needs to support: real
   users log in once and stay logged in for their session).
2. **Every other script (`lms-dashboard.js`, `video-url-mint.js`, `notifications.js`,
   `analytics-dashboard.js`) logs in a SMALL pool of accounts exactly ONCE, in `setup()`**
   (`scripts/lib/session-pool.js`), then thousands of simulated VUs round-robin across
   that pool's session cookies for the rest of the run. This is realistic (one login per
   session) and is the only way to reach thousands of concurrent VUs without each one
   independently calling `/auth/login` and 429-ing the whole run. Reusing one JWT across
   many concurrent VUs is safe: `access_token` is a stateless JWT with no server-side
   single-session enforcement (only the rotating `refresh_token` is single-use, and each
   VU only ever refreshes its own local copy of the session object — see
   `ensureFreshSession()`).
3. `setup()`'s own login calls are paced (`loginPool()` defaults to 12 logins per 65s
   batch) to stay under the same per-IP budget, since `setup()` itself runs on one VU/one
   IP. A default pool of 50 student accounts therefore takes a few minutes to log in
   before the ramp begins — this is expected, not a bug; watch the console for the
   `[session-pool]` progress as it happens.
4. Access tokens expire after `JWT_ACCESS_TTL` (default 15 min). `ensureFreshSession()`
   proactively calls `/auth/refresh` (NOT behind the IP rate limiter) once a session is
   older than 10 minutes, so a sustained-peak window longer than the token TTL doesn't
   collapse into a wall of 401s partway through.

**If you specifically need to validate raw login throughput above the default per-IP
budget** (a narrower test than "model the 100k-concurrent-student target"), that requires
either (a) running from multiple distinct source IPs (k6 Cloud / multiple distributed
load-generator hosts), or (b) coordinating a temporarily-raised
`AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` on the **staging env only** (never production) with
whoever owns that config — per the WS-F edge-case table, any such bypass "must not exist
in the production build." This suite does not implement or need either option by default.

## Provisioning load-test accounts

Nothing in `infra/k6/scripts/` hardcodes a credential — every script reads a shared pool
password from an env var and derives its pool of emails from a configurable numbered
pattern (`expandEmailPattern()` in `scripts/lib/session-pool.js`), so the SAME scripts
work against any staging env once it has matching accounts provisioned:

| Env var | Default | Used by |
|---|---|---|
| `K6_STUDENT_EMAIL_PATTERN` | `student.load%03d@stimuliiq.test` | auth-login, lms-dashboard, video-url-mint, notifications |
| `K6_STUDENT_POOL_SIZE` | `50` | same |
| `K6_STUDENT_PASSWORD` | *(required, no default)* | same |
| `K6_STAFF_EMAIL_PATTERN` | `staff.load%02d@stimuliiq.test` | analytics-dashboard |
| `K6_STAFF_POOL_SIZE` | `10` | analytics-dashboard |
| `K6_STAFF_PASSWORD` | *(required, no default)* | analytics-dashboard |

Before running, staging needs:
- `K6_STUDENT_POOL_SIZE` student accounts matching the email pattern, each with **an
  active enrollment containing at least one ready (`videos.status == "ready"`),
  unlocked video lesson** — `video-url-mint.js` fails loudly (by design) on the first VU
  that can't find one, rather than silently under-representing load.
- `K6_STAFF_POOL_SIZE` staff accounts matching the staff email pattern holding
  `reports.revenue.view` / `reports.enrollment.view` / `reports.funnel.view` /
  `reports.attendance.view` at **`all` scope** (Admin/Owner/Finance-equivalent) to
  exercise the no-filter tenant-wide aggregate path (AC-16). Branch/own/assigned-scoped
  accounts also work (they just exercise the narrower scope, still a valid load shape).
- If staging is seeded via `prisma/seed.ts`'s deterministic non-admin pattern
  (`password = "seed-" + email`, see the seed file's `createSeedPerson` helper), that
  password can be reused for a throwaway seeded staging env — but treat this as a
  convenience for a disposable environment only, never assume it matches a real staging
  deployment's actual seed run.

## Thresholds / SLOs (all PROPOSED — LOCK-D6, pending explicit user sign-off)

Defined once in `scripts/lib/metrics.js`, restated from
`docs/specs/phase-7-analytics-hardening.md` AC-51/53/71:

| Class | p95 | p99 (1.5× p95, AC-71) | Applies to |
|---|---|---|---|
| Read | < 300ms | < 450ms | dashboard/enrollments/programs/notifications lists, stream-url mint |
| Write | < 800ms | < 1200ms | login, progress ping, mark-read |
| Dashboard aggregate | < 500ms | < 750ms | `/crm/reports/*` (MV/Redis-cache-backed, AC-53) |

Every scenario also asserts **error rate < 1%** (AC-71) via a custom `Rate` metric fed by
`recordStep()` — a request counts as an error whenever its `check()` fails (wrong status,
malformed body, missing expected field), NOT k6's default `http_req_failed` (which only
flags network-level failures unless you configure `expectedStatuses`, and would silently
miss e.g. a 500 with a 2xx Content-Type). A threshold breach fails the `k6 run` exit code.

## Reaching 10k VUs from one machine

`lms-dashboard.js` defaults to a 10,000-VU peak (the AC-70 PROPOSED target). A single k6
process on a single host is commonly practical into the low thousands of VUs depending on
hardware (CPU, open-file-descriptor limits, network egress) — reaching the full 10k
target realistically requires either a beefy dedicated load-generator host or
distributed execution (k6 Cloud, or multiple `k6 run` processes/hosts splitting the VU
count, each pointed at the same `K6_BASE_URL`). For an interim/smoke-scale run against a
smaller staging tier, override `K6_LMS_DASHBOARD_VUS` (and the ramp-duration env vars
below) down to whatever the current staging tier and load-generator host can sustain, and
record the actual test-environment sizing in the results write-up (AC-72's capacity
ceiling is only meaningful alongside the environment spec it was measured on).

Shared ramp-timing env vars (`scripts/lib/stages.js`, all scripts):

| Env var | Default | Meaning |
|---|---|---|
| `K6_RAMP_UP_S` | `120` | seconds to ramp 0 → target VUs |
| `K6_SUSTAIN_S` | `300` | seconds to hold at target VUs (the "sustained peak" AC-70 requires) |
| `K6_RAMP_DOWN_S` | `60` | seconds to ramp back to 0 |

## Smoke-testing a script before a real run

Every script parses/validates independently of any network target — use this to catch
syntax errors, bad imports, or invalid threshold expressions before spending staging
capacity:

```bash
# Set ANY syntactically-valid, non-disallowed URL — config.js only validates the URL
# shape + hostname allowlist at import time; a 1-iteration/1-VU smoke run will get
# connection/DNS errors from a fake host (that's fine and expected — the goal is to
# prove the script's control flow and k6 config are correct, not to reach real data):
K6_BASE_URL=https://staging-smoke.invalid K6_RUN_TAG=smoke \
K6_STUDENT_PASSWORD=smoke-only K6_STAFF_PASSWORD=smoke-only \
  "k6" run --vus 1 --iterations 1 infra/k6/scripts/public-funnel.js
```

For a REAL smoke run that actually reaches a backend, point `K6_BASE_URL` at a genuine
non-production, non-localhost target (e.g. a short-lived preview/staging deployment) and
use `--vus 1 --iterations 1` (or 2-3 iterations) — never against `localhost`:
`config.js` intentionally disallows `localhost`/`127.0.0.1`/`0.0.0.0`/`*.local` as a hard
guard rail against accidentally load-testing (or even smoke-testing) a developer's local
dev API or database — see "Non-negotiable rules" above. This repo's sandboxed dev session
has no reachable staging deployment, so every script in this suite was validated with the
fake-host method above (`k6 run --vus 1 --iterations 1` against `https://staging-smoke.invalid`,
plus a short real-duration run of each `options.scenarios` executor — e.g.
`K6_LOGIN_TOTAL_DURATION_S=2 k6 run infra/k6/scripts/auth-login.js` with no `--vus`/
`--iterations` override, so the `constant-arrival-rate`/`ramping-vus` executor
configuration itself is what actually runs). This confirms every script parses, every
import resolves, `setup()`'s pooling/pacing logic and its fail-loud error path both run
correctly, and every `options.thresholds` expression is syntactically valid k6 config —
each script's threshold intentionally FAILS in this mode (DNS/connection errors against
the fake host), which is expected and itself proves the threshold plumbing works.

## Reading results / finding the capacity ceiling (AC-72)

- Console output is k6's normal `textSummary` (via `scripts/lib/summary.js`) — read the
  per-metric `p(95)`/`p(99)` rows for the step names in the tables above, and the
  `✓`/`✗` next to each threshold.
- A **failing threshold is a failing `k6 run` exit code** — CI-shaped pass/fail, even
  though this never runs in actual CI (see "Non-negotiable rules").
- AC-72 ("documents a capacity ceiling") is informational, not itself a threshold: run
  with `K6_SUSTAIN_S` long enough to cover a slow ramp, then look at the `--out
  json=result.json` time series (`k6 run --out json=result.json ...`) or a connected time-
  series backend (Grafana Cloud k6, InfluxDB) and find the timestamp/VU-count where p95
  first crosses the threshold — that VU count is the ceiling to report, alongside the
  environment spec it was measured against.

## Archiving results (AC-74)

`scripts/lib/summary.js`'s `handleSummary()` writes
`infra/k6/results/<script>-<RUN_TAG>.json` on every run (in addition to the normal
console summary) — tagged with `RUN_TAG` (prefer `K6_RUN_TAG=$(git rev-parse --short
HEAD)`) and a `generatedAt` timestamp, so a future phase's run can be diffed against this
one. `infra/k6/results/` is gitignored (raw run output isn't committed) — a human/CI
archival step decides what's worth keeping in long-term storage (e.g. upload to S3/R2
alongside the environment-spec note from the previous section).

## What a human must provision before this is runnable for real

- A dedicated **staging** environment (API + web + lms + crm + Postgres + Redis)
  separate from both CI and production, sized and documented per AC-72's "capacity
  ceiling" reporting requirement (state the environment's instance size / DB tier /
  replica count alongside any results).
- Staging's Razorpay keys configured in **TEST mode** (`rzp_test_*`) — never live keys.
- Staging's `MAIL_PROVIDER` / `WHATSAPP_PROVIDER` / MSG91 configuration set to
  test-mode/Noop equivalents so a concurrency ramp never sends real messages.
- The actual `K6_BASE_URL` value (staging origin) — set as a local environment
  variable when running k6 by hand; if/when a human decides to automate runs via a
  separate (non-CI) scheduled workflow, `K6_BASE_URL` should be a GitHub Actions
  **environment secret** scoped to a `staging-load-test` environment, never a plain
  repository secret/variable available to every workflow.
