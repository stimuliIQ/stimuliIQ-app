// apps/api/src/common/middleware/correlation-id.middleware.ts
//
// AC-44: every request gets a correlation/request id — as a response header AND (for
// errors) as `traceId` in the RFC-7807 body — and the SAME id appears in every
// structured log line for that request. Registered via `app.use()` in main.ts, FIRST —
// before helmet/cookie-parser/pino-http/AuditContextMiddleware/CsrfMiddleware (see
// main.ts's boot-order comment: every `app.use()` call in main.ts attaches to the
// underlying Express stack before Nest's own module-registered middleware, which is
// wired later during `app.listen()` → `init()`) — so `req.id` is already resolved by
// the time pino-http's `genReqId` (observability/logger.ts) runs; genReqId just reuses
// it via the shared `resolveRequestId()` helper, guaranteeing
// response header === log req id === error body traceId, never three different uuids
// for one request.
//
// Also stamps the id onto the active OpenTelemetry span (no-op-safe: `@opentelemetry/
// api` always returns a no-op tracer/span when no SDK is registered — see
// observability/otel.ts — so this never throws even when OTEL_EXPORTER_OTLP_ENDPOINT is
// unset, satisfying "trace propagation across module/provider boundaries" without a
// hard dependency on the collector being configured).

import type { NextFunction, Request, Response } from "express";
import { trace } from "@opentelemetry/api";
import { REQUEST_ID_HEADER, resolveRequestId } from "../../observability/request-id";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req);
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  try {
    trace.getActiveSpan()?.setAttribute("request.id", id);
  } catch {
    // Fail-safe: never let OTel API usage (even the no-op implementation) block a
    // request.
  }

  next();
}
