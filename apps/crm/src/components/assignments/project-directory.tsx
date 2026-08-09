// Project directory — kind=project assignments with milestone review pipeline.
// Faculty sees only projects in their assigned batches.
// Milestone review = grading individual milestones via GradeSubmissionDrawer.
import * as React from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { AssignmentSummary, MeResponse, MilestoneReviewState } from "@repo/types";

import { useAssignmentsList, useDeleteAssignment, useProjectDetail } from "../../hooks/use-assignments";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { GradeSubmissionDrawer } from "./grade-submission-drawer";

const OVERALL_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "warning" | "success"
> = {
  not_started: "neutral",
  in_progress: "info",
  under_review: "warning",
  graded: "success",
};

const OVERALL_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  under_review: "Under review",
  graded: "All graded",
};

interface ProjectDirectoryProps {
  me: MeResponse | undefined;
}

export function ProjectDirectory({ me }: ProjectDirectoryProps): React.JSX.Element {
  const canGrade = hasPermission(me?.permissions, "projects.review");
  const canDelete = hasPermission(me?.permissions, "assignments.edit");
  const { toast } = useToast();

  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [expandedProjectId, setExpandedProjectId] = React.useState<string | null>(null);
  const [gradingSubmissionId, setGradingSubmissionId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError, refetch, isFetching } = useAssignmentsList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    kind: "project",
  });

  // Load project detail (milestone states) when a project is expanded
  const {
    data: projectDetail,
    isLoading: projectDetailLoading,
    isError: projectDetailError,
  } = useProjectDetail(expandedProjectId ?? undefined);

  const deleteMutation = useDeleteAssignment();

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Project deleted", variant: "success" });
        setDeleteId(null);
        if (expandedProjectId === deleteId) setExpandedProjectId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete project", description: (err as Error).message, variant: "destructive" });
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<AssignmentSummary>> = [
    {
      id: "expand",
      header: "",
      cell: (row) => (
        <button
          type="button"
          aria-expanded={expandedProjectId === row.id}
          aria-label={`${expandedProjectId === row.id ? "Collapse" : "Expand"} ${row.title} milestones`}
          className="p-1 text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedProjectId(expandedProjectId === row.id ? null : row.id);
          }}
        >
          {expandedProjectId === row.id ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>
      ),
    },
    { id: "title", header: "Project", cell: (row) => row.title, sortable: true },
    { id: "lessonTitle", header: "Lesson", cell: (row) => row.lessonTitle },
    { id: "milestoneCount", header: "Milestones", cell: (row) => row.milestoneCount, align: "right" },
    { id: "maxScore", header: "Max score", cell: (row) => row.maxScore, align: "right" },
    {
      id: "dueAt",
      header: "Due date",
      cell: (row) => (row.dueAt ? new Date(row.dueAt).toLocaleDateString() : "No deadline"),
    },
    {
      id: "submissions",
      header: "Progress",
      cell: (row) => `${row.gradedCount}/${row.submissionCount} graded`,
      align: "right",
    },
    {
      id: "isFinal",
      header: "Final project",
      cell: (row) =>
        row.isFinal ? (
          <StatusChip tone="warning" label="Certificate gate" />
        ) : (
          <span className="text-fg-muted text-xs">No</span>
        ),
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: (row: AssignmentSummary) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteId(row.id);
                }}
                aria-label={`Delete project ${row.title}`}
                data-testid={`delete-assignment-${row.id}`}
              >
                <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
              </Button>
            ),
          } satisfies DataTableColumn<AssignmentSummary>,
        ]
      : []),
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="projects-error"
        title="Couldn't load projects"
        description="Something went wrong fetching the project list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="projects-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="projects-directory">
      <PageHeader
        title="Projects"
        description="Multi-milestone project review pipeline. Faculty review each milestone in their assigned batches."
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Project title"
        data-testid="projects-filter-bar"
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No projects yet",
          description: "Assign project-type assignments to batches to see them here.",
        }}
        caption="Project directory"
        data-testid="projects-table"
      />

      {/* Milestone review panel */}
      {expandedProjectId ? (
        <div
          className="flex flex-col gap-3 rounded-md border border-border p-4"
          data-testid="milestone-review-panel"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Milestone review</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpandedProjectId(null)}
              aria-label="Close milestone panel"
              data-testid="milestone-panel-close"
            >
              Close
            </Button>
          </div>

          {projectDetailLoading ? (
            <div className="flex flex-col gap-2" data-testid="milestone-panel-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
            </div>
          ) : projectDetailError ? (
            <EmptyState
              data-testid="milestone-panel-error"
              title="Couldn't load project detail"
              description="Something went wrong loading the milestone states."
            />
          ) : !projectDetail ? null : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">Overall status:</span>
                <StatusChip
                  tone={OVERALL_STATUS_TONE[projectDetail.overallStatus] ?? "neutral"}
                  label={OVERALL_STATUS_LABEL[projectDetail.overallStatus] ?? projectDetail.overallStatus}
                />
              </div>

              {projectDetail.milestoneStates.length === 0 ? (
                <p className="text-sm text-fg-muted">This project has no milestones defined.</p>
              ) : (
                <MilestoneReviewTable
                  milestoneStates={projectDetail.milestoneStates}
                  canGrade={canGrade}
                  onGrade={(submissionId) => setGradingSubmissionId(submissionId)}
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      {canGrade ? (
        <GradeSubmissionDrawer
          submissionId={gradingSubmissionId}
          assignmentId={expandedProjectId ?? undefined}
          onOpenChange={(open) => !open && setGradingSubmissionId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this project?"
        description="It will be soft-deleted. Existing milestone submissions are retained in the audit log."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-assignment"
      />
    </div>
  );
}

interface MilestoneReviewTableProps {
  milestoneStates: MilestoneReviewState[];
  canGrade: boolean;
  onGrade: (submissionId: string) => void;
}

function MilestoneReviewTable({
  milestoneStates,
  canGrade,
  onGrade,
}: MilestoneReviewTableProps): React.JSX.Element {
  const columns: Array<DataTableColumn<MilestoneReviewState>> = [
    { id: "order", header: "#", cell: (row) => row.milestone.order + 1, align: "right" },
    { id: "title", header: "Milestone", cell: (row) => row.milestone.title },
    {
      id: "dueAt",
      header: "Due",
      cell: (row) =>
        row.milestone.dueAt ? new Date(row.milestone.dueAt).toLocaleDateString() : "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) =>
        row.submissionStatus ? (
          <StatusChip
            tone={
              row.submissionStatus === "graded"
                ? "success"
                : row.submissionStatus === "submitted"
                  ? "info"
                  : "warning"
            }
            label={
              row.submissionStatus === "graded"
                ? "Graded"
                : row.submissionStatus === "submitted"
                  ? "Submitted"
                  : "Returned"
            }
          />
        ) : (
          <StatusChip tone="neutral" label="Not submitted" />
        ),
    },
    {
      id: "score",
      header: "Score",
      cell: (row) => (row.score !== null ? row.score : "—"),
      align: "right",
    },
    {
      id: "submittedAt",
      header: "Submitted",
      cell: (row) =>
        row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : "—",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={milestoneStates}
      getRowId={(row) => row.milestone.id}
      onRowClick={
        canGrade
          ? (row) => {
              if (row.submissionId) onGrade(row.submissionId);
            }
          : undefined
      }
      emptyState={{ title: "No milestones", description: "This project has no milestone states." }}
      caption="Milestone review states"
      data-testid="milestone-review-table"
    />
  );
}
