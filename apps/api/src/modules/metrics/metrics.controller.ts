// apps/api/src/modules/metrics/metrics.controller.ts
//
// GET /metrics — Prometheus TEXT exposition scrape target (RED: rate/errors/duration),
// NOT a JSON /api/v1 surface (docs/plans/phase-7.md task #9) — excluded from the global
// "api/v1" prefix in main.ts, same as /health and /api-docs.json. `@SkipEnvelope()`'d
// (the body is plain-text Prometheus format, never the `{data,meta,error}` envelope)
// and gated by `MetricsAuthGuard` (static token, fail-closed in staging/prod).

import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { SkipEnvelope } from "../../common/decorators/skip-envelope.decorator";
import { metricsRegistry } from "../../observability/metrics";
import { MetricsAuthGuard } from "./metrics-auth.guard";

@Controller("metrics")
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  @Get()
  @SkipEnvelope()
  scrape(@Res() res: Response): void {
    res.status(200).type("text/plain; version=0.0.4; charset=utf-8").send(metricsRegistry.renderPrometheusText());
  }
}
