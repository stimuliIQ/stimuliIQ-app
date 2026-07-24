// apps/api/src/common/filters/http-exception.filter.ts
//
// Global exception filter mapping every thrown error to the RFC-7807 ProblemDetails
// shape, wrapped in the standard `{ data, meta, error }` envelope (docs/04-trd-architecture.md
// §2.14, @repo/types ProblemDetailsSchema). Nest `HttpException`s whose `getResponse()`
// already carries `{ code, title, detail, errors }` (thrown by ZodValidationPipe, guards,
// AuthService) are passed through with those fields preserved; anything else (unexpected
// errors) is mapped to a generic 500 problem so internals never leak to the client.

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ProblemDetails } from "@repo/types";
import { captureException } from "../../observability/sentry";

interface ThrownProblemShape {
  code?: string;
  title?: string;
  detail?: string;
  errors?: Array<{ path: string; message: string }>;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const shape: ThrownProblemShape =
      exception instanceof HttpException && typeof exception.getResponse() === "object"
        ? (exception.getResponse() as ThrownProblemShape)
        : {};

    if (!(exception instanceof HttpException)) {
      this.logger.error("Unhandled exception", exception instanceof Error ? exception.stack : exception);
    }

    // AC-43/WS-C: report every 5xx (unexpected exceptions AND explicit 5xx
    // HttpExceptions) to Sentry — no-op when SENTRY_DSN is unset, and the beforeSend
    // hook (observability/sentry.ts) scrubs PII/secrets before the event ever leaves
    // the process.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      captureException(exception);
    }

    const problem: ProblemDetails = {
      type: `https://docs.stimuliiq.com/errors/${shape.code ?? "http.internal_error"}`,
      title: shape.title ?? (exception instanceof HttpException ? exception.message : "Internal server error"),
      status,
      detail: shape.detail,
      instance: req.originalUrl,
      code: shape.code ?? "http.internal_error",
      traceId: req.id as string | undefined,
      errors: shape.errors,
    };

    res.status(status).json({ data: null, meta: null, error: problem });
  }
}
