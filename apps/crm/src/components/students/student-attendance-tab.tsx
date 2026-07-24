// Student 360 — Attendance tab (Phase 9 Completion T37).
//
// GAP: there is no per-student attendance-record list endpoint on the CRM
// surface — `GET /api/v1/me/attendance` (packages/api-client/src/lms/
// attendance.api.ts) is STUDENT-OWN-SCOPE ONLY ("the student can only READ
// their own attendance records"), and `crm/reports/attendance` is a
// BATCH-level aggregate (present/total %), not a per-student record list.
// This tab therefore shows the batch-level attendance % for the student's
// active batch (a real, honest number — just not individually attributed)
// via the existing WS-A4 attendance report, with a clear label. A true
// per-student CRM attendance view needs a new backend endpoint (flagged as a
// follow-up).
import * as React from "react";
import { EmptyState, KpiCard, Skeleton } from "@repo/ui";
import { CalendarCheck } from "lucide-react";

import { useEnrollmentsList } from "../../hooks/use-enrollments";
import { useAttendanceReport } from "../../hooks/use-reports";

export function StudentAttendanceTab({ studentId }: { studentId: string }): React.JSX.Element {
  const enrollments = useEnrollmentsList({ studentId, page: 1, pageSize: 20 });
  const activeEnrollment = enrollments.data?.items.find((e) => e.status === "active") ?? enrollments.data?.items[0];

  const attendance = useAttendanceReport({ batchId: activeEnrollment?.batchId }, Boolean(activeEnrollment));

  if (enrollments.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading attendance">
        <Skeleton shape="line" />
        <Skeleton shape="block" />
      </div>
    );
  }

  if (!activeEnrollment) {
    return (
      <EmptyState
        title="No batch to report on"
        description="This student isn't enrolled in a batch yet, so there's no attendance to show."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="student-attendance-tab">
      <p className="text-xs text-fg-muted">
        Batch-level attendance for {activeEnrollment.batchName} — there is no per-student attendance record view yet
        (CRM only has the aggregate report; the student can see their own record history in the LMS).
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          label={`Attendance — ${activeEnrollment.batchName}`}
          value={attendance.data ? `${attendance.data.attendancePercent.toFixed(1)}%` : "—"}
          icon={<CalendarCheck />}
          loading={attendance.isLoading}
          error={attendance.isError ? "Couldn't load" : undefined}
          data-testid="student-attendance-kpi"
        />
        <KpiCard
          label="Sessions present / total"
          value={attendance.data ? `${attendance.data.presentCount} / ${attendance.data.totalCount}` : "—"}
          loading={attendance.isLoading}
        />
      </div>
    </div>
  );
}
