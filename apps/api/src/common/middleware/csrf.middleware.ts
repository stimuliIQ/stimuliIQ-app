// apps/api/src/common/middleware/csrf.middleware.ts
//
// Double-submit CSRF protection (LOCKED transport decision, docs/04-trd-architecture.md
// §2.3). For every unsafe method (POST/PUT/PATCH/DELETE) that already carries an
// `access_token` or `refresh_token` cookie, the `X-CSRF-Token` request header must match
// the `csrf_token` cookie value. Login/otp/request/otp/verify are exempt (no cookies
// exist yet on first contact — those routes are the entry point that *sets* the CSRF
// cookie in the first place); refresh/logout and any future authenticated mutation must
// pass this check.

import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { csrfCookieCandidates, readAudienceHeader } from "../../modules/auth/lib/cookies";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Constant-time string comparison (Wave 6 security audit M-3). A plain `!==` compare
 * short-circuits on the first differing byte, which leaks (via response timing) how
 * many leading characters of the guess matched the real cookie value — a classic
 * timing side-channel. `timingSafeEqual` requires equal-length buffers (it throws
 * otherwise), so we length-check first and return `false` directly rather than letting
 * that throw escape as an unhandled error; an unequal length is itself proof the values
 * don't match, so no information is lost by short-circuiting on length.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Routes that establish a NEW session (no CSRF cookie exists yet) are exempt.
const CSRF_EXEMPT_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/otp/request",
  "/api/v1/auth/otp/verify",
]);

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // `req.path` is relative to wherever Express mounted this middleware — since Nest's
    // global prefix ("api/v1", see main.ts) is implemented via an internal mount, `req.path`
    // here is "/" for e.g. POST /api/v1/auth/login, NOT the full path. `req.originalUrl`
    // always retains the full incoming path regardless of mount depth, so we match on
    // that (stripped of any query string) instead.
    const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
    if (!UNSAFE_METHODS.has(req.method) || CSRF_EXEMPT_PATHS.has(path)) {
      return next();
    }

    // Audience-scoped session slots (cookies.ts header): an app that declares itself
    // via X-App-Audience is checked against ITS OWN csrf cookie only; header-less
    // callers fall back across legacy → lms → crm slots. Matching any of this
    // origin's own csrf cookies is an equally strong double-submit proof — the
    // requester demonstrably reads our cookies.
    const candidates = csrfCookieCandidates(
      req.cookies as Record<string, string> | undefined,
      readAudienceHeader(req),
    );
    const headerToken = req.header("X-CSRF-Token");

    const matches =
      Boolean(headerToken) && candidates.some((cookieToken) => timingSafeStringEqual(cookieToken, headerToken as string));

    if (!matches) {
      throw new UnauthorizedException({
        code: "auth.csrf_mismatch",
        title: "CSRF token missing or invalid",
        detail: "X-CSRF-Token header must match the csrf_token cookie on unsafe requests.",
      });
    }

    next();
  }
}
