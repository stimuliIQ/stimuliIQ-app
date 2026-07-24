// Health / readiness contracts — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Covers WS-C (Observability, docs/specs/phase-7-analytics-hardening.md):
//   GET /health       (liveness)  — AC-41
//   GET /health/ready (readiness) — AC-42
//
// Both endpoints are PUBLIC, UNAUTHENTICATED, and rate-limited (AC-49) — an
// on-call engineer or load balancer must be able to hit them without a
// session. Rule H-3 (LEAK-SAFE, AC-41/AC-42) is the entire point of this
// file: neither response may EVER contain package versions, stack traces,
// internal hostnames, database connection strings, environment variable
// names/values, uptime/pid, or any other internal implementation detail —
// ONLY a per-dependency boolean/status label. This is enforced structurally:
// both schemas are `.strict()` with ONLY the fields the ACs allow, plus a
// compile-time assertion at the bottom that fails to compile if a forbidden
// field name is ever added to either shape.

import { z } from "zod";

/** Per-dependency health label. Never a raw error message, connection string, or stack trace. */
export const DependencyStatusSchema = z.enum(["ok", "down"]);
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

/**
 * GET /api/v1/health (liveness) — AC-41.
 * Intentionally minimal: "the process is up", nothing else. Does NOT check
 * DB/Redis (that's /health/ready's job) so this never blocks or flaps due to
 * a dependency outage — a liveness probe restarting the process because a
 * downstream dependency is briefly down would be the wrong failure mode.
 */
export const LivenessResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .strict();
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

/**
 * GET /api/v1/health/ready (readiness) — AC-42.
 * HTTP status is 503 (not 200) when any dependency is down — the BODY still
 * carries only the per-dependency labels below, never WHY it's down (no
 * driver error message, no connection string, no stack trace).
 */
export const ReadinessResponseSchema = z
  .object({
    /** Aggregate: 'ok' only when every dependency below is 'ok'; 'degraded' otherwise (mirrors the 503). */
    status: z.enum(["ok", "degraded"]),
    db: DependencyStatusSchema,
    redis: DependencyStatusSchema,
  })
  .strict();
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time assertions — Rule H-3: no internal leakage, ever.
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenHealthField =
  | "version"
  | "build"
  | "buildSha"
  | "commit"
  | "hostname"
  | "host"
  | "env"
  | "environment"
  | "nodeVersion"
  | "databaseUrl"
  | "connectionString"
  | "redisUrl"
  | "uptime"
  | "pid"
  | "error"
  | "stack"
  | "stackTrace"
  | "memoryUsage";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "INTERNAL DETAIL LEAKED IN HEALTH RESPONSE" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertLivenessLeakSafe = AssertNoForbiddenFields<LivenessResponse, ForbiddenHealthField>;
type _AssertReadinessLeakSafe = AssertNoForbiddenFields<ReadinessResponse, ForbiddenHealthField>;

const _assertLiveness: _AssertLivenessLeakSafe = true;
const _assertReadiness: _AssertReadinessLeakSafe = true;

export type { _AssertLivenessLeakSafe, _AssertReadinessLeakSafe };
void _assertLiveness;
void _assertReadiness;
