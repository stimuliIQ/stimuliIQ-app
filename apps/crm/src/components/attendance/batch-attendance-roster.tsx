// Academics > Attendance — batch roster + aggregate attendance %.
//
// GAP: there is no per-student attendance RECORD editing endpoint anywhere
// in the API (LMS `me/attendance` is student-own-scope READ ONLY, created
// as a server-side side-effect of lesson completion — see
// packages/api-client/src/lms/attendance.api.ts file header; `crm/reports/
// attendance` is a read-only batch-level AGGREGATE). A true "attendance
// editor" needs a new backend surface (present/absent per student per
// session) that doesn't exist yet — flagged as a follow-up. This screen is
// therefore the most useful REAL thing buildable today: pick a batch, see
// its roster (real data) alongside the batch's real aggregate attendance %,
// with an explicit banner instead of a fake/silent "edit" affordance.
import * as React from "react";
import { Alert, DataTable, type DataTableColumn, EmptyState, KpiCard, PageHeader, Select, SelectItem, StatusChip } from "@repo/ui";
import type { BatchRosterEntry, EnrollmentStatus, MeResponse } from "@repo/types";
import { CalendarCheck, TriangleAlert } from "lucide-react";

import { useBatchesList, useBatchRoster } from "../../hooks/use-batches";
import { useAttendanceReport } from "../../hooks/use-reports";
import { hasPermission } from "../../lib/permissions";

const STATUS_TONE: Record<EnrollmentStatus, "success" | "info" | "danger"> = {
  active: "success",
  completed: "info",
  dropped: "danger",
};

export function BatchAttendanceRoster({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "reports.attendance.view") || hasPermission(me?.permissions, "batches.view");
  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);

  const { data: batches } = useBatchesList({ page: 1, pageSize: 200, status: "active", includeDeleted: false });
  const roster = useBatchRoster(batchId);
  const attendance = useAttendanceReport({ batchId }, Boolean(batchId));

  const columns: Array<DataTableColumn<BatchRosterEntry>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "studentEmail", header: "Email", cell: (row) => row.studentEmail },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    { id: "progressPct", header: "Course progress", cell: (row) => `${row.progressPct}%`, align: "right" },
  ];

  if (!canView) {
    return <EmptyState title="You don't have access to attendance" description="Ask an Admin/Owner for a batches/reports permission." />;
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="batch-attendance-roster">
      <PageHeader
        title="Attendance"
        description="Batch roster and aggregate attendance. Select a batch to drill in."
      />

      <Alert tone="warning" icon={<TriangleAlert />}>
        Individual per-session present/absent editing isn't available yet — attendance is recorded automatically when a
        student completes a lesson. This view shows the batch roster and the aggregate attendance %.
      </Alert>

      <Select
        label="Batch"
        placeholder="Select a batch"
        value={batchId}
        onValueChange={setBatchId}
        wrapperClassName="w-64"
        data-testid="batch-attendance-batch-select"
      >
        {(batches?.items ?? []).map((batch) => (
          <SelectItem key={batch.id} value={batch.id}>
            {batch.name} — {batch.programTitle}
          </SelectItem>
        ))}
      </Select>

      {!batchId ? (
        <EmptyState title="Select a batch" description="Choose a batch above to see its roster and attendance." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiCard
              label="Attendance %"
              value={attendance.data ? `${attendance.data.attendancePercent.toFixed(1)}%` : "—"}
              icon={<CalendarCheck />}
              loading={attendance.isLoading}
              data-testid="batch-attendance-percent-kpi"
            />
            <KpiCard
              label="Present / total sessions"
              value={attendance.data ? `${attendance.data.presentCount} / ${attendance.data.totalCount}` : "—"}
              loading={attendance.isLoading}
            />
          </div>

          <DataTable
            columns={columns}
            rows={roster.data ?? []}
            getRowId={(row) => row.enrollmentId}
            loading={roster.isLoading}
            caption="Batch roster"
            emptyState={{ title: "No students enrolled", description: "This batch has no roster yet." }}
            data-testid="batch-attendance-roster-table"
          />
        </>
      )}
    </div>
  );
}
