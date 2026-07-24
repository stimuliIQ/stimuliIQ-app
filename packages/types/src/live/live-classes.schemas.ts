// Live classes contract — Phase 9 Completion, T14/T20 (docs/plans/phase-9-completion.md).
// Backs `model LiveClass` (prisma/schema.prisma) — a scheduled session for a batch,
// hosted through the swappable `LiveClassProvider` (zoom | google_meet | noop, T15).
//
// Surfaces:
//   - CRM (staff): schedule/update/cancel/list/get under /api/v1/crm/live-classes.
//     Permission: liveclass.view/create/edit/cancel (scope: all|branch|assigned per
//     the batch's faculty/mentor resolvers — mirrors batches.* scope precedent).
//   - LMS (student): read-only list of the student's own enrolled-batch sessions +
//     join under /api/v1/me/live-classes. Permission: liveclass.view (scope: own,
//     resolved via the student's active enrollments).
//   - Join endpoint (both surfaces) mints a short-lived provider join URL — NEVER a
//     raw/permanent meeting link (same "no raw provider secrets" posture as
//     StorageProvider/VideoProvider signed-URL patterns).
//   - Attendance auto-sync (T20, ≤60s of join) writes `attendance` rows with
//     `source='live'` + `live_class_id` set — the sync endpoint is a
//     provider-webhook/poller-triggered internal write, exposed here only as the
//     read-shape (`LiveClassAttendanceSyncResultSchema`) backend-builder's worker
//     produces; there is no client-callable "mark attendance" mutation.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma LiveClassProvider / LiveClassStatus)
// ─────────────────────────────────────────────────────────────────────────

export const LiveClassProviderSchema = z.enum(["zoom", "google_meet", "noop"]);
export type LiveClassProvider = z.infer<typeof LiveClassProviderSchema>;

export const LiveClassStatusSchema = z.enum(["scheduled", "live", "completed", "cancelled"]);
export type LiveClassStatus = z.infer<typeof LiveClassStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CRM: schedule / update / list / get — /api/v1/crm/live-classes
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/live-classes
 * Creates the DB row AND asks the resolved `LiveClassProvider` adapter to create the
 * remote meeting (async — `providerMeetingId`/`joinUrl` may be null in the immediate
 * response while the provider call is in flight; poll GET .../:id).
 */
export const CreateLiveClassRequestSchema = z
  .object({
    batchId: UuidSchema,
    title: z.string().min(1).max(200),
    provider: LiveClassProviderSchema.default("noop"),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    hostUserId: UuidSchema.describe("Faculty/mentor user hosting the session."),
  })
  .strict();
export type CreateLiveClassRequest = z.infer<typeof CreateLiveClassRequestSchema>;

/** PATCH /api/v1/crm/live-classes/:id — reschedule/retitle. Status transitions use dedicated actions below. */
export const UpdateLiveClassRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    hostUserId: UuidSchema,
  })
  .partial()
  .strict();
export type UpdateLiveClassRequest = z.infer<typeof UpdateLiveClassRequestSchema>;

/** POST /api/v1/crm/live-classes/:id/cancel — empty body, id is in the path. */
export const CancelLiveClassRequestSchema = z.object({}).strict();
export type CancelLiveClassRequest = z.infer<typeof CancelLiveClassRequestSchema>;

/** GET /api/v1/crm/live-classes — filter/paginate. */
export const ListLiveClassesQuerySchema = z
  .object({
    batchId: UuidSchema.optional(),
    programId: UuidSchema.optional(),
    status: LiveClassStatusSchema.optional(),
    from: IsoDateTimeSchema.optional().describe("Filter startsAt >= from."),
    to: IsoDateTimeSchema.optional().describe("Filter startsAt <= to."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListLiveClassesQuery = z.infer<typeof ListLiveClassesQuerySchema>;

/** GET /api/v1/me/live-classes — the student's own enrolled-batch sessions. */
export const ListMyLiveClassesQuerySchema = z
  .object({
    status: LiveClassStatusSchema.optional(),
    upcoming: z.coerce.boolean().optional().describe("When true, filters to startsAt >= now."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListMyLiveClassesQuery = z.infer<typeof ListMyLiveClassesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const LiveClassSummarySchema = z.object({
  id: UuidSchema,
  batchId: UuidSchema,
  batchName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  title: z.string(),
  provider: LiveClassProviderSchema,
  status: LiveClassStatusSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  hostUserId: UuidSchema,
  hostName: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type LiveClassSummary = z.infer<typeof LiveClassSummarySchema>;

export const LiveClassDetailSchema = LiveClassSummarySchema.extend({
  providerMeetingId: z.string().nullable(),
  recordingUrl: z.string().url().nullable().describe(
    "Provider-hosted recording link (Zoom/Meet cloud recording), NOT a StorageProvider key. " +
      "Set once available (after the session ends).",
  ),
  attendeeCount: z.number().int().min(0).describe("Count of attendance rows with source='live' for this session."),
  updatedAt: IsoDateTimeSchema,
});
export type LiveClassDetail = z.infer<typeof LiveClassDetailSchema>;

/** A single row on the student's own live-class list — same shape as summary, minus staff-only host id noise. */
export const MyLiveClassSchema = z.object({
  id: UuidSchema,
  batchId: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string(),
  title: z.string(),
  status: LiveClassStatusSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  hostName: z.string(),
  canJoin: z.boolean().describe("True when status='live' or startsAt is within the provider's pre-join window."),
});
export type MyLiveClass = z.infer<typeof MyLiveClassSchema>;

/**
 * POST /api/v1/crm/live-classes/:id/join or /api/v1/me/live-classes/:id/join
 * Mints a short-lived provider join URL. NEVER a permanent/raw meeting link — the
 * `noop` adapter returns a deterministic placeholder for dev/test.
 */
export const JoinLiveClassResponseSchema = z.object({
  joinUrl: z.string().url(),
  provider: LiveClassProviderSchema,
  expiresAt: IsoDateTimeSchema.describe("When this join URL/token expires."),
});
export type JoinLiveClassResponse = z.infer<typeof JoinLiveClassResponseSchema>;

/**
 * Backend-internal worker output shape (T20 attendance auto-sync, ≤60s of join) —
 * exposed here only so frontend-builder can render a "last synced" indicator on the
 * CRM live-class detail page. Not a client-invocable mutation.
 */
export const LiveClassAttendanceSyncResultSchema = z.object({
  liveClassId: UuidSchema,
  syncedCount: z.number().int().min(0),
  lastSyncedAt: IsoDateTimeSchema.nullable(),
});
export type LiveClassAttendanceSyncResult = z.infer<typeof LiveClassAttendanceSyncResultSchema>;
