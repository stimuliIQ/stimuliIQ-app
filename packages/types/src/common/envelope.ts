// Standard API response envelope + RFC-7807 problem-details error shape.
// Every stimuliiq /api/v1 response follows `{ data, meta, error }` per
// docs/04-trd-architecture.md §2.14. Reused by NestJS interceptors (BE) and
// @repo/api-client (FE) — single source of truth (CLAUDE.md §3.2).

import { z } from "zod";

/**
 * RFC 7807 "Problem Details for HTTP APIs" error body. Carried inside the
 * envelope's `error` field on failure responses. `instance` is the request
 * path; `traceId` ties back to pino/OTel for support + observability.
 */
export const ProblemDetailsSchema = z.object({
  type: z.string().url().describe("URI identifying the problem type (RFC 7807)."),
  title: z.string().min(1).describe("Short, human-readable summary of the problem."),
  status: z.number().int().min(100).max(599).describe("HTTP status code."),
  detail: z.string().optional().describe("Human-readable explanation specific to this occurrence."),
  instance: z.string().optional().describe("Request path that produced the error."),
  code: z
    .string()
    .min(1)
    .describe("Stable machine-readable error code, e.g. `auth.invalid_credentials`."),
  traceId: z.string().optional().describe("Correlation id for logs/traces (pino/OTel request id)."),
  errors: z
    .array(
      z.object({
        path: z.string().describe("Dot-path of the offending field, e.g. `body.email`."),
        message: z.string(),
      }),
    )
    .optional()
    .describe("Field-level validation errors (populated by the global ZodValidationPipe)."),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Cursor-pagination metadata, included in `meta` for list endpoints.
 * Not used by the Phase-0 auth slice (no list endpoints here) but declared
 * once so every future paginated resource reuses the same shape.
 */
export const PaginationMetaSchema = z.object({
  nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null if none."),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Builds the `{ data, meta, error }` envelope schema for a given data shape.
 * `meta` is a free-form record by default; pass an explicit meta schema
 * (e.g. PaginationMetaSchema) for list endpoints.
 */
export function buildEnvelopeSchema<DataSchema extends z.ZodTypeAny>(
  dataSchema: DataSchema,
  metaSchema: z.ZodTypeAny = z.record(z.string(), z.unknown()).nullable(),
) {
  return z.object({
    data: dataSchema.nullable(),
    meta: metaSchema.nullable().default(null),
    error: ProblemDetailsSchema.nullable().default(null),
  });
}

/** Generic envelope type helper for consumers that only need the TS type. */
export type Envelope<TData, TMeta = Record<string, unknown> | null> = {
  data: TData | null;
  meta: TMeta | null;
  error: ProblemDetails | null;
};
