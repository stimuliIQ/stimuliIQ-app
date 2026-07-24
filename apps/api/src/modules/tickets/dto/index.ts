// apps/api/src/modules/tickets/dto/index.ts
//
// Re-exports the Phase-9 support-desk zod schemas from @repo/types (docs/04-trd-
// architecture.md §2.2 module template). Never redeclare a shape here — single source of
// truth stays in packages/types/src/support/{tickets,canned-responses,kb-articles}.schemas.ts.

export {
  TicketStatusSchema,
  type TicketStatus,
  TicketPrioritySchema,
  type TicketPriority,
  CreateTicketRequestSchema,
  type CreateTicketRequest,
  UpdateTicketRequestSchema,
  type UpdateTicketRequest,
  ListTicketsQuerySchema,
  type ListTicketsQuery,
  ListMyTicketsQuerySchema,
  type ListMyTicketsQuery,
  AddTicketMessageRequestSchema,
  type AddTicketMessageRequest,
  RateTicketRequestSchema,
  type RateTicketRequest,
  TicketMessageSchema,
  type TicketMessage,
  TicketSummarySchema,
  type TicketSummary,
  TicketDetailSchema,
  type TicketDetail,
} from "@repo/types";

export {
  CreateCannedResponseRequestSchema,
  type CreateCannedResponseRequest,
  UpdateCannedResponseRequestSchema,
  type UpdateCannedResponseRequest,
  ListCannedResponsesQuerySchema,
  type ListCannedResponsesQuery,
  CannedResponseSchema,
  type CannedResponse,
} from "@repo/types";

export {
  CreateKbArticleRequestSchema,
  type CreateKbArticleRequest,
  UpdateKbArticleRequestSchema,
  type UpdateKbArticleRequest,
  ListKbArticlesQuerySchema,
  type ListKbArticlesQuery,
  KbArticleSummarySchema,
  type KbArticleSummary,
  KbArticleDetailSchema,
  type KbArticleDetail,
  ListPublicKbArticlesQuerySchema,
  type ListPublicKbArticlesQuery,
  PublicKbArticleSummarySchema,
  type PublicKbArticleSummary,
  PublicKbArticleDetailSchema,
  type PublicKbArticleDetail,
} from "@repo/types";
