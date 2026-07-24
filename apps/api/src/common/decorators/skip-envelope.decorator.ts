// apps/api/src/common/decorators/skip-envelope.decorator.ts
//
// Opt-out of the global `{ data, meta, error }` envelope (EnvelopeInterceptor) for
// routes that must return a body EXACTLY as documented by their own DTO/format —
// e.g. GET /health, /health/ready (Rule H-3 leak-safety: the body is `{status:"ok"}`,
// not `{data:{status:"ok"},meta:null,error:null}` — see @repo/types
// common/health.schemas.ts) and GET /metrics (Prometheus TEXT exposition format, not
// JSON at all). Read by EnvelopeInterceptor via Reflector.

import { SetMetadata } from "@nestjs/common";

export const SKIP_ENVELOPE_KEY = "stimuliiq:skipEnvelope";

export const SkipEnvelope = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_ENVELOPE_KEY, true);
