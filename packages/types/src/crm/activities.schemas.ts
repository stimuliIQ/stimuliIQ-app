// Activities contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Activities are LOGGED RECORDS only in P2 — they are NOT sent (docs/03 §7.11,
// phase-2.md scope boundary):
//   - `whatsapp` / `email` type activities are logged as records. No actual
//     message is sent via WhatsAppProvider / MailProvider in P2. Delivery is P6.
//   - `call` / `note` / `task` are normal manual log entries.
//   - `task` rows with `due_at` = follow-up SLA entries; `done_at` set via the
//     /complete endpoint marks them done.
//
// Either `leadId` or `studentId` must be provided (not both, not neither) —
// an activity is linked to exactly one subject. The backend enforces this;
// the contract documents the expectation via a superRefine.
//
// `payload` is a typed JSON blob (open shape by design — different activity
// types carry different metadata, e.g. call has `duration`, note has `body`,
// task has `description`). Callers should include type-appropriate fields.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const ActivityTypeSchema = z.enum(["call", "note", "whatsapp", "email", "task"]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Sub-schemas: typed payload helpers
// ─────────────────────────────────────────────────────────────────────────

/** Payload for `call` activities. */
export const CallPayloadSchema = z.object({
  outcome: z.enum(["answered", "no_answer", "voicemail", "busy", "wrong_number"]).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

/** Payload for `note` activities. */
export const NotePayloadSchema = z.object({
  body: z.string().min(1).max(5000),
});

/** Payload for `task` activities (follow-up tasks / SLA). */
export const TaskPayloadSchema = z.object({
  description: z.string().min(1).max(1000),
});

/**
 * Payload for `whatsapp` / `email` activities.
 * These are LOGGED records in P2 — no actual delivery. The payload records
 * what was communicated, for the activity timeline.
 */
export const MessagePayloadSchema = z.object({
  body: z.string().min(1).max(5000).describe("Message body that was sent (logged, not delivered in P2)."),
  subject: z.string().max(200).optional().describe("Subject line (email only)."),
});

/**
 * Generic activity payload (open record for extensibility).
 * Callers SHOULD include type-appropriate fields per the typed helpers above,
 * but the contract is intentionally open to avoid coupling to exact payload
 * shapes that vary by activity type. `unknown` justification: different
 * activity types have fundamentally different payload schemas and the contract
 * layer should not be a switch/discriminated union at the top level.
 */
export const ActivityPayloadSchema = z.record(z.string(), z.unknown()).describe(
  "Activity-type-specific payload. Use the typed payload schemas (CallPayload, " +
    "NotePayload, TaskPayload, MessagePayload) as guidance for what to include.",
);
export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/activities
 *
 * Log an activity against a lead or a student. Exactly one of `leadId` or
 * `studentId` must be provided. The authenticated user is recorded as the actor
 * (`user_id` = current user — NOT sent by the client).
 *
 * For `task` type: provide `dueAt` to set an SLA follow-up deadline. The task
 * appears in the "today's tasks / due follow-ups" view (docs/03 §7.12).
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 */
export const CreateActivityRequestSchema = z
  .object({
    type: ActivityTypeSchema,
    payload: ActivityPayloadSchema.describe(
      "Activity-specific data. See typed payload schemas in this file for guidance.",
    ),
    leadId: UuidSchema.optional().describe("Lead this activity is attached to."),
    studentId: UuidSchema.optional().describe("Student this activity is attached to."),
    dueAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Follow-up deadline (task type only). Appears in the SLA/tasks view."),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasLead = !!data.leadId;
    const hasStudent = !!data.studentId;
    if (!hasLead && !hasStudent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leadId"],
        message: "Either leadId or studentId must be provided.",
      });
    }
    if (hasLead && hasStudent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentId"],
        message: "Only one of leadId or studentId may be provided, not both.",
      });
    }
  });
export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>;

/**
 * POST /api/v1/crm/activities/:id/complete
 *
 * Marks a `task` activity as done. Sets `done_at = now` (or the provided
 * `doneAt`). Only valid for `type = task`; non-task activities return 422.
 *
 * `Idempotency-Key` header required.
 */
export const CompleteTaskRequestSchema = z
  .object({
    doneAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("When the task was completed. Defaults to now if omitted."),
    notes: z.string().max(500).optional().describe("Completion notes for the activity log."),
  })
  .strict();
export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequestSchema>;

/** GET /api/v1/crm/activities — filter/paginate activities. */
export const ListActivitiesQuerySchema = z
  .object({
    leadId: UuidSchema.optional(),
    studentId: UuidSchema.optional(),
    userId: UuidSchema.optional().describe("Filter by actor (the user who logged the activity)."),
    type: ActivityTypeSchema.optional(),
    dueBefore: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Filter tasks with due_at before this datetime (for SLA/overdue views)."),
    doneOnly: z.coerce.boolean().optional().describe("If true, return only tasks with done_at set."),
    pendingTasks: z
      .coerce.boolean()
      .optional()
      .describe("If true, return only pending tasks (type=task, done_at is null)."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListActivitiesQuery = z.infer<typeof ListActivitiesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Activity item for the timeline + tasks list. */
export const ActivityDetailSchema = z.object({
  id: UuidSchema,
  type: ActivityTypeSchema,
  payload: ActivityPayloadSchema,
  leadId: UuidSchema.nullable(),
  studentId: UuidSchema.nullable(),
  userId: UuidSchema.describe("Actor who logged this activity."),
  userName: z.string(),
  dueAt: IsoDateTimeSchema.nullable(),
  doneAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ActivityDetail = z.infer<typeof ActivityDetailSchema>;
