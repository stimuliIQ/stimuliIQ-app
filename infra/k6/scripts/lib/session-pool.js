// infra/k6/scripts/lib/session-pool.js
//
// Shared setup()-phase login pool for the Phase-7 Wave-4 k6 suite (docs/plans/phase-7.md
// task #17). Read infra/k6/README.md "Auth journey & the per-IP rate limiter" before
// touching this file — it exists specifically to avoid tripping
// `AuthIpRateLimitGuard` (apps/api/src/modules/auth/guards/auth-ip-rate-limit.guard.ts,
// AC-57), which throttles at `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` (default 20) attempts per
// `AUTH_IP_RATE_LIMIT_WINDOW_SECONDS` (default 60s) PER SOURCE IP + PER HANDLER.
//
// DESIGN: every scenario that needs an authenticated session (dashboard, stream-url
// mint, notifications, analytics) logs in a SMALL pool of accounts ONCE in `setup()`
// (which runs on a single VU — i.e. one source IP), then every simulated VU round-robins
// across that pool's session cookies for the rest of the run. This is realistic (a real
// student logs in once per session, not once per page view) AND is the only way to
// reach thousands of concurrent VUs without each one calling `POST /auth/login`
// independently, which would appear to the API as a single IP attempting far more than
// `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` logins/minute and would 429 almost immediately.
//
// Session reuse across many concurrent VUs is safe: `access_token` is a stateless JWT
// (docs/04 §2.3) — the server does not track "one session per token" concurrency, so
// many parallel requests bearing the same cookie value are indistinguishable from one
// browser tab making many rapid requests. Only `refresh_token` is single-use/rotating;
// this module never shares a refresh in-flight from two VUs at once (each VU's
// `ensureFreshSession` call is local to that VU's own copy of the session object — see
// note below on structural cloning across setup()->VU handoff).

import http from "k6/http";
import { sleep } from "k6";
import { BASE_URL } from "../../config.js";

const LOGIN_URL = `${BASE_URL}/api/v1/auth/login`;
const REFRESH_URL = `${BASE_URL}/api/v1/auth/refresh`;

// JWT_ACCESS_TTL default is 15 minutes (apps/api/src/config/env.ts). Refresh a session
// proactively once it's older than this, leaving a safety margin so a long "sustained
// peak" stage (docs/specs/phase-7-analytics-hardening.md AC-70) never rides an expired
// access token into a wall of spurious 401s.
export const SESSION_REFRESH_AFTER_MS = 10 * 60 * 1000; // 10 min (5 min margin under the 15 min TTL)

/**
 * @typedef {{
 *   email: string,
 *   accessToken: string,
 *   refreshToken: string,
 *   csrfToken: string,
 *   cookieHeader: string,
 *   loggedInAt: number,
 * }} Session
 */

function cookieHeaderOf(accessToken, refreshToken, csrfToken) {
  return `access_token=${accessToken}; refresh_token=${refreshToken}; csrf_token=${csrfToken}`;
}

function extractCookie(res, name) {
  const jar = res.cookies && res.cookies[name];
  return jar && jar[0] ? jar[0].value : undefined;
}

/**
 * Logs in `emails.length` accounts sequentially, pacing requests in batches so the
 * total attempt rate against `POST /auth/login` from this (single, setup()-phase)
 * source IP stays comfortably under `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS` per
 * `AUTH_IP_RATE_LIMIT_WINDOW_SECONDS`. Defaults (12 per 65s) sit ~40% under the API's
 * default budget (20 per 60s) to leave headroom for the auth-login.js scenario or any
 * other traffic sharing the same egress IP during the same staging run.
 *
 * Throws loudly on any login failure — a partially-broken pool would otherwise
 * silently under-represent load or mask 401s as "real" traffic failures later in the
 * run, which would corrupt the AC-71 error-rate result.
 *
 * @param {string[]} emails
 * @param {string} password Shared password for every account in the pool. MUST come
 *   from an env var at the call site (see auth-login.js et al.) — never hardcode a
 *   credential in this file.
 * @param {{ batchSize?: number, batchPauseSeconds?: number }} [opts]
 * @returns {Session[]}
 */
export function loginPool(emails, password, opts = {}) {
  const batchSize = opts.batchSize ?? 12;
  const batchPauseSeconds = opts.batchPauseSeconds ?? 65;
  /** @type {Session[]} */
  const sessions = [];

  emails.forEach((email, index) => {
    if (index > 0 && index % batchSize === 0) {
      sleep(batchPauseSeconds);
    }

    const res = http.post(LOGIN_URL, JSON.stringify({ email, password }), {
      headers: { "Content-Type": "application/json" },
      tags: { name: "auth_login_setup" },
    });

    if (res.status !== 200) {
      throw new Error(
        `[session-pool] login failed for "${email}": HTTP ${res.status} — ${res.body}. ` +
          "Verify the load-test account pool is provisioned on the target staging env " +
          "(see infra/k6/README.md 'Provisioning load-test accounts') before re-running.",
      );
    }

    const accessToken = extractCookie(res, "access_token");
    const refreshToken = extractCookie(res, "refresh_token");
    const csrfToken = extractCookie(res, "csrf_token");
    if (!accessToken || !refreshToken || !csrfToken) {
      throw new Error(
        `[session-pool] login for "${email}" returned 200 but did not set the expected ` +
          "access_token/refresh_token/csrf_token cookies — check API cookie config.",
      );
    }

    sessions.push({
      email,
      accessToken,
      refreshToken,
      csrfToken,
      cookieHeader: cookieHeaderOf(accessToken, refreshToken, csrfToken),
      loggedInAt: Date.now(),
    });
  });

  return sessions;
}

/**
 * Deterministically assigns a VU to one pool session (round-robin by VU id), so pool
 * size can be MUCH smaller than the target VU count (sessions are stateless bearer
 * cookies, safe to share across many concurrent VUs — see file header).
 *
 * @param {Session[]} sessions
 * @param {number} vuId
 * @returns {Session}
 */
export function pickSession(sessions, vuId) {
  if (!sessions || sessions.length === 0) {
    throw new Error(
      "[session-pool] session pool is empty — did setup() run and return { sessions }?",
    );
  }
  return sessions[(vuId - 1) % sessions.length];
}

/**
 * Refreshes a session's access token in place if it's older than
 * `SESSION_REFRESH_AFTER_MS`. Call this at the top of every iteration in scenarios
 * whose sustained-peak window may run longer than the access-token TTL. `/auth/refresh`
 * is NOT behind the auth IP rate limiter (see auth-ip-rate-limit.guard.ts file header),
 * so this is safe to call from many VUs without budget concerns — but it DOES rotate the
 * refresh token, so this must only ever be called against a single VU's own local copy
 * of a session object (never share one live `Session` object across concurrent VUs).
 *
 * @param {Session} session Mutated in place on success.
 * @returns {boolean} true if refreshed, false if not due yet or the refresh failed
 *   (caller should treat a failed refresh as "let the next mint/read call surface the
 *   401 naturally" rather than crash the iteration).
 */
export function ensureFreshSession(session) {
  if (Date.now() - session.loggedInAt < SESSION_REFRESH_AFTER_MS) {
    return false;
  }

  const res = http.post(REFRESH_URL, null, {
    headers: { Cookie: session.cookieHeader },
    tags: { name: "auth_refresh" },
  });

  if (res.status !== 200) {
    return false;
  }

  const accessToken = extractCookie(res, "access_token") ?? session.accessToken;
  const refreshToken = extractCookie(res, "refresh_token") ?? session.refreshToken;
  const csrfToken = extractCookie(res, "csrf_token") ?? session.csrfToken;
  session.accessToken = accessToken;
  session.refreshToken = refreshToken;
  session.csrfToken = csrfToken;
  session.cookieHeader = cookieHeaderOf(accessToken, refreshToken, csrfToken);
  session.loggedInAt = Date.now();
  return true;
}

/** Builds request params carrying a session's Cookie (+ CSRF header for unsafe methods). */
export function authParams(session, extra = {}) {
  return {
    headers: {
      Cookie: session.cookieHeader,
      ...(extra.headers ?? {}),
    },
    tags: extra.tags,
  };
}

/** Same as `authParams` but also sets `X-CSRF-Token` — use for POST/PUT/PATCH/DELETE. */
export function authWriteParams(session, extra = {}) {
  return authParams(session, {
    ...extra,
    headers: { "X-CSRF-Token": session.csrfToken, ...(extra.headers ?? {}) },
  });
}

/**
 * Expands an env-configurable `pattern` (containing exactly one `%d` placeholder) into
 * `count` sequential emails, e.g. `expandEmailPattern("student.load%03d@x.test", 3)` →
 * `["student.load001@x.test", "student.load002@x.test", "student.load003@x.test"]`.
 * Supports zero-padding width via the printf-style `%0Nd` form; falls back to plain
 * decimal if no width is specified.
 *
 * @param {string} pattern
 * @param {number} count
 * @returns {string[]}
 */
export function expandEmailPattern(pattern, count) {
  const match = /%0?(\d*)d/.exec(pattern);
  if (!match) {
    throw new Error(`[session-pool] email pattern "${pattern}" must contain a %d or %0Nd placeholder.`);
  }
  const width = match[1] ? Number(match[1]) : 0;
  const emails = [];
  for (let i = 1; i <= count; i += 1) {
    const num = width > 0 ? String(i).padStart(width, "0") : String(i);
    emails.push(pattern.replace(match[0], num));
  }
  return emails;
}
