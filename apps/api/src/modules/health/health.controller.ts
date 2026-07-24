// apps/api/src/modules/health/health.controller.ts
//
// GET /api/v1/health       — liveness  (AC-41)
// GET /api/v1/health/ready — readiness (AC-42, checks Postgres + Redis)
//
// PUBLIC, UNAUTHENTICATED (no JwtAuthGuard/PermissionsGuard — see docs/specs/
// phase-7-analytics-hardening.md Part 8: `observability.health.view` is intentionally
// NOT an RBAC permission, both routes are public by design), but rate-limited
// (AC-49, HealthRateLimitGuard) and `@SkipEnvelope()`'d — the response body is EXACTLY
// the DTO shape from @repo/types common/health.schemas.ts, never the standard
// `{data,meta,error}` envelope (Rule H-3: the AC's own example is the raw minimal body
// `{status:"ok"}`).

import { Controller, Get, HttpStatus, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { LivenessResponse, ReadinessResponse } from "@repo/types";
import { SkipEnvelope } from "../../common/decorators/skip-envelope.decorator";
import { HealthRateLimitGuard } from "./guards/health-rate-limit.guard";
import { HealthService } from "./health.service";

@Controller("health")
@UseGuards(HealthRateLimitGuard)
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @SkipEnvelope()
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Get("ready")
  @SkipEnvelope()
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const { body, healthy } = await this.health.readiness();
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
