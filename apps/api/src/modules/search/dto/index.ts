// apps/api/src/modules/search/dto/index.ts
//
// Re-exports the Phase-9 Completion global-search zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template). Never redeclare a shape here —
// single source of truth stays in packages/types/src/lms/search.schemas.ts.

export {
  SearchResultTypeSchema,
  type SearchResultType,
  GlobalSearchQuerySchema,
  type GlobalSearchQuery,
  SearchResultItemSchema,
  type SearchResultItem,
  GlobalSearchResponseSchema,
  type GlobalSearchResponse,
} from "@repo/types";
