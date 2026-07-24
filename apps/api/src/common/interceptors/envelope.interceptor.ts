// apps/api/src/common/interceptors/envelope.interceptor.ts
//
// Wraps every successful controller return value in the standard `{ data, meta, error }`
// envelope (docs/04-trd-architecture.md §2.14). Controllers return plain DTOs (per the
// layering rule — no business logic, no envelope-building in controllers); this
// interceptor is the single place that builds the envelope shape, mirroring
// `buildEnvelopeSchema` in @repo/types so FE/BE never disagree on the wire shape.
//
// Phase 7 WS-C (docs/plans/phase-7.md task #9): routes marked `@SkipEnvelope()` (health,
// readiness, metrics) bypass the wrapping entirely and return their body verbatim — see
// common/decorators/skip-envelope.decorator.ts for why.

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { PaginatedResult, ResultWithMeta } from "../dto/paginated-result";
import { SKIP_ENVELOPE_KEY } from "../decorators/skip-envelope.decorator";

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  // Defaulted so existing call sites that construct this manually (`new
  // EnvelopeInterceptor()`, e.g. main.ts) keep working without DI wiring — `Reflector`
  // has no dependencies of its own, so a bare `new Reflector()` is safe here.
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        // CRM list endpoints return a `PaginatedResult` marker (see
        // common/dto/paginated-result.ts) so `meta` carries `OffsetPaginationMeta`
        // instead of the free-form-record default every other response gets.
        if (data instanceof PaginatedResult) {
          return { data: data.items, meta: data.meta, error: null };
        }

        // Structured payload + pagination meta (e.g. GET /me/attendance's
        // `{ items, summaries }`). Without this marker such a controller had to
        // hand-roll `{ data, meta }`, which this interceptor then wrapped again —
        // double-nesting `data` and breaking SDK consumers.
        if (data instanceof ResultWithMeta) {
          return { data: data.payload, meta: data.meta, error: null };
        }

        return {
          data: data ?? null,
          meta: null,
          error: null,
        };
      }),
    );
  }
}
