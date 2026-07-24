// @repo/api-client — typed fetch SDK for the stimuliiq API
// (docs/04-trd-architecture.md §2.14). Hand-typed against the same zod
// schemas (@repo/types) that produced the OpenAPI document
// (packages/types/src/openapi), so there is exactly one contract for
// request/response shapes — see packages/api-client/openapi/auth.openapi.json
// for the published spec this client implements.
//
// Phase 2 adds `client.commerce.*` (orders/payments/invoices/refunds/coupons)
// and extends `client.crm.*` with leads/activities/bookings.
// Phase 3 adds `client.lms.*` (dashboard/enrollments/curriculum/lessons/
// stream-url/progress/attendance) — see lms/index.ts.
//
// Frontends MUST go through this SDK — never hand-write fetches
// (CLAUDE.md §3.2).

export const PACKAGE_NAME = "@repo/api-client" as const;

export * from "./sdk.js";
export * from "./http/client.js";
export * from "./http/envelope-error.js";
export * from "./auth/auth.api.js";
export * from "./auth/two-factor.api.js";
export * from "./crm/index.js";
export * from "./commerce/index.js";
export * from "./lms/index.js";
// Phase 4 Learning Depth — assignments, assessments, certificates, storage.
export * from "./learning/index.js";
// Phase 5 Public surface — programs catalog, lead capture, coupon validate,
// self-service registration, enrollment funnel (order + checkout + verify), book-slot.
export * from "./public/index.js";
// Phase 6 Engagement — notifications (in-app/SSE/prefs/unsubscribe), campaigns
// (templates+CRUD+send+recipients+metrics), gamification (points/badges/leaderboard),
// forum (threads/posts/replies/vote/moderate).
export * from "./engagement/index.js";
// Phase 7 Analytics + Hardening — `client.crm.reports.*` (8 KPI dashboards),
// `client.crm.exports.*` + `client.crm.reportSchedules.*` (on-demand/scheduled
// CSV/PDF exports), `client.health.*` (public liveness/readiness — raw,
// non-enveloped responses per AC-41/AC-42).
export * from "./health/health.api.js";
