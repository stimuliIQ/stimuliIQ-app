// Student 360 — Attendance tab.
//
// `attendance` rows have been written since P3 — one per completed lesson
// (source=recorded, deduped per enrollment+lesson) and one per live-class join
// (source=live) — and until now nothing on the STAFF side could read them. There was no
// CRM endpoint, no SDK method and no screen, so the Student 360 drawer shipped without
// the Attendance tab that docs/03 §7 and the go-live checklist both describe as done.
//
// Read-only on purpose: this answers "did they turn up". Editing a register is a separate
// act with its own audit story and does not belong behind a drawer tab.
import * as React from "react";
import { DataTable, type DataTableColumn, StatusChip, Button } from "@repo/ui";
import type { StudentAttendanceItem } from "@repo/types";

import { useStudentAttendance } from "../../hooks/use-students";
import { queryErrorMessage } from "../../lib/surface-error";

export function StudentAttendanceTab({ studentId }: { studentId: string }): React.JSX.Element {
  const [page, setPage] = React.useState(1);
  const { data, isLoading, isError, error, refetch } = useStudentAttendance(studentId, page);

  const rows = data?.items ?? [];
  const meta = data?.meta;

  const columns: Array<DataTableColumn<StudentAttendanceItem>> = [
    {
      id: "markedAt",
      header: "When",
      cell: (row) =>
        new Date(row.markedAt).toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      id: "session",
      header: "Session",
      // A row is either a live class or a recorded lesson — never both, and never
      // neither. Showing whichever it is beats two mostly-empty columns.
      cell: (row) => row.liveClassTitle ?? row.lessonTitle ?? "-",
    },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName ?? "-" },
    {
      id: "source",
      header: "Source",
      cell: (row) => (
        <StatusChip
          tone="neutral"
          size="sm"
          label={row.source === "live" ? "Live class" : "Recorded"}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusChip
          tone={row.status === "present" ? "success" : "danger"}
          size="sm"
          label={row.status === "present" ? "Present" : "Absent"}
        />
      ),
    },
  ];

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-danger">{queryErrorMessage(error, "Couldn't load attendance.")}</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="student-attendance">
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        loading={isLoading}
        caption="Student attendance"
        emptyState={{
          title: "No attendance yet",
          description:
            "Attendance is recorded when this student completes a lesson or joins a live class.",
        }}
        data-testid="student-attendance-table"
      />
      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
          <span>
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!meta.hasMore || isLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
