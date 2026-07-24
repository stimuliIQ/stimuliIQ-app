// Typed health/readiness SDK — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Namespace: client.health.*
//
// PUBLIC, UNAUTHENTICATED, GET-only (AC-41/AC-42/AC-49) — no cookie/CSRF
// wiring needed, unlike every other resource on this SDK. Uses
// `ApiClient.requestRaw()` (not `request()`) because these two endpoints are
// a deliberate exception to the `{ data, meta, error }` envelope: the AC's
// own example is the raw minimal body `{ status: "ok" }` (Rule H-3 — no
// version/build/hostname/secret ever, by construction — see @repo/types
// common/health.schemas.ts compile-time assertion).
//
// `readiness()` does NOT throw on a 503 — a 503 with a valid body (e.g.
// `{ status: "degraded", db: "down", redis: "ok" }`) is the EXPECTED shape
// when a dependency is down; the caller inspects `httpStatus`/`body` itself
// rather than catching an `ApiError`.

import type { LivenessResponse, ReadinessResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class HealthApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/health — liveness probe. Always 200 while the process is up. */
  async liveness(): Promise<{ httpStatus: number; body: LivenessResponse }> {
    return this.client.requestRaw<LivenessResponse>("GET", "/api/v1/health");
  }

  /**
   * GET /api/v1/health/ready — readiness probe (DB + Redis).
   * `httpStatus` is 503 when any dependency is down; `body` always carries
   * only the per-dependency `ok`/`down` labels (never a driver error/stack).
   */
  async readiness(): Promise<{ httpStatus: number; body: ReadinessResponse }> {
    return this.client.requestRaw<ReadinessResponse>("GET", "/api/v1/health/ready");
  }
}
