// apps/api/src/observability/logger.ts
//
// pino structured logging config (CLAUDE.md §1, docs/04-trd-architecture.md §2.13).
// FULLY WORKING in Phase 0 — no extra config needed locally. Request id / tenant / user
// are attached per-request once the auth + tenancy context lands; the hooks are wired
// here so backend-builder only needs to populate them.
//
// Phase 7 WS-C (docs/plans/phase-7.md task #9) extends the Phase-0 baseline with:
//   - `REDACT_PATHS` — a single, TESTED redaction list (Rule H-4/AC-47) covering the
//     transport-layer secrets (auth header, cookies, CSRF header) pino's own `redact`
//     option can target by fixed path. Provider API keys/JWTs/password hashes are never
//     logged as a matter of code discipline — they never flow through a fixed,
//     predictable object path the way request headers do, so no `redact` path can cover
//     them structurally; this list covers what CAN be.
//   - PII masking (Rule H-4/AC-48): `hooks.logMethod` masks email/phone patterns in any
//     plain-string log argument (message text / interpolation args); `formatters.log`
//     masks them inside the merging object's fields (bounded depth, skips
//     req/res/err/error/stack — see observability/pii-mask.ts for the shared helper).
//   - correlation id: `genReqId` reuses `resolveRequestId()` — the SAME id
//     `correlationIdMiddleware` already stamped onto `req.id` and the response header,
//     so the log line, the response header, and the RFC-7807 `traceId` are never three
//     different uuids for one request (AC-44).

import type { Params } from "nestjs-pino";
import { resolveRequestId } from "./request-id";
import { maskPiiDeep, maskPiiString } from "./pii-mask";

/**
 * Rule H-4 / AC-47: transport-layer secrets pino can redact by FIXED path. Kept as a
 * named export so a unit test can assert this list actually contains the required
 * entries (see logger.spec.ts) rather than relying on reading the config by eye.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "res.headers['set-cookie']",
];

export const loggerModuleOptions: Params = {
  pinoHttp: {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: {
              colorize: true,
              singleLine: true,
              translateTime: "SYS:HH:MM:ss",
            },
          },
    redact: {
      paths: REDACT_PATHS,
      remove: true,
    },
    genReqId: (req) => resolveRequestId(req),
    // Rule H-4/AC-48: masks any plain-string log argument (the message text itself, and
    // any %s-style interpolation args) — covers `logger.log(\`OTP sent to ${phone}\`)`
    // style calls that a fixed `redact` path can never reach.
    hooks: {
      logMethod(inputArgs, method) {
        const maskedArgs = inputArgs.map((arg) => (typeof arg === "string" ? maskPiiString(arg) : arg));
        (method as (...args: unknown[]) => void).apply(this, maskedArgs);
      },
    },
    // Rule H-4/AC-48: masks any email/phone-shaped string found in the merging object's
    // OWN fields (bounded depth, skips req/res/err — see pii-mask.ts) — covers
    // `logger.log({ email: student.email })` style calls.
    formatters: {
      log: (obj: Record<string, unknown>) => maskPiiDeep(obj),
    },
    // `req.user` is populated by AuditContextMiddleware/JwtAuthGuard (see
    // apps/api/src/modules/auth/lib/request-user.ts) — it carries `tenantId` directly on
    // the user object (no separate `req.tenant`), so both ids are surfaced from there.
    // Neither field is PII (both are opaque ids), so no masking is needed here.
    customProps: (req) => {
      const request = req as typeof req & {
        user?: { id?: string; tenantId?: string };
      };
      return {
        tenantId: request.user?.tenantId,
        userId: request.user?.id,
      };
    },
  },
};
