// apps/api/src/common/interceptors/metrics.interceptor.ts
//
// Global interceptor recording RED (Rate/Errors/Duration) metrics for every HTTP
// request into the in-memory registry (observability/metrics.ts), scraped as
// Prometheus text at GET /metrics (docs/plans/phase-7.md task #9).

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { metricsRegistry } from "../../observability/metrics";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Collapses path segments that look like ids (UUIDs, bare numeric ids) into a `:id`
 * placeholder — used ONLY as a fallback when Express hasn't yet matched a route
 * pattern (e.g. a 404 on an unknown path), so an unmatched/errored request can never
 * explode label cardinality with a real id, and never leaks a per-tenant/per-entity
 * identifier into the scrape target.
 */
function collapseIds(path: string): string {
  return path.replace(UUID_RE, ":id").replace(/\/\d+(?=\/|$)/g, "/:id");
}

function resolveRoutePattern(req: Request): string {
  const routePath = (req as unknown as { route?: { path?: string } }).route?.path;
  if (typeof routePath === "string" && routePath.length > 0) {
    return routePath;
  }
  return collapseIds((req.path ?? req.originalUrl ?? "unknown").split("?")[0] ?? "unknown");
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const route = resolveRoutePattern(req);
    const start = process.hrtime.bigint();

    metricsRegistry.incInFlight();

    const finish = (statusOverride?: number): void => {
      metricsRegistry.decInFlight();
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const status = statusOverride ?? res.statusCode;
      metricsRegistry.recordHttpRequest(req.method, route, status, durationSeconds);
    };

    return next.handle().pipe(
      tap(() => finish()),
      catchError((err: unknown) => {
        const status = (err as { status?: number; getStatus?: () => number })?.getStatus?.() ?? 500;
        finish(status);
        return throwError(() => err);
      }),
    );
  }
}
