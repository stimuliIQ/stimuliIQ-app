// apps/api/src/modules/auth/lib/cookies.ts
//
// Cookie helpers for the LOCKED transport decision: httpOnly access_token +
// refresh_token cookies, non-httpOnly csrf_token cookie (double-submit), no tokens
// ever in a JSON body (docs/04-trd-architecture.md §2.3, packages/types auth.schemas.ts
// file header). Centralized here so login/refresh/otp-verify/logout never hand-roll
// cookie options independently and drift.
//
// AUDIENCE-SCOPED SESSION SLOTS (dual-login fix):
//   All three first-party apps talk to the SAME API origin, so a single cookie set
//   meant a CRM login overwrote/shared the LMS session in the same browser (and
//   vice-versa). Sessions are now stored in per-app cookie SLOTS:
//     lms → lms_access_token / lms_refresh_token / lms_csrf_token
//     crm → crm_access_token / crm_refresh_token / crm_csrf_token
//   Login/otp-verify/2FA-verify choose the slot from the request body's `audience`
//   (already hard-coded per app — auth.schemas.ts AppAudienceSchema). Subsequent
//   requests declare their app via the `X-App-Audience` header (set by
//   @repo/api-client when constructed with `appAudience`), and the server reads
//   ONLY that slot. Header-less callers (tests, curl, server-to-server) fall back
//   to the legacy unprefixed names first, then lms, then crm — preserving the old
//   single-session behavior for them.

import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { validateEnv } from "../../../config/env";
import type { AppAudience } from "@repo/types";

// Legacy (unprefixed) names — still used by header-less callers and as the slot
// for logins that omit `audience`.
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
export const CSRF_TOKEN_COOKIE = "csrf_token";

/** The custom request header each frontend sends to declare its app slot. */
export const APP_AUDIENCE_HEADER = "x-app-audience";

export interface CookieNames {
  access: string;
  refresh: string;
  csrf: string;
}

/** Cookie names for a session slot. No audience = the legacy unprefixed slot. */
export function cookieNames(audience?: AppAudience): CookieNames {
  if (!audience) {
    return { access: ACCESS_TOKEN_COOKIE, refresh: REFRESH_TOKEN_COOKIE, csrf: CSRF_TOKEN_COOKIE };
  }
  return {
    access: `${audience}_${ACCESS_TOKEN_COOKIE}`,
    refresh: `${audience}_${REFRESH_TOKEN_COOKIE}`,
    csrf: `${audience}_${CSRF_TOKEN_COOKIE}`,
  };
}

/**
 * Reads the `X-App-Audience` header. Returns undefined for absent/unknown values
 * (unknown values are treated as "no app declared", never an error — the header is
 * a slot selector, not an auth claim; RBAC still gates every endpoint).
 */
export function readAudienceHeader(req: Request): AppAudience | undefined {
  // Read `req.headers` directly (Express lowercases keys there) rather than
  // `req.header()` — also keeps this safe for bare `{ cookies, headers }` request
  // mocks in unit tests that don't implement Express's helper methods.
  const rawValue = req.headers?.[APP_AUDIENCE_HEADER];
  const raw = (Array.isArray(rawValue) ? rawValue[0] : rawValue)?.toLowerCase();
  return raw === "lms" || raw === "crm" ? raw : undefined;
}

/**
 * Slot fallback order for header-less callers: legacy first (pre-slot sessions and
 * audience-less test logins), then lms, then crm.
 */
const FALLBACK_SLOTS: Array<AppAudience | undefined> = [undefined, "lms", "crm"];

/**
 * Access-token candidates to try verifying, in order. With a declared audience the
 * app's own slot is authoritative — no fallback (a CRM tab must never silently ride
 * an LMS session).
 */
export function accessTokenCandidates(
  cookies: Record<string, string> | undefined,
  audience?: AppAudience,
): string[] {
  if (!cookies) return [];
  const slots = audience ? [audience] : FALLBACK_SLOTS;
  return slots
    .map((slot) => cookies[cookieNames(slot).access])
    .filter((token): token is string => Boolean(token));
}

/**
 * Resolves the refresh token for this request, returning the slot it came from so
 * refresh/logout can re-set/clear the SAME slot they read.
 */
export function resolveRefreshTokenCookie(
  cookies: Record<string, string> | undefined,
  audience?: AppAudience,
): { token: string | undefined; audience: AppAudience | undefined } {
  if (!cookies) return { token: undefined, audience };
  const slots = audience ? [audience] : FALLBACK_SLOTS;
  for (const slot of slots) {
    const token = cookies[cookieNames(slot).refresh];
    if (token) return { token, audience: slot };
  }
  return { token: undefined, audience };
}

/** CSRF cookie candidates for the double-submit check, same slot rules as above. */
export function csrfCookieCandidates(
  cookies: Record<string, string> | undefined,
  audience?: AppAudience,
): string[] {
  if (!cookies) return [];
  const slots = audience ? [audience] : FALLBACK_SLOTS;
  return slots
    .map((slot) => cookies[cookieNames(slot).csrf])
    .filter((token): token is string => Boolean(token));
}

function baseCookieOptions() {
  const env = validateEnv();
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
    path: "/",
  };
}

function ttlToMaxAgeMs(ttl: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 1000);
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Sets access, refresh (both httpOnly), and csrf (NOT httpOnly) cookies in the
 * given audience's slot (legacy unprefixed slot when audience is omitted).
 */
export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
  audience?: AppAudience,
): void {
  const env = validateEnv();
  const base = baseCookieOptions();
  const names = cookieNames(audience);

  res.cookie(names.access, tokens.accessToken, {
    ...base,
    maxAge: ttlToMaxAgeMs(env.JWT_ACCESS_TTL),
  });
  res.cookie(names.refresh, tokens.refreshToken, {
    ...base,
    maxAge: ttlToMaxAgeMs(env.JWT_REFRESH_TTL),
  });
  res.cookie(names.csrf, tokens.csrfToken, {
    ...base,
    httpOnly: false, // double-submit: frontend JS must be able to read this one.
    maxAge: ttlToMaxAgeMs(env.JWT_REFRESH_TTL),
  });
}

/**
 * Clears the given audience's cookie slot. Always ALSO clears the legacy
 * unprefixed slot — pre-slot sessions linger there and would otherwise survive
 * a logout issued by an app that now uses a prefixed slot.
 */
export function clearAuthCookies(res: Response, audience?: AppAudience): void {
  const base = baseCookieOptions();
  const slots: Array<AppAudience | undefined> = audience ? [audience, undefined] : [undefined];
  for (const slot of slots) {
    const names = cookieNames(slot);
    res.clearCookie(names.access, base);
    res.clearCookie(names.refresh, base);
    res.clearCookie(names.csrf, { ...base, httpOnly: false });
  }
}
