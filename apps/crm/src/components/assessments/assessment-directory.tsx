// Assessment directory — faculty authors assessments + descriptive grade queue.
// Includes question bank view (with answer keys — CRM faculty surface only).
// Answer keys are NEVER shown on student-facing surfaces (AC-D2/AC-J9).
import * as React from "react";
import { Plus } from "lucide-react";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import type { AssessmentSummary, AssessmentType, AttemptResult, MeResponse } from "@repo/types";

import { useAssessmentsList, useAssessmentDetailAuthor } from "../../hooks/use-assessments";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { AssessmentFormDrawer } from "./assessment-form-drawer";
import { DescriptiveGradeDrawer } from "./descriptive-grade-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

const TYPE_OPTIONS: { value: AssessmentType; label: string }[] = [
  { value: "quiz", label: "Quiz" },
  { value: "test", label: "Test" },
];

interface AssessmentDirectoryProps {
  me: MeResponse | undefined;
}

export function AssessmentDirectory({ me }: AssessmentDirectoryProps): React.JSX.Element {
  const assessmentPermissions = getModulePermissions(me, "assessments");
  const canGradeAttempts = hasPermission(me?.permissions, "attempts.grade");

  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<AssessmentType | undefined>(undefined);
  const [isRequiredFilter, setIsRequiredFilter] = React.useState<boolean | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedAssessmentId, setSelectedAssessmentId] = React.useState<string | null>(null);
  const [gradingAttempt, setGradingAttempt] = React.useState<AttemptResult | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, isRequiredFilter]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAssessmentsList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    type: typeFilter,
    isRequired: isRequiredFilter,
  });

  // Load author detail (with answer keys — CRM only) when selected
  const {
    data: assessmentDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = useAssessmentDetailAuthor(selectedAssessmentId ?? undefined);

  const columns: Array<DataTableColumn<AssessmentSummary>> = [
    { id: "title", header: "Assessment", cell: (row) => row.title, sortable: true },
    { id: "moduleTitle", header: "Module", cell: (row) => row.moduleTitle },
    {
      id: "type",
      header: "Type",
      cell: (row) => (
        <StatusChip tone={row.type === "test" ? "warning" : "info"} label={row.type === "test" ? "Test" : "Quiz"} />
      ),
    },
    {
      id: "isRequired",
      header: "Required",
      cell: (row) =>
        row.isRequired ? (
          <StatusChip tone="danger" label="Required" />
        ) : (
          <span className="text-fg-muted text-xs">Optional</span>
        ),
    },
    {
      id: "timeLimitS",
      header: "Time limit",
      cell: (row) =>
        row.timeLimitS ? `${Math.floor(row.timeLimitS / 60)}m` : "Untimed",
    },
    { id: "questionCount", header: "Questions", cell: (row) => row.questionCount, align: "right" },
    { id: "totalPoints", header: "Total pts", cell: (row) => row.totalPoints, align: "right" },
    { id: "passPct", header: "Pass %", cell: (row) => `${row.passPct}%`, align: "right" },
    { id: "attemptsAllowed", header: "Attempts", cell: (row) => row.attemptsAllowed, align: "right" },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="assessments-error"
        title="Couldn't load assessments"
        description={queryErrorMessage(error, "Something went wrong fetching the assessment list.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="assessments-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="assessments-directory">
      <PageHeader
        title="Assessments"
        description="Author MCQ and descriptive assessments. Grade descriptive attempts manually."
        actions={
          assessmentPermissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="assessments-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add assessment
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Assessment title"
        data-testid="assessments-filter-bar"
      >
        <Select
          label="Type"
          placeholder="All types"
          value={typeFilter}
          onValueChange={(value) =>
            setTypeFilter(value === "__all__" ? undefined : (value as AssessmentType))
          }
          wrapperClassName="w-40"
          data-testid="assessments-type-filter"
        >
          <SelectItem value="__all__">All types</SelectItem>
          {TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Required"
          placeholder="All"
          value={isRequiredFilter === undefined ? undefined : isRequiredFilter ? "true" : "false"}
          onValueChange={(value) => {
            if (value === "__all__") setIsRequiredFilter(undefined);
            else setIsRequiredFilter(value === "true");
          }}
          wrapperClassName="w-36"
          data-testid="assessments-required-filter"
        >
          <SelectItem value="__all__">All</SelectItem>
          <SelectItem value="true">Required</SelectItem>
          <SelectItem value="false">Optional</SelectItem>
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) =>
          setSelectedAssessmentId(row.id === selectedAssessmentId ? null : row.id)
        }
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No assessments yet",
          description: "Create the first assessment for your batches.",
        }}
        caption="Assessment directory"
        data-testid="assessments-table"
      />

      {/* Assessment detail panel with question bank (answer keys visible — CRM only) */}
      {selectedAssessmentId ? (
        <div
          className="flex flex-col gap-3 rounded-md border border-border p-4"
          data-testid="assessment-detail-panel"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              Question bank (faculty view. Answer keys shown here only)
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAssessmentId(null)}
              aria-label="Close question bank panel"
              data-testid="assessment-detail-close"
            >
              Close
            </Button>
          </div>

          {detailLoading ? (
            <div className="flex flex-col gap-2" data-testid="assessment-detail-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
            </div>
          ) : detailError ? (
            <EmptyState
              data-testid="assessment-detail-error"
              title="Couldn't load assessment detail"
            />
          ) : !assessmentDetail ? null : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-fg-muted">Total points</p>
                  <p className="font-medium text-fg">{assessmentDetail.totalPoints}</p>
                </div>
                <div>
                  <p className="text-fg-muted">Attempts taken</p>
                  <p className="font-medium text-fg">{assessmentDetail.attemptCount}</p>
                </div>
                <div>
                  <p className="text-fg-muted">Pass threshold</p>
                  <p className="font-medium text-fg">{assessmentDetail.passPct}%</p>
                </div>
                <div>
                  <p className="text-fg-muted">Shuffle</p>
                  <p className="font-medium text-fg">{assessmentDetail.shuffle ? "Yes" : "No"}</p>
                </div>
              </div>

              <Tabs defaultValue="questions">
                <TabsList aria-label="Assessment detail sections">
                  <TabsTrigger value="questions" data-testid="assessment-tab-questions">
                    Questions ({assessmentDetail.questions.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="questions" data-testid="assessment-tab-content-questions">
                  <div className="flex flex-col gap-3 mt-3">
                    {assessmentDetail.questions.map((q, index) => (
                      <div
                        key={q.id}
                        className="rounded-md border border-border p-3 flex flex-col gap-2"
                        data-testid={`question-bank-item-${index}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-fg-muted">Q{index + 1}</span>
                            <StatusChip
                              tone={q.type === "mcq" ? "info" : "warning"}
                              label={q.type === "mcq" ? "MCQ" : "Descriptive"}
                            />
                            <span className="text-xs text-fg-muted">{q.points} pts</span>
                          </div>
                        </div>
                        <p className="text-sm text-fg">{q.prompt}</p>
                        {q.type === "mcq" && q.options ? (
                          <ul className="flex flex-col gap-1 pl-3" aria-label="MCQ options">
                            {q.options.map((opt) => {
                              const isCorrect = q.answerKey === opt.id ||
                                (Array.isArray(q.answerKey) && q.answerKey.includes(opt.id));
                              return (
                                <li key={opt.id} className="flex items-center gap-2 text-sm">
                                  <span
                                    className={`inline-block size-2 rounded-full flex-shrink-0 ${isCorrect ? "bg-success" : "bg-border"}`}
                                    aria-hidden="true"
                                  />
                                  <span className={isCorrect ? "font-medium text-fg" : "text-fg-muted"}>
                                    {opt.text}
                                  </span>
                                  {isCorrect ? (
                                    <span className="text-xs text-success">(correct answer)</span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                        {q.type === "descriptive" && q.answerKey ? (
                          <p className="text-xs text-fg-muted bg-surface rounded px-2 py-1">
                            Grading notes: {typeof q.answerKey === "string" ? q.answerKey : JSON.stringify(q.answerKey)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      ) : null}

      <AssessmentFormDrawer open={createOpen} onOpenChange={setCreateOpen} />

      {canGradeAttempts ? (
        <DescriptiveGradeDrawer
          attempt={gradingAttempt}
          open={Boolean(gradingAttempt)}
          onOpenChange={(open) => !open && setGradingAttempt(null)}
        />
      ) : null}
    </div>
  );
}
