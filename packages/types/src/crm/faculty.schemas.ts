// Faculty contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// Same user+profile modeling decision as students.schemas.ts: creating
// faculty creates a `users` row (role `faculty`, status `invited`) + a 1:1
// `faculty_profiles` row in one transaction, one audit-log row keyed by the
// new faculty_profiles.id.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema, BooleanQueryFlagSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { BatchSummarySchema } from "./batches.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/faculty */
export const CreateFacultyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    expertise: z.array(z.string().min(1).max(80)).max(20).default([]),
    bio: z.string().max(2000).optional(),
    branchId: UuidSchema.optional(),
  })
  .strict();
export type CreateFacultyRequest = z.infer<typeof CreateFacultyRequestSchema>;

/** PATCH /api/v1/crm/faculty/:id */
export const UpdateFacultyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: PhoneSchema,
    expertise: z.array(z.string().min(1).max(80)).max(20),
    bio: z.string().max(2000),
    branchId: UuidSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateFacultyRequest = z.infer<typeof UpdateFacultyRequestSchema>;

/** GET /api/v1/crm/faculty — filter by branch/expertise (docs/03 §7.3). */
export const ListFacultyQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Matches name or email."),
    branchId: UuidSchema.optional(),
    expertise: z.string().min(1).max(80).optional().describe("Matches one entry in the expertise array."),
    includeDeleted: BooleanQueryFlagSchema.default(false),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListFacultyQuery = z.infer<typeof ListFacultyQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const FacultySummarySchema = z.object({
  id: UuidSchema.describe("faculty_profiles.id — referenced by batches.facultyId."),
  userId: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  expertise: z.array(z.string()),
  rating: z.number().nullable(),
  branchId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type FacultySummary = z.infer<typeof FacultySummarySchema>;

export const FacultyDetailSchema = FacultySummarySchema.extend({
  bio: z.string().nullable(),
  deletedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  /** Batches currently assigned to this faculty (docs/03 §7.3 "assigned batches view"). */
  assignedBatches: z.array(BatchSummarySchema),
});
export type FacultyDetail = z.infer<typeof FacultyDetailSchema>;

/** POST /api/v1/crm/faculty/:id/restore */
export const RestoreFacultyRequestSchema = z.object({}).strict();
export type RestoreFacultyRequest = z.infer<typeof RestoreFacultyRequestSchema>;

/**
 * POST /api/v1/crm/faculty/:id/reset-password — admin-triggered credential reset for a
 * faculty member's CRM login. Mirrors students.schemas.ts `ResendCredentialsResponseSchema`
 * (same `{ email }` shape) but kept as its own schema so the faculty module stays
 * self-contained (see faculty.service.ts `resetPassword` — a staff-triggered password
 * rotation + forced mustChangePassword + session revocation + email, NOT delegated to the
 * student-profile-coupled LmsAccountProvisioningService).
 */
export const FacultyResetPasswordResponseSchema = z.object({
  email: z.string().email().describe("The address the reset temporary-password email was sent to."),
});
export type FacultyResetPasswordResponse = z.infer<typeof FacultyResetPasswordResponseSchema>;
