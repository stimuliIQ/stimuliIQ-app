// apps/api/src/modules/health/health.service.ts
//
// Liveness/readiness business logic (docs/plans/phase-7.md task #9,
// docs/specs/phase-7-analytics-hardening.md WS-C AC-41/AC-42). Controller → service →
// repository (CLAUDE.md §3.3) — the controller only translates the service's result
// into an HTTP status code; every DB/Redis touch lives here.
//
// Rule H-3 (leak-safe): whatever goes wrong with Postgres/Redis, the CALLER never sees
// more than a per-dependency "ok"/"down" label — the actual driver error (which can
// contain a hostname/port/connection string) is logged SERVER-SIDE ONLY via the Nest
// Logger, never returned in the response body.

import { Injectable, Logger } from "@nestjs/common";
import type { DependencyStatus, ReadinessResponse } from "@repo/types";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";

const DEPENDENCY_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dependency check timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

export interface ReadinessResult {
  healthy: boolean;
  body: ReadinessResponse;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** AC-41: minimal payload, no dependency checks — a liveness probe restarting the
   *  process because a downstream dependency is briefly down is the WRONG failure mode. */
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  /** AC-42: 200 only when BOTH dependencies are reachable; 503-worthy otherwise. The
   *  controller maps `healthy` to the actual HTTP status code. */
  async readiness(): Promise<ReadinessResult> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const healthy = db === "ok" && redis === "ok";
    return {
      healthy,
      body: { status: healthy ? "ok" : "degraded", db, redis },
    };
  }

  private async checkDb(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, DEPENDENCY_TIMEOUT_MS);
      return "ok";
    } catch (err) {
      this.logger.warn(
        `Readiness check: Postgres unreachable · ${err instanceof Error ? err.message : "unknown error"}`,
      );
      return "down";
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.redis.client.ping(), DEPENDENCY_TIMEOUT_MS);
      return "ok";
    } catch (err) {
      this.logger.warn(
        `Readiness check: Redis unreachable · ${err instanceof Error ? err.message : "unknown error"}`,
      );
      return "down";
    }
  }
}
