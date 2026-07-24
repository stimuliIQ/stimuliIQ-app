// Batch completion panel (WS-3, docs/specs/phase-8-mentor.md) — the rollup
// summary (headcount buckets + %complete + supplementary milestone %s) plus
// a paginated per-student breakdown, reusing `EligibilityResult` VERBATIM
// (AC-33) — never re-derived client-side. Mark-complete is informational-only
// gated (Rule M-2/AC-41: the numbers are shown, never block the transition)
// and requires `batches.markComplete`, shown only while the batch is active
// (`summary.canTransitionToComplete`). Renders inside batch-detail-drawer.tsx's
// "Completion" tab — the exact same component the mentor-facing dashboard's
// staff-equivalent view reads (AC-52).
import * as React from "react";
import { ApiError } from "@repo/api-client";
import { CheckCircle2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  KpiCard,
  ProgressBar,
  Select,
  SelectItem,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { BatchCompletionBucket, BatchCompletionStudentRow, MeResponse } from "@repo/types";

import { useBatchCompletion, useBatchCompletionStudents, useMarkBatchComplete } from "../../hooks/use-batch-completion";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface BatchCompletionPanelProps {
  batchId: string;
  me: MeResponse | undefined;
}

const BUCKET_LABEL: Record<BatchCompletionBucket, string> = {
  certified: "Certified",
  eligibleNotIssued: "Eligible, not issued",
  inProgress: "In progress",
  dropped: "Dropped",
};

const BUCKET_TONE: Record<BatchCompletionBucket, "success" | "info" | "neutral" | "warning"> = {
  certified: "success",
  eligibleNotIssued: "info",
  inProgress: "neutral",
  dropped: "warning",
};

export function BatchCompletionPanel({ batchId, me }: BatchCompletionPanelProps): React.JSX.Element {
  const canMarkComplete = hasPermission(me?.permissions, "batches.markComplete");
  const { toast } = useToast();

  const [bucket, setBucket] = React.useState<BatchCompletionBucket | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [bucket]);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryIsError,
    error: summaryError,
    refetch: refetchSummary,
  } = useBatchCompletion(batchId);
  const {
    data: students,
    isLoading: studentsLoading,
    isError: studentsIsError,
    error: studentsError,
    refetch: refetchStudents,
    isFetching: studentsFetching,
  } = useBatchCompletionStudents(batchId, { page, pageSize, bucket });
  const markComplete = useMarkBatchComplete();

  const handleMarkComplete = async () => {
    try {
      const result = await markComplete.mutateAsync(batchId);
      toast({
        title: "Batch marked complete",
        description: `${result.summary.batchName} is now marked complete.`,
        variant: "success",
      });
      setConfirmOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.problem.code === "BATCH_NOT_ACTIVE") {
        toast({
          title: "Can't mark this batch complete",
          description: "Only a batch with status Active can be marked complete.",
          variant: "destructive",
        });
      } else if (error instanceof ApiError && error.problem.code === "ALREADY_COMPLETED") {
        toast({
          title: "Already completed",
          description: "This batch has already been marked complete.",
          variant: "destructive",
        });
      } else {
        surfaceError(toast, error, "Couldn't mark this batch complete");
      }
      setConfirmOpen(false);
    }
  };

  const columns: Array<DataTableColumn<BatchCompletionStudentRow>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    {
      id: "bucket",
      header: "Bucket",
      cell: (row) => <StatusChip tone={BUCKET_TONE[row.bucket]} label={BUCKET_LABEL[row.bucket]} />,
    },
    {
      id: "completion",
      header: "Completion",
      cell: (row) => `${row.eligibility.reasons.completionPct}%`,
      align: "right",
    },
    {
      id: "assessments",
      header: "Assessments",
      cell: (row) => (
        <StatusChip
          tone={row.eligibility.reasons.requiredAssessmentsPassed ? "success" : "neutral"}
          label={row.eligibility.reasons.requiredAssessmentsPassed ? "Passed" : "Pending"}
        />
      ),
    },
    {
      id: "project",
      header: "Final project",
      cell: (row) => (
        <StatusChip
          tone={row.eligibility.reasons.finalProjectApproved ? "success" : "neutral"}
          label={row.eligibility.reasons.finalProjectApproved ? "Approved" : "Pending"}
        />
      ),
    },
    {
      id: "certificate",
      header: "Certificate",
      cell: (row) =>
        row.certificateStatus ? (
          <StatusChip
            tone={row.certificateStatus === "valid" ? "success" : "danger"}
            label={row.certificateStatus === "valid" ? "Issued" : "Revoked"}
          />
        ) : (
          <span className="text-xs text-fg-muted">Not issued</span>
        ),
    },
  ];

  if (summaryIsError) {
    return (
      <EmptyState
        data-testid="batch-completion-error"
        title="Couldn't load the completion rollup"
        description={queryErrorMessage(summaryError, "Something went wrong fetching this batch's completion data.")}
        action={
          <Button variant="secondary" onClick={() => refetchSummary()} data-testid="batch-completion-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {summary?.completedAt ? (
        <Alert tone="success" icon={<CheckCircle2 />} data-testid="batch-completion-completed-banner">
          This batch was marked complete on {new Date(summary.completedAt).toLocaleDateString()}.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Active students" value={summary?.totalActive ?? "—"} loading={summaryLoading} data-testid="completion-kpi-total" />
        <KpiCard label="Certified" value={summary?.certified ?? "—"} loading={summaryLoading} data-testid="completion-kpi-certified" />
        <KpiCard
          label="Eligible, not issued"
          value={summary?.eligibleNotIssued ?? "—"}
          loading={summaryLoading}
          data-testid="completion-kpi-eligible"
        />
        <KpiCard label="In progress" value={summary?.inProgress ?? "—"} loading={summaryLoading} data-testid="completion-kpi-inprogress" />
        <KpiCard label="Dropped" value={summary?.dropped ?? "—"} loading={summaryLoading} data-testid="completion-kpi-dropped" />
      </div>

      <div className="rounded-md border border-border p-4" data-testid="completion-percent-block">
        <p className="mb-2 text-sm font-medium text-fg">Overall completion</p>
        <ProgressBar
          value={summary?.percentComplete ?? 0}
          showLabel
          label="Batch completion percentage"
          data-testid="completion-progress-bar"
        />
        {summary && summary.percentComplete == null ? (
          <p className="mt-1 text-xs text-fg-muted">No active enrollments yet.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Assignments submitted"
          value={summary?.assignmentsSubmittedPct != null ? `${summary.assignmentsSubmittedPct.toFixed(0)}%` : "—"}
          loading={summaryLoading}
          data-testid="completion-kpi-assignments"
        />
        <KpiCard
          label="Assessments passed"
          value={summary?.assessmentsPassedPct != null ? `${summary.assessmentsPassedPct.toFixed(0)}%` : "—"}
          loading={summaryLoading}
          data-testid="completion-kpi-assessments"
        />
        <KpiCard
          label="Final project approved"
          value={summary?.finalProjectApprovedPct != null ? `${summary.finalProjectApprovedPct.toFixed(0)}%` : "—"}
          loading={summaryLoading}
          data-testid="completion-kpi-project"
        />
      </div>

      {canMarkComplete && summary?.canTransitionToComplete ? (
        <div>
          <Button onClick={() => setConfirmOpen(true)} data-testid="batch-mark-complete-button">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Mark batch complete
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">Students</h2>
          <Select
            label="Bucket"
            placeholder="All"
            value={bucket}
            onValueChange={(value) => setBucket(value === "__all__" ? undefined : (value as BatchCompletionBucket))}
            wrapperClassName="w-56"
            data-testid="completion-bucket-filter"
          >
            <SelectItem value="__all__">All</SelectItem>
            {(Object.keys(BUCKET_LABEL) as BatchCompletionBucket[]).map((b) => (
              <SelectItem key={b} value={b}>
                {BUCKET_LABEL[b]}
              </SelectItem>
            ))}
          </Select>
        </div>

        {studentsIsError ? (
          <EmptyState
            data-testid="completion-students-error"
            title="Couldn't load students"
            description={queryErrorMessage(studentsError, "Something went wrong fetching the per-student breakdown.")}
            action={
              <Button variant="secondary" onClick={() => refetchStudents()} data-testid="completion-students-retry">
                Try again
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={students?.items ?? []}
            getRowId={(row) => row.enrollmentId}
            loading={studentsLoading || studentsFetching}
            pagination={{
              page,
              pageSize,
              total: students?.meta.total ?? 0,
              onPageChange: setPage,
            }}
            emptyState={{
              title: "No students in this bucket",
              description: "Try a different bucket filter, or check back once students enroll.",
            }}
            caption="Batch completion — per-student breakdown"
            data-testid="completion-students-table"
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Mark this batch complete?"
        description={
          summary
            ? `${summary.totalActive} active student(s), ${summary.percentComplete ?? 0}% average completion. This does not require 100% completion — it's an operational "this program run has ended" milestone and cannot be undone from here.`
            : "This is an operational milestone and cannot be undone from here."
        }
        confirmLabel="Mark complete"
        loading={markComplete.isPending}
        onConfirm={handleMarkComplete}
        data-testid="batch-mark-complete-confirm"
      />
    </div>
  );
}
