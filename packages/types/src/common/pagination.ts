// Shared offset-pagination query primitives for CRM list endpoints.
//
// Note on pagination strategy: docs/04-trd-architecture.md §2.14 calls for
// "cursor pagination for large lists." P0's `PaginationMetaSchema`
// (common/envelope.ts) already declares the cursor shape (`nextCursor` +
// `hasMore`) for future high-volume/public lists (e.g. `programs`). CRM
// internal directories (students/faculty/batches/audit-logs) are staff-facing,
// filter-heavy, and need stable "go to page N" + total-count UX (docs/03 §8:
// "dense-but-fast UI, server-side pagination ... exportable everything") —
// so this Wave uses **offset pagination** (`page`/`pageSize`) for all CRM
// list queries, with `OffsetPaginationMetaSchema` carrying `total` alongside
// `hasMore`. Both pagination styles share the same `{ data, meta, error }`
// envelope; resources are free to pick whichever meta schema fits their
// access pattern. Do not duplicate `page`/`pageSize` validation per-resource —
// always spread `PageQuerySchema.shape` into a resource's query schema.

import { z } from "zod";

/** Common page/pageSize query params, reused by every CRM list endpoint. */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe("1-based page number."),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe("Items per page, max 200."),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** Offset-pagination response meta — total count + hasMore, alongside page/pageSize echoed back. */
export const OffsetPaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type OffsetPaginationMeta = z.infer<typeof OffsetPaginationMetaSchema>;
