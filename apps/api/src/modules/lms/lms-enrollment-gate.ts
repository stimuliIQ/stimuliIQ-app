// apps/api/src/modules/lms/lms-enrollment-gate.ts
//
// THE ENROLLMENT-SCOPE GATE — the single point of truth for content access control.
//
// resolveEnrollmentForLesson(userId, tenantId, lessonId) is the ONE GATE that every
// content endpoint (curriculum, lesson-detail, stream-url) MUST pass through before
// returning any content or minting any URL.
//
// This function is EXPORTED at the module boundary so that Wave 4b (progress/attendance
// service) can import and reuse it WITHOUT inventing a second, diverging gate.
//
// ─── GATE LOGIC ──────────────────────────────────────────────────────────────────
//
//   1. Resolve the lesson → module → program chain.
//   2. Resolve the student profile for the userId (userId → student_profiles.id).
//   3. Find an ACTIVE enrollment for (student, program).
//   4. A lesson is accessible if:
//        a) The student has an active own enrollment in the lesson's program (ENROLLED).
//        b) OR the lesson has is_preview=true (PREVIEW — open to any authenticated user).
//   5. Returns:
//        { enrollment: EnrollmentRow }   — enrolled student (use enrollment for progress scoping)
//        { enrollment: null }            — preview-only access (no enrollment)
//        null                            — no access (not enrolled, not preview → 404/403)
//
// ─── SECURITY CONTRACT ────────────────────────────────────────────────────────────
//
//   - The gate NEVER trusts a client-supplied enrollmentId or programId.
//     It resolves the chain from the lessonId (which is a path parameter the user
//     "knows" but cannot fake for a lesson they own access to).
//   - IDOR: if the lesson exists but the student is not enrolled AND it is not preview,
//     the gate returns null (caller returns 404, not 403, to avoid existence disclosure).
//   - Cross-student: it resolves studentProfileId from req.user.id (the JWT subject),
//     never from the client body/query. A student cannot impersonate another student.
//   - Tenant isolation: every query is tenant-scoped.
//
// ─── WAVE 4b HANDOFF ─────────────────────────────────────────────────────────────
//
//   Wave 4b (progress + attendance) MUST import `resolveEnrollmentForLesson` from
//   this file and call it before any write. Do NOT copy the logic; import the function.
//   The enrollment row it returns carries the enrollmentId needed to upsert lesson_progress
//   via the `(enrollment_id, lesson_id)` unique key.
//
//   Usage pattern for Wave 4b:
//     const result = await resolveEnrollmentForLesson(userId, tenantId, lessonId, repo);
//     if (!result) throw new NotFoundException(...); // 404 if not enrolled + not preview
//     if (!result.enrollment) {
//       // Preview: student may VIEW but cannot write progress (no enrollment).
//       throw new ForbiddenException('Cannot write progress for a preview lesson without enrollment');
//     }
//     const { enrollment } = result; // Use enrollment.id for upsert target.

import type { LmsRepository, EnrollmentRow } from "./lms.repository";

// ─────────────────────────────────────────────────────────────────────────────
// Result shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The result of the enrollment gate check.
 * - `enrollment`: the active enrollment row (for progress scoping), or null for preview access.
 * - `lessonProgramId`: the program id the lesson belongs to (always resolved).
 * - `isPreview`: whether the lesson is a preview (open access) lesson.
 */
export interface EnrollmentGateResult {
  enrollment: EnrollmentRow | null;
  lessonProgramId: string;
  isPreview: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EXPORTED SINGLE-GATE: resolves lesson → module → program → student enrollment.
 *
 * Returns:
 *   { enrollment: EnrollmentRow, lessonProgramId, isPreview: false }
 *     — fully enrolled student; use enrollment for progress scoping.
 *   { enrollment: null, lessonProgramId, isPreview: true }
 *     — preview lesson; user may view but has no enrollment to write progress against.
 *   null
 *     — not enrolled and not preview → caller MUST 404 (no existence disclosure).
 *
 * @param userId     — req.user.id (JWT subject; the authenticated user's id).
 * @param tenantId   — req.user.tenantId (from JWT; never trust client body).
 * @param lessonId   — from path param (the lesson to check access for).
 * @param repo       — LmsRepository instance (injected by the service).
 */
export async function resolveEnrollmentForLesson(
  userId: string,
  tenantId: string,
  lessonId: string,
  repo: LmsRepository,
): Promise<EnrollmentGateResult | null> {
  // Step 1: Resolve lesson → module → program (TENANT-SCOPED — Wave 7 M-1).
  const lesson = await repo.findLessonById(tenantId, lessonId);
  if (!lesson) {
    // Lesson doesn't exist at all — return null (caller 404s).
    return null;
  }

  const programId = lesson.module.program.id;
  const isPreview = lesson.isPreview;

  // Step 2: Resolve the student profile for this user.
  const studentId = await repo.findStudentProfileId(tenantId, userId);

  // Step 3: Look for an active enrollment in the lesson's program.
  let enrollment: EnrollmentRow | null = null;
  if (studentId) {
    enrollment = await repo.findActiveEnrollmentForProgram(tenantId, studentId, programId);
  }

  // Step 4: Gate decision.
  if (enrollment) {
    // ENROLLED — full access.
    return { enrollment, lessonProgramId: programId, isPreview };
  }

  if (isPreview) {
    // PREVIEW — open access without enrollment.
    return { enrollment: null, lessonProgramId: programId, isPreview: true };
  }

  // NOT ENROLLED AND NOT PREVIEW — deny (null → caller 404s).
  return null;
}
