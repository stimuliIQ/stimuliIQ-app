// Project directory — kind=project assignments with milestone review pipeline.
// Faculty sees only projects in their assigned batches.
// Milestone review = grading individual milestones via GradeSubmissionDrawer.
//
// Projects are authored here, not only reviewed here. The screen previously had no way to
// create one — its empty state told staff to "assign project-type assignments to batches",
// i.e. to go and do it on another screen — so the create drawer is wired in directly, locked
// to kind=project (an assignment created from the Projects page could never appear on it).
//
// DETAIL IS A SIDE PANEL, NOT AN INLINE BLOCK. Opening a project used to expand a panel
// UNDER the table, which put the thing you were reading below the thing you clicked and got
// further away with every extra row. A drawer is the codebase's idiom for "detail over a
// still-visible list" (drawer.tsx's own doc comment), keeps the review at a fixed position,
// and gives the panel room for what the table can't show. The whole row is the target now;
// the expand chevron it replaces was a second, smaller hit area for the same intent.
//
// THE PANEL REVIEWS SUBMISSIONS PER STUDENT, and that is a deliberate correction. It used to
// render `ProjectDetail.milestoneStates`, which `buildProjectDetailFromAssignment`
// (assignments.service.ts) builds by grouping every submission by milestone and keeping only
// the MOST RECENT ONE ACROSS THE WHOLE BATCH. That shape is right for the LMS, where a
// student only ever sees their own work, and wrong here: with twenty students enrolled,
// "History taking · Submitted" was whichever of them submitted last, carried no name (
// MilestoneReviewState has no student field), and clicking it opened the grader on that one
// arbitrary person's submission. Faculty verifying a cohort need "who submitted what", so
// the panel now lists `GET /crm/assignments/:id/submissions` — already per-student, already
// carrying the milestone title — and the milestone section is read-only structure.
//
// `overallStatus` is dropped here for the same reason: derived from those collapsed states,
// "All graded" meant "the latest submission for each milestone is graded", not "the batch is
// done". A status that only tells the truth when exactly one student is enrolled is a trap.
// The honest cohort numbers (`submissionCount` / `gradedCount`) come off the assignment.
//
// WHICH ENDPOINTS THE PANEL READS, AND WHY IT MATTERS. The header comes from
// `GET /crm/assignments/:id` (`assignments.view`) rather than `.../project`
// (`projects.review`), because this screen is listed for anyone holding `assignments.view` —
// which includes branch_manager and content_editor, neither of whom is granted
// `projects.review`. Reading the project endpoint here would have 403'd the whole panel for
// them the moment they clicked a row. The submission queue is gated separately on
// `submissions.view` (content_editor lacks it) and simply says so rather than erroring.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  DetailGrid,
  DetailRow,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { AssignmentSummary, MeResponse, SubmissionStatus, SubmissionSummary } from "@repo/types";

import {
  useAssignment,
  useAssignmentsList,
  useDeleteAssignment,
  useSubmissionsList,
} from "../../hooks/use-assignments";
import { useBatchesList } from "../../hooks/use-batches";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { AssignmentFormDrawer } from "./assignment-form-drawer";
import { GradeSubmissionDrawer } from "./grade-submission-drawer";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

/** One submission's state, in the shared CRM vocabulary. */
const SUBMISSION_TONE: Record<SubmissionStatus, "info" | "success" | "warning"> = {
  submitted: "info",
  graded: "success",
  returned: "warning",
};

const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Awaiting review",
  graded: "Graded",
  returned: "Returned",
};

/** Filter options for the panel's submission queue — "what still needs me?" first. */
const SUBMISSION_FILTERS: Array<{ value: SubmissionStatus | "all"; label: string }> = [
  { value: "all", label: "All submissions" },
  { value: "submitted", label: "Awaiting review" },
  { value: "graded", label: "Graded" },
  { value: "returned", label: "Returned" },
];

const SUBMISSIONS_PAGE_SIZE = 10;

interface ProjectDirectoryProps {
  me: MeResponse | undefined;
}

export function ProjectDirectory({ me }: ProjectDirectoryProps): React.JSX.Element {
  const canGrade = hasPermission(me?.permissions, "projects.review");
  const canDelete = hasPermission(me?.permissions, "assignments.edit");
  // Authoring is `assignments.create` — a project IS an assignment of kind=project, so it
  // must not invent a second permission for the same write (server-side guard, admin.ts).
  const canCreate = getModulePermissions(me, "assignments").canCreate;
  // Separate from grading: branch_manager oversees submissions across their branch without
  // `projects.review`, and content_editor authors projects without seeing student work.
  const canViewSubmissions = hasPermission(me?.permissions, "submissions.view");
  const { toast } = useToast();

  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);
  // The project whose side panel is open. Held as the whole row, not just an id, so the
  // panel can title itself immediately instead of showing an empty header while it loads.
  const [openProject, setOpenProject] = React.useState<AssignmentSummary | null>(null);
  const [gradingSubmissionId, setGradingSubmissionId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = React.useState<SubmissionStatus | "all">("all");
  const [submissionBatchId, setSubmissionBatchId] = React.useState<string>("all");
  const [submissionsPage, setSubmissionsPage] = React.useState(1);
  const expandedProjectId = openProject?.id ?? null;

  // Every panel opens on a clean queue — a filter left over from the last project would
  // silently hide submissions on this one.
  React.useEffect(() => {
    setSubmissionStatus("all");
    setSubmissionBatchId("all");
    setSubmissionsPage(1);
  }, [expandedProjectId]);

  React.useEffect(() => {
    setSubmissionsPage(1);
  }, [submissionStatus, submissionBatchId]);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAssignmentsList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    kind: "project",
  });

  // The open project's full record — instructions, milestones and cohort counters.
  const {
    data: project,
    isLoading: projectLoading,
    isError: projectError,
    error: projectFetchError,
  } = useAssignment(expandedProjectId ?? undefined);

  // Cohorts of THIS project's course — the batch picker's options. Scoped by programId so
  // it offers only cohorts that could plausibly have submitted, rather than every batch in
  // the tenant. Waits for the project detail, which is where programId comes from.
  const { data: batches } = useBatchesList({
    page: 1,
    pageSize: 100,
    includeDeleted: false,
    ...(project?.programId ? { programId: project.programId } : {}),
  });

  // The queue faculty actually verify against: one row per STUDENT submission (per
  // milestone, for a project), straight off the endpoint the Assignments screen uses.
  // Skipped entirely without `submissions.view` — an unconditional call would 403 for
  // content_editor, who can see and author projects but not students' work.
  const {
    data: submissions,
    isLoading: submissionsLoading,
    isError: submissionsError,
    error: submissionsFetchError,
  } = useSubmissionsList(canViewSubmissions ? (expandedProjectId ?? undefined) : undefined, {
    page: submissionsPage,
    pageSize: SUBMISSIONS_PAGE_SIZE,
    ...(submissionStatus !== "all" ? { status: submissionStatus } : {}),
    ...(submissionBatchId !== "all" ? { batchId: submissionBatchId } : {}),
  });

  const deleteMutation = useDeleteAssignment();

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Project deleted", variant: "success" });
        setDeleteId(null);
        // Close the panel if it was showing the project that just went away.
        if (expandedProjectId === deleteId) setOpenProject(null);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to delete project");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<AssignmentSummary>> = [
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
        description={queryErrorMessage(error, "Something went wrong fetching the project list.")}
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
        description="Multi-milestone projects and case studies. Faculty review each milestone in their assigned batches."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="projects-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add project
            </Button>
          ) : null
        }
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
          description: canCreate
            ? "Add a project, pick the course and lesson it belongs to, and it shows up here."
            : "Projects appear here once someone with authoring access adds one.",
        }}
        caption="Project directory"
        data-testid="projects-table"
        onRowClick={(row) => setOpenProject(row)}
      />

      <Drawer open={Boolean(openProject)} onOpenChange={(open) => !open && setOpenProject(null)}>
        <DrawerContent
          title={openProject?.title ?? "Project"}
          description={openProject?.lessonTitle}
          size="lg"
          data-testid="project-detail-drawer"
        >
          <DrawerBody className="flex flex-col gap-5">
            {projectLoading ? (
              <div className="flex flex-col gap-2" data-testid="project-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="line" />
              </div>
            ) : projectError ? (
              <EmptyState
                data-testid="project-detail-error"
                title="Couldn't load project detail"
                description={queryErrorMessage(projectFetchError, "Something went wrong loading the milestone states.")}
              />
            ) : !project ? null : (
              <>
                <DetailGrid columns={2}>
                  <DetailRow label="Lesson">{project.lessonTitle}</DetailRow>
                  {/* Cohort truth, straight off the assignment's own counters — NOT the
                      per-milestone rollup, which collapses every student into one row. */}
                  <DetailRow label="Awaiting review">
                    {project.submissionCount - project.gradedCount}
                  </DetailRow>
                  <DetailRow label="Max score">{project.maxScore}</DetailRow>
                  <DetailRow label="Due date">
                    {project.dueAt
                      ? new Date(project.dueAt).toLocaleString()
                      : "No deadline"}
                  </DetailRow>
                  <DetailRow label="Milestones">{project.milestones.length}</DetailRow>
                  <DetailRow label="Graded">
                    {project.gradedCount}/{project.submissionCount}
                  </DetailRow>
                  <DetailRow label="Resubmission">
                    {project.allowResubmit ? "Allowed after grading" : "Not allowed"}
                  </DetailRow>
                  <DetailRow label="Final project">
                    {project.isFinal ? (
                      <StatusChip tone="warning" label="Certificate gate" size="sm" />
                    ) : (
                      "No"
                    )}
                  </DetailRow>
                </DetailGrid>

                {project.instructions ? (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-fg">Instructions</h3>
                    {/* The brief as the student sees it. `whitespace-pre-line` keeps the
                        author's line breaks; it is rendered as TEXT, never as HTML. */}
                    <p className="whitespace-pre-line rounded-md border border-border p-3 text-sm text-fg">
                      {project.instructions}
                    </p>
                  </section>
                ) : null}

                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">
                      Submissions
                      {submissions?.meta.total ? (
                        <span className="ml-1.5 font-normal text-fg-muted">({submissions.meta.total})</span>
                      ) : null}
                    </h3>
                    {canViewSubmissions ? (
                    <Select
                      aria-label="Filter submissions by batch"
                      value={submissionBatchId}
                      onValueChange={setSubmissionBatchId}
                      wrapperClassName="w-52"
                      data-testid="project-submissions-batch-filter"
                    >
                      <SelectItem value="all">All batches</SelectItem>
                      {(batches?.items ?? []).map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.name}
                        </SelectItem>
                      ))}
                    </Select>
                    ) : null}
                    {canViewSubmissions ? (
                    <Select
                      aria-label="Filter submissions by status"
                      value={submissionStatus}
                      onValueChange={(value) => setSubmissionStatus(value as SubmissionStatus | "all")}
                      wrapperClassName="w-48"
                      data-testid="project-submissions-filter"
                    >
                      {SUBMISSION_FILTERS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </Select>
                    ) : null}
                  </div>

                  {!canViewSubmissions ? (
                    // content_editor authors projects but is not granted `submissions.view`.
                    // Say so plainly — an empty table would read as "nobody has submitted".
                    <Alert tone="info" title="You don't have access to student submissions">
                      Ask an admin for the Submissions view permission, or a faculty member on this batch to review them.
                    </Alert>
                  ) : submissionsError ? (
                    <EmptyState
                      data-testid="project-submissions-error"
                      title="Couldn't load submissions"
                      description={queryErrorMessage(
                        submissionsFetchError,
                        "Something went wrong fetching what students have sent in.",
                      )}
                    />
                  ) : (
                    <SubmissionsTable
                      rows={submissions?.items ?? []}
                      total={submissions?.meta.total ?? 0}
                      page={submissionsPage}
                      onPageChange={setSubmissionsPage}
                      loading={submissionsLoading}
                      canGrade={canGrade}
                      filtered={submissionStatus !== "all" || submissionBatchId !== "all"}
                      showBatchColumn={submissionBatchId === "all"}
                      onGrade={(submissionId) => setGradingSubmissionId(submissionId)}
                    />
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-fg">Milestones</h3>
                  {project.milestones.length === 0 ? (
                    // A project with no milestones still works — it just grades as a single
                    // submission — so this states the fact rather than reading as an error.
                    <Alert tone="info" title="No milestones defined">
                      This project is reviewed as one submission. Milestones are set when the project is created.
                    </Alert>
                  ) : (
                    // Read-only structure. Per-milestone STATUS deliberately lives on each
                    // submission row above instead: a status here could only describe the
                    // whole batch at once, which is exactly the collapse that made the old
                    // milestone table misreport whose work had been handed in.
                    <ol className="divide-y divide-border rounded-md border border-border" data-testid="project-milestones">
                      {project.milestones.map((milestone, index) => (
                        <li key={milestone.id} className="flex items-baseline justify-between gap-3 p-3 text-sm">
                          <span className="text-fg">
                            <span className="mr-2 text-fg-subtle">{index + 1}.</span>
                            {milestone.title}
                          </span>
                          <span className="shrink-0 text-xs text-fg-muted">
                            {milestone.dueAt ? `Due ${new Date(milestone.dueAt).toLocaleDateString()}` : "No deadline"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpenProject(null)}
              data-testid="project-detail-close"
            >
              Close
            </Button>
            {canDelete && openProject ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteId(openProject.id)}
                data-testid="project-detail-delete"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {canCreate ? (
        <AssignmentFormDrawer open={createOpen} onOpenChange={setCreateOpen} lockedKind="project" />
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

/**
 * The submission queue for one project — ONE ROW PER STUDENT SUBMISSION.
 *
 * This is what "verify the submitted projects" means in practice: who handed in, against
 * which milestone, what state it is in, and a click straight into the grader. It replaces a
 * per-milestone table that showed only the batch's most recent submission per milestone and
 * named nobody (see the file header).
 *
 * `milestoneTitle` is nullable on purpose — a project whose author defined no milestones
 * collects one plain submission per student, and those rows render "—" rather than a blank
 * column that reads like missing data.
 */
interface SubmissionsTableProps {
  rows: SubmissionSummary[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  canGrade: boolean;
  /** Whether any filter is applied — changes what an empty result MEANS. */
  filtered: boolean;
  /** Hidden when the queue is already narrowed to one cohort. */
  showBatchColumn: boolean;
  onGrade: (submissionId: string) => void;
}

function SubmissionsTable({
  rows,
  total,
  page,
  onPageChange,
  loading,
  canGrade,
  filtered,
  showBatchColumn,
  onGrade,
}: SubmissionsTableProps): React.JSX.Element {
  const columns: Array<DataTableColumn<SubmissionSummary>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    // Dropped when a single cohort is selected — a column repeating the filter is noise.
    ...(showBatchColumn
      ? [{ id: "batch", header: "Batch", cell: (row: SubmissionSummary) => row.batchName } satisfies DataTableColumn<SubmissionSummary>]
      : []),
    {
      id: "milestone",
      header: "Milestone",
      cell: (row) => row.milestoneTitle ?? <span className="text-fg-subtle">-</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={SUBMISSION_TONE[row.status]} label={SUBMISSION_LABEL[row.status]} size="sm" />,
    },
    {
      id: "score",
      header: "Score",
      cell: (row) => (row.score !== null ? `${row.score}/${row.maxScore}` : `-/${row.maxScore}`),
      align: "right",
    },
    {
      id: "attemptNo",
      header: "Attempt",
      // Only meaningful once someone has resubmitted; a column of "1"s is noise, so the
      // first attempt reads blank and a resubmission stands out.
      cell: (row) => (row.attemptNo > 1 ? `#${row.attemptNo}` : ""),
      align: "right",
    },
    {
      id: "submittedAt",
      header: "Submitted",
      cell: (row) => new Date(row.submittedAt).toLocaleDateString(),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      loading={loading}
      onRowClick={canGrade ? (row) => onGrade(row.id) : undefined}
      pagination={{ page, pageSize: SUBMISSIONS_PAGE_SIZE, total, onPageChange }}
      emptyState={
        filtered
          ? { title: "Nothing in this state", description: "Try another status filter." }
          : {
              title: "No submissions yet",
              description: "Students' work appears here as they hand it in. Click a row to review and grade it.",
            }
      }
      caption="Student submissions for this project"
      data-testid="project-submissions-table"
    />
  );
}
