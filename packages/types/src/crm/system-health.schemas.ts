// System health — CRM ▸ Admin ▸ System Health (super_admin only, `system.health.view`).
//
// One read-only snapshot answering "is the platform healthy right now, and how big is it?":
// the API process itself, Postgres, Redis, the three frontends, the third-party integrations,
// the student headcount and the API's own request counters.
//
// WHAT THE STATUS WORDS MEAN, because an operations screen that overclaims is worse than none:
//   healthy  — a live check ran and passed (or, for an integration, credentials are present;
//              the summary text says which)
//   degraded — reachable but slow, erroring, or unconfigured where production needs it
//   down     — a live check ran and failed
//   unknown  — nothing to check (integration deliberately switched off / no-op provider)
//
// Nothing here carries a secret, a connection string or a driver error message: every field is
// a label, a number or a short sentence the server wrote itself (same leak-safe rule as the
// public /health endpoints, common/health.schemas.ts).

import { z } from "zod";

export const SystemHealthStatusSchema = z.enum(["healthy", "degraded", "down", "unknown"]);
export type SystemHealthStatus = z.infer<typeof SystemHealthStatusSchema>;

export const SystemHealthCategorySchema = z.enum(["application", "data", "frontend", "integration"]);
export type SystemHealthCategory = z.infer<typeof SystemHealthCategorySchema>;

export const SystemHealthDetailSchema = z.object({
  label: z.string(),
  value: z.string(),
});
export type SystemHealthDetail = z.infer<typeof SystemHealthDetailSchema>;

export const SystemHealthComponentSchema = z.object({
  /** Stable machine key: `api`, `postgres`, `redis`, `web`, `lms`, `crm`, `payments`, … */
  key: z.string(),
  name: z.string(),
  category: SystemHealthCategorySchema,
  status: SystemHealthStatusSchema,
  /** Round-trip time of the live check, or null when nothing was pinged. */
  latencyMs: z.number().nullable(),
  /** One sentence a non-engineer can act on. */
  summary: z.string(),
  details: z.array(SystemHealthDetailSchema),
});
export type SystemHealthComponent = z.infer<typeof SystemHealthComponentSchema>;

export const SystemHealthStudentsSchema = z.object({
  /** Every student profile that is not soft-deleted. */
  total: z.number().int(),
  /** Student accounts whose login is enabled (`users.status = active`). */
  activeAccounts: z.number().int(),
  /** Signed in at least once in the window. */
  signedInLast24h: z.number().int(),
  signedInLast7d: z.number().int(),
  /** Accounts that have never signed in (typically: temporary password not yet used). */
  neverSignedIn: z.number().int(),
  /** Profiles created in the window. */
  newLast7d: z.number().int(),
  newLast30d: z.number().int(),
  /** Unrevoked, unexpired sessions across the tenant (students + staff). */
  liveSessions: z.number().int(),
});
export type SystemHealthStudents = z.infer<typeof SystemHealthStudentsSchema>;

export const SystemHealthRuntimeSchema = z.object({
  nodeVersion: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().int(),
  startedAt: z.string(),
  memoryRssMb: z.number(),
  heapUsedMb: z.number(),
  heapLimitMb: z.number(),
  /** Mean / p99 event-loop delay since the previous snapshot, in milliseconds. */
  eventLoopMeanMs: z.number(),
  eventLoopP99Ms: z.number(),
  hostMemoryUsedPercent: z.number(),
  cpuCount: z.number().int(),
});
export type SystemHealthRuntime = z.infer<typeof SystemHealthRuntimeSchema>;

export const SystemHealthTrafficSchema = z.object({
  /** All counters are since the API process last started and reset on every deploy/restart. */
  totalRequests: z.number().int(),
  clientErrors: z.number().int(),
  serverErrors: z.number().int(),
  /** serverErrors / totalRequests, as a percentage; 0 when there is no traffic yet. */
  serverErrorRatePercent: z.number(),
  averageResponseMs: z.number(),
  inFlight: z.number().int(),
});
export type SystemHealthTraffic = z.infer<typeof SystemHealthTrafficSchema>;

export const SystemHealthOverallSchema = z.object({
  status: SystemHealthStatusSchema,
  /** "All systems operational" / "Degraded: LMS, Redis" / "Outage: PostgreSQL". */
  headline: z.string(),
  healthyCount: z.number().int(),
  degradedCount: z.number().int(),
  downCount: z.number().int(),
  unknownCount: z.number().int(),
});
export type SystemHealthOverall = z.infer<typeof SystemHealthOverallSchema>;

export const SystemHealthReportSchema = z.object({
  checkedAt: z.string(),
  overall: SystemHealthOverallSchema,
  components: z.array(SystemHealthComponentSchema),
  students: SystemHealthStudentsSchema,
  runtime: SystemHealthRuntimeSchema,
  traffic: SystemHealthTrafficSchema,
});
export type SystemHealthReport = z.infer<typeof SystemHealthReportSchema>;

/** Components whose failure is an outage rather than a degradation. */
export const SYSTEM_HEALTH_CRITICAL_KEYS = ["api", "postgres", "redis"] as const;

/**
 * Rolls component statuses up into one verdict. Shared by the API (which computes it) and the
 * CRM (which re-derives the banner colour from it), so the two cannot disagree about what
 * "healthy" means — same reasoning as `computeLeaveDuration`.
 *
 *   down      — a critical component (API, Postgres, Redis) is down
 *   degraded  — anything else is down or degraded
 *   healthy   — everything checked is healthy or unknown
 */
export function rollUpSystemHealth(
  components: ReadonlyArray<Pick<SystemHealthComponent, "key" | "name" | "status">>,
): SystemHealthOverall {
  const count = (status: SystemHealthStatus) => components.filter((c) => c.status === status).length;
  const critical = new Set<string>(SYSTEM_HEALTH_CRITICAL_KEYS);

  const criticalDown = components.filter((c) => c.status === "down" && critical.has(c.key));
  const troubled = components.filter((c) => c.status === "down" || c.status === "degraded");

  let status: SystemHealthStatus = "healthy";
  let headline = "All systems operational";
  if (criticalDown.length > 0) {
    status = "down";
    headline = `Outage: ${criticalDown.map((c) => c.name).join(", ")}`;
  } else if (troubled.length > 0) {
    status = "degraded";
    headline = `Degraded: ${troubled.map((c) => c.name).join(", ")}`;
  }

  return {
    status,
    headline,
    healthyCount: count("healthy"),
    degradedCount: count("degraded"),
    downCount: count("down"),
    unknownCount: count("unknown"),
  };
}
