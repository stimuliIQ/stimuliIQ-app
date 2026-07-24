// apps/api/src/modules/metrics/metrics-auth.guard.ts
//
// Protects GET /metrics with a static bearer token (METRICS_TOKEN) rather than the
// user RBAC/session stack — Prometheus scrapers have no browser session/cookie, and
// this is an infra/ops surface, not a product permission (docs/plans/phase-7.md task
// #9: "Protect it (internal-only / a metrics token / not publicly enumerable)").
//
// FAILS CLOSED in staging/production when METRICS_TOKEN is unset — mirrors the
// CAPTCHA_SECRET_KEY / MAIL_PROVIDER fail-closed-in-prod pattern already used elsewhere
// in this codebase (config/env.ts) — so the endpoint is never publicly reachable by
// accident once deployed. Dev/test (no token configured, APP_ENV=local) stays open so
// qa-engineer/local dev can scrape it with zero extra setup.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { validateEnv } from "../../config/env";

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const env = validateEnv();
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.header("X-Metrics-Token");

    if (!env.METRICS_TOKEN) {
      if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
        throw new ForbiddenException({
          code: "metrics.not_configured",
          title: "Metrics endpoint not configured",
          detail: "METRICS_TOKEN must be set before /metrics is reachable in this environment.",
        });
      }
      return true;
    }

    if (!token || !timingSafeStringEqual(token, env.METRICS_TOKEN)) {
      throw new ForbiddenException({
        code: "metrics.forbidden",
        title: "Forbidden",
        detail: "A valid X-Metrics-Token header is required.",
      });
    }

    return true;
  }
}
