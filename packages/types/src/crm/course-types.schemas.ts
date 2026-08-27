// Course types — the list of qualifications a student record can carry.
//
// WHY THIS FILE EXISTS: `courseType` used to be a Postgres enum
// (`StudentCourseType`: btech/degree/diploma/mca/mba/other) mirrored by a zod `z.enum` here
// and by four hand-copied `{ value, label }` arrays in the CRM. It was written for the
// original B.Tech/MCA/MBA audience; changing it meant a migration, a contract change, four
// UI edits and a deploy. So it never changed, and the real answer went into "Other".
//
// It is now CRM-managed DATA (`model CourseType`, table `course_types`) — staff add,
// rename, reorder and hide qualifications from Admin ▸ Course types with no deploy. Same
// call, for the same reason, as the P12 onboarding form's CRM-authored questions: a list of
// options has no shape a non-engineer can break, unlike a marketing page (P11 locked
// templates), which does.
//
// STORAGE: `student_profiles.course_type` holds the option's `key` (a slug), NOT a foreign
// key. The key is immutable and the label is the only mutable half, so renaming "B.Tech" to
// "MBBS" is a rename of the OPTION and never a silent rewrite of what an existing student is
// recorded as. A student may therefore hold a key whose option has since been hidden — that
// is history, and reads must render it rather than drop it.
//
// PERMISSIONS: reading the list needs `students.view` — everyone who can open the student
// directory or the create-student dialog needs the dropdown, and the list is not sensitive.
// Editing it needs its own `course_types.manage` key (admin + super_admin), because
// renaming an option changes what every screen and export says about existing students.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema, BooleanQueryFlagSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Key + label primitives
// ─────────────────────────────────────────────────────────────────────────

/**
 * The stored value. Lowercase snake_case so it is safe in a CSV export, a URL query and a
 * saved view's filter JSON, and so it stays readable when it turns up in a raw DB row.
 * Generated from the label on create (see `slugifyCourseTypeKey`) and never editable
 * afterwards — every student row already recorded with it depends on it not moving.
 */
export const CourseTypeKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "Use lowercase letters, numbers and underscores");

export const CourseTypeLabelSchema = z.string().trim().min(1).max(80);

/**
 * What `student_profiles.course_type` carries on the wire. Deliberately a plain key rather
 * than a closed `z.enum`: the valid set now lives in the database, so it is the API that
 * checks membership (422 `course_types.unknown`), not this schema. Kept under the historic
 * `CourseTypeSchema` name so the ~40 call sites that already import it keep working.
 */
export const CourseTypeSchema = CourseTypeKeySchema;
export type CourseType = z.infer<typeof CourseTypeSchema>;

/**
 * Label -> key. Shared by the CRM (to preview the key it is about to create) and the API
 * (which generates the real one), so both agree on the answer — same one-definition rule as
 * `computeLeaveDuration` (P13) and `buildOnboardingAnswerIssues` (P12).
 *
 * "B.Tech" -> "b_tech", "M.Sc Nursing" -> "m_sc_nursing", "Allied Health" -> "allied_health".
 * Returns "" when the label has no usable characters at all; callers treat that as invalid.
 */
export function slugifyCourseTypeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
}

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/crm/course-types`. The key is DERIVED from the label server-side, never
 * supplied: a caller-chosen key is a second name for the same thing and the two drift.
 */
export const CreateCourseTypeRequestSchema = z
  .object({
    label: CourseTypeLabelSchema,
    sortOrder: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateCourseTypeRequest = z.infer<typeof CreateCourseTypeRequestSchema>;

/**
 * `PATCH /api/v1/crm/course-types/:id`. `key` is absent on purpose — see the file header.
 */
export const UpdateCourseTypeRequestSchema = z
  .object({
    label: CourseTypeLabelSchema,
    sortOrder: z.number().int().min(0).max(9999),
    active: z.boolean().describe("false hides the option from every picker; existing students keep it."),
  })
  .partial()
  .strict();
export type UpdateCourseTypeRequest = z.infer<typeof UpdateCourseTypeRequestSchema>;

/** `GET /api/v1/crm/course-types`. */
export const ListCourseTypesQuerySchema = z
  .object({
    activeOnly: BooleanQueryFlagSchema.default(false).describe(
      "Pickers pass true; the management screen passes false so hidden options stay editable.",
    ),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCourseTypesQuery = z.infer<typeof ListCourseTypesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTO
// ─────────────────────────────────────────────────────────────────────────

export const CourseTypeOptionSchema = z.object({
  id: UuidSchema,
  key: CourseTypeKeySchema,
  label: CourseTypeLabelSchema,
  sortOrder: z.number().int(),
  active: z.boolean(),
  /**
   * How many non-deleted students currently hold this key. The management screen uses it to
   * say what hiding an option affects, and to refuse deleting one that is in use — a delete
   * that orphans rows silently is how a student's qualification turns into a raw slug.
   */
  studentCount: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type CourseTypeOption = z.infer<typeof CourseTypeOptionSchema>;

/**
 * Render helper: the label for a stored key, falling back to the key itself when the option
 * has since been hidden or deleted. Never returns an empty string for a set value, and never
 * invents a label for an unset one.
 */
export function courseTypeLabel(
  key: string | null | undefined,
  options: readonly Pick<CourseTypeOption, "key" | "label">[],
): string | null {
  if (!key) return null;
  return options.find((option) => option.key === key)?.label ?? key;
}
