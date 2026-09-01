// apps/api/src/modules/org/dto/index.ts
//
// Re-exports the org zod schemas from @repo/types (docs/04-trd-architecture.md §2.2 module
// template). Never redeclare a shape here — single source of truth stays in the shared
// package, which is also what lets the CRM run `resolveLeaveApprovalChain` unchanged.

export {
  ListTeamsQuerySchema,
  type ListTeamsQuery,
  CreateTeamRequestSchema,
  type CreateTeamRequest,
  UpdateTeamRequestSchema,
  type UpdateTeamRequest,
  SetTeamMembersRequestSchema,
  type SetTeamMembersRequest,
  type Team,
  type TeamDetail,
  type MyOrgPosition,
} from "@repo/types";
