// Assignment directory — assigned-batch scoped list with submissions sub-view.
// Faculty sees only assignments in their assigned batches (the API enforces this;
// the UI just reflects the returned data). RBAC-aware: Create only with
// assignments.create; grade only with submissions.grade.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { AssignmentKind, AssignmentSummary, MeResponse } from "@repo/types";

import { useAssignmentsList, useDeleteAssignment, useSubmissionsList } from "../../hooks/use-assignments";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { AssignmentFormDrawer } from "./assignment-form-drawer";
import { GradeSubmissionDrawer } from "./grade-submission-drawer";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

const KIND_OPTIONS: { value: AssignmentKind; label: string }[] = [
  { value: "assignment", label: "Assignment" },
  { value: "project", label: "Project" },
];

interface AssignmentDirectoryProps {
  me: MeResponse | undefined;
  /** If provided, only show kind=project assignments */
  kindFilter?: AssignmentKind;
  title?: string;
  description?: string;
}

export function AssignmentDirectory({
  me,
  kindFilter,
  title = "Assignments",
  description = "Faculty-authored assignments and their submission queues.",
}: AssignmentDirectoryProps): React.JSX.Element {
  const assignmentPermissions = getModulePermissions(me, "assignments");
  const canGrade = hasPermission(me?.permissions, "submissions.grade");
  const canDelete = hasPermission(me?.permissions, "assignments.edit");
  const { toast } = useToast();

  const [search, setSearch] = React.useState("");
  const [kind, setKind] = React.useState<AssignmentKind | undefined>(kindFilter);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = React.useState<string | null>(null);
  const [gradingSubmissionId, setGradingSubmissionId] = React.useState<string | null>(null);
  const [selectedMaxScore, setSelectedMaxScore] = React.useState<number>(100);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, kind]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAssignmentsList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    kind,
  });

  // Submissions list for the selected assignment
  const {
    data: submissionsData,
    isLoading: submissionsLoading,
    isError: submissionsError,
    error: submissionsFetchError,
    refetch: refetchSubmissions,
  } = useSubmissionsList(selectedAssignmentId ?? undefined, { page: 1, pageSize: 50 });

  const deleteMutation = useDeleteAssignment();

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Assignment deleted", variant: "success" });
        setDeleteId(null);
        if (selectedAssignmentId === deleteId) setSelectedAssignmentId(null);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to delete assignment");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<AssignmentSummary>> = [
    { id: "title", header: "Assignment", cell: (row) => row.title, sortable: true },
    { id: "lessonTitle", header: "Lesson", cell: (row) => row.lessonTitle },
    {
      id: "kind",
      header: "Kind",
      cell: (row) => (
        <StatusChip
          tone={row.kind === "project" ? "info" : "neutral"}
          label={row.kind === "project" ? "Project" : "Assignment"}
        />
      ),
    },
    { id: "maxScore", header: "Max score", cell: (row) => row.maxScore, align: "right" },
    {
      id: "dueAt",
      header: "Due date",
      cell: (row) => (row.dueAt ? new Date(row.dueAt).toLocaleDateString() : "No deadline"),
    },
    {
      id: "submissions",
      header: "Submissions",
      cell: (row) => `${row.gradedCount}/${row.submissionCount} graded`,
      align: "right",
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
                aria-label={`Delete assignment ${row.title}`}
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
        data-testid="assignments-error"
        title="Couldn't load assignments"
        description={queryErrorMessage(error, "Something went wrong fetching the assignment list.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="assignments-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const selectedAssignment = data?.items.find((a) => a.id === selectedAssignmentId);

  return (
    <div className="space-y-4 md:space-y-5" data-testid="assignments-directory">
      <PageHeader
        title={title}
        description={description}
        actions={
          assignmentPermissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="assignments-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add {kindFilter === "project" ? "project" : "assignment"}
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Assignment title"
        data-testid="assignments-filter-bar"
      >
        {!kindFilter ? (
          <Select
            label="Kind"
            placeholder="All kinds"
            value={kind}
            onValueChange={(value) => setKind(value === "__all__" ? undefined : (value as AssignmentKind))}
            wrapperClassName="w-44"
            data-testid="assignments-kind-filter"
          >
            <SelectItem value="__all__">All kinds</SelectItem>
            {KIND_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </Select>
        ) : null}
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => {
          setSelectedAssignmentId(row.id === selectedAssignmentId ? null : row.id);
          setSelectedMaxScore(row.maxScore);
        }}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: `No ${kindFilter ?? "assignments"} yet`,
          description: "Try adjusting your filters, or create the first assignment.",
        }}
        caption="Assignment directory"
        data-testid="assignments-table"
      />

      {/* Submissions panel (inline below table when an assignment is selected) */}
      {selectedAssignmentId ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4" data-testid="submissions-panel">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              Submissions for: {selectedAssignment?.title ?? "…"}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAssignmentId(null)}
              aria-label="Close submissions panel"
              data-testid="submissions-panel-close"
            >
              Close
            </Button>
          </div>
          {submissionsError ? (
            <EmptyState
              data-testid="submissions-error"
              title="Couldn't load submissions"
              description={queryErrorMessage(submissionsFetchError, "Something went wrong fetching submissions.")}
              action={
                <Button variant="secondary" size="sm" onClick={() => refetchSubmissions()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <DataTable
              columns={[
                { id: "studentName", header: "Student", cell: (row) => row.studentName },
                {
                  id: "status",
                  header: "Status",
                  cell: (row) => (
                    <StatusChip
                      tone={
                        row.status === "graded"
                          ? "success"
                          : row.status === "submitted"
                            ? "info"
                            : "warning"
                      }
                      label={
                        row.status === "graded"
                          ? "Graded"
                          : row.status === "submitted"
                            ? "Submitted"
                            : "Returned"
                      }
                    />
                  ),
                },
                {
                  id: "score",
                  header: "Score",
                  cell: (row) =>
                    row.score !== null ? `${row.score}/${row.maxScore}` : `-/${row.maxScore}`,
                  align: "right",
                },
                {
                  id: "submittedAt",
                  header: "Submitted",
                  cell: (row) => new Date(row.submittedAt).toLocaleDateString(),
                },
              ]}
              rows={submissionsData?.items ?? []}
              getRowId={(row) => row.id}
              loading={submissionsLoading}
              onRowClick={
                canGrade
                  ? (row) => {
                      setGradingSubmissionId(row.id);
                    }
                  : undefined
              }
              emptyState={{ title: "No submissions yet", description: "No students have submitted yet." }}
              caption="Submission queue"
              data-testid="submissions-table"
            />
          )}
        </div>
      ) : null}

      <AssignmentFormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      {canGrade ? (
        <GradeSubmissionDrawer
          submissionId={gradingSubmissionId}
          assignmentId={selectedAssignmentId ?? undefined}
          maxScore={selectedMaxScore}
          onOpenChange={(open) => !open && setGradingSubmissionId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this assignment?"
        description="It will be soft-deleted. Existing submissions are retained in the audit log."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-assignment"
      />
    </div>
  );
}
