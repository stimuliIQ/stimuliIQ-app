// Phase 6 Engagement contracts — barrel export.
// Consumed by:
//   - Backend (NestJS ZodValidationPipe): all input DTOs validated at the HTTP boundary.
//   - Frontend (LMS + CRM react-hook-form resolvers + @repo/api-client typed methods).
//
// Workstreams:
//   WS-1 Notifications core  → notifications.schemas.ts
//   WS-2 Campaigns           → campaigns.schemas.ts
//   WS-3 Gamification        → gamification.schemas.ts
//   WS-4 Forum               → forum.schemas.ts
//
// Security assertions are co-located in each schema file:
//   - notifications.schemas.ts: NotificationDto/StreamEvent no-secret assertions
//   - campaigns.schemas.ts:     CampaignDto/RecipientDto no-secret assertions
//   - gamification.schemas.ts:  LeaderboardEntryDto no-PII assertion (LOCK-D5)
//
// All schemas are .strict() per CLAUDE.md §3.2 (global ZodValidationPipe strips extras).

export * from "./notifications.schemas.js";
export * from "./campaigns.schemas.js";
export * from "./gamification.schemas.js";
export * from "./forum.schemas.js";
