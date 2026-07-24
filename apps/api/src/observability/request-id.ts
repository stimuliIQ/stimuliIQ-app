// apps/api/src/observability/request-id.ts
//
// Single source of truth for the correlation/request id (AC-44, docs/specs/
// phase-7-analytics-hardening.md WS-C). Both `CorrelationIdMiddleware` (sets the
// response header + `req.id` EARLY — see main.ts boot-order comment) and pino's
// `genReqId` (observability/logger.ts) call this SAME resolver so the id that ends up
// in the response header, the RFC-7807 error body (`traceId`), and every log line for
// the request are always identical — never three different uuids for one request.

import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

/** Max length + charset for an accepted client-supplied correlation id (L-2). */
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._-]+$/;

interface RequestIdCarrier {
  // `unknown` (not `string | number`) because pino-http's own `ReqId` type is
  // `number | string | object` (an already-attached pino-http request id can, in
  // principle, be an object) — this helper only ever reads it defensively via
  // `String(...)`, never assumes a narrower shape.
  id?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Reuses `req.id` if already resolved (by an earlier middleware in this same request's
 * pipeline), else the client-supplied `X-Request-Id` header, else generates a fresh
 * uuid. Never returns an empty string.
 */
export function resolveRequestId(req: RequestIdCarrier): string {
  if (req.id !== undefined && req.id !== null && String(req.id).length > 0) {
    return String(req.id);
  }

  const header = req.headers[REQUEST_ID_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === "string") {
    // L-2: only accept a bounded, safe-charset client id (echoed into the response header
    // and used as the pino reqId); anything oversized or with unexpected characters is
    // rejected in favour of a fresh uuid rather than reflected.
    const trimmed = headerValue.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_REQUEST_ID_LENGTH && SAFE_REQUEST_ID_RE.test(trimmed)) {
      return trimmed;
    }
  }

  return randomUUID();
}
