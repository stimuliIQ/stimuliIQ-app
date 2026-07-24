// apps/api/src/common/dto/paginated-result.ts
//
// Sentinel return type for list controller methods (docs/04-trd-architecture.md
// §2.14 envelope: list endpoints carry pagination meta in `meta`, not the
// free-form-record default `EnvelopeInterceptor` otherwise applies). Controllers
// return `new PaginatedResult(items, meta)` instead of a bare array;
// `EnvelopeInterceptor` recognizes the marker and unpacks it into
// `{ data: items, meta }` instead of wrapping the whole object as `data`. This keeps
// the "controllers return plain DTOs, one global interceptor builds the envelope" rule
// (CLAUDE.md §3.3) intact for both single-resource and paginated-list shapes.
//
// Meta is either `OffsetPaginationMeta` (CRM lists: page/pageSize/total) or
// `PaginationMeta` (cursor lists: nextCursor/hasMore — public catalog, feeds).
// The @repo/api-client SDK's `requestCursorPaginated` expects the cursor shape.

import type { OffsetPaginationMeta, PaginationMeta } from "@repo/types";

export class PaginatedResult<
  T,
  M extends OffsetPaginationMeta | PaginationMeta = OffsetPaginationMeta,
> {
  constructor(
    public readonly items: T[],
    public readonly meta: M,
  ) {}
}

/**
 * Sentinel for endpoints whose `data` is a STRUCTURED OBJECT (not a bare array)
 * that still needs pagination in `meta` — e.g. `GET /me/attendance`, whose
 * contract is `data: { items, summaries }` + `meta: OffsetPaginationMeta`
 * (packages/types lms/attendance.schemas.ts).
 *
 * `PaginatedResult` can't express that: it always unpacks `data` to the items
 * array. Before this existed, that controller hand-rolled `{ data, meta }` as its
 * return value — which the EnvelopeInterceptor then wrapped AGAIN, producing a
 * double-nested `data.data.summaries` and crashing every SDK consumer
 * (`Cannot read properties of undefined (reading 'length')` on /progress).
 *
 * Controllers return `new ResultWithMeta(payload, meta)`; the interceptor unpacks
 * it to `{ data: payload, meta }`.
 */
export class ResultWithMeta<
  T,
  M extends OffsetPaginationMeta | PaginationMeta = OffsetPaginationMeta,
> {
  constructor(
    public readonly payload: T,
    public readonly meta: M,
  ) {}
}
