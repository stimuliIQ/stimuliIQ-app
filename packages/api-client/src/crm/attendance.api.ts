// Typed CRM attendance-editor SDK — Phase-9-completion gap #6. Closes the "attendance
// is read-only" gap flagged in apps/crm/src/components/attendance/batch-attendance-
// roster.tsx. Student own-scope READ lives on `client.lms.attendance.list()` — this is
// the staff WRITE counterpart. Exposed as `client.crm.attendance.*`.

import type { AttendanceRecord, SetAttendanceRequest } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class AttendanceCrmApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * PATCH /api/v1/crm/attendance
   *
   * Set/correct a student's attendance for a (enrollment, lesson) pair. Faculty
   * (scope: assigned) may only correct attendance for enrollments in batches they
   * teach; admin/super_admin (scope: all) may correct any. AUDITED.
   *
   * Permission: attendance.edit (scope: assigned|all).
   */
  async set(body: SetAttendanceRequest, idempotencyKey: string = crypto.randomUUID()): Promise<AttendanceRecord> {
    return this.client.request<AttendanceRecord>("PATCH", "/api/v1/crm/attendance", { body, idempotencyKey });
  }
}
