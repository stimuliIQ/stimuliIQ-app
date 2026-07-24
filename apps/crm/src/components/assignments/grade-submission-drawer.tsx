// Grade submission drawer — RubricGrader + feedback → status=graded.
// Shows DOMPurify-sanitized student submission text/link + signed file download
// links (AC-J8: student-submitted content must be sanitized before render).
// Supports optimistic grade with rollback on error (CLAUDE.md rules).
// Permission: submissions.grade (scope: assigned — faculty only).
import * as React from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  RubricGrader,
  type RubricCriterion,
  type RubricValue,
  Skeleton,
  EmptyState,
  useToast,
} from "@repo/ui";

import { useSubmissionDetail, useGradeSubmission } from "../../hooks/use-assignments";
import { AssignmentStatusChip } from "./assignment-status-chip";
import { sanitizeHtml } from "../../lib/sanitize";

// Default rubric criteria for assignments without a custom rubric.
const DEFAULT_CRITERIA: RubricCriterion[] = [
  { id: "completeness", label: "Completeness", maxScore: 40, description: "All required elements addressed." },
  { id: "quality", label: "Quality", maxScore: 40, description: "Quality of work and depth of understanding." },
  { id: "presentation", label: "Presentation", maxScore: 20, description: "Clarity, formatting, and communication." },
];

interface GradeSubmissionDrawerProps {
  submissionId: string | null;
  assignmentId?: string;
  maxScore?: number;
  onOpenChange: (open: boolean) => void;
}

export function GradeSubmissionDrawer({
  submissionId,
  assignmentId,
  maxScore = 100,
  onOpenChange,
}: GradeSubmissionDrawerProps): React.JSX.Element {
  const open = Boolean(submissionId);
  const { toast } = useToast();

  const {
    data: submission,
    isLoading,
    isError,
    refetch,
  } = useSubmissionDetail(submissionId ?? undefined);

  const gradeSubmission = useGradeSubmission(assignmentId);

  // Scale default criteria to the assignment's maxScore
  const scaledCriteria: RubricCriterion[] = React.useMemo(() => {
    const total = DEFAULT_CRITERIA.reduce((sum, c) => sum + c.maxScore, 0);
    return DEFAULT_CRITERIA.map((c) => ({
      ...c,
      maxScore: Math.round((c.maxScore / total) * maxScore),
    }));
  }, [maxScore]);

  const [rubricValue, setRubricValue] = React.useState<RubricValue>({
    scores: Object.fromEntries(scaledCriteria.map((c) => [c.id, null])),
    feedback: "",
  });

  // Pre-fill from existing grade
  React.useEffect(() => {
    if (!open) return;
    if (submission?.rubric) {
      const rubric = submission.rubric as Record<string, number>;
      setRubricValue({
        scores: Object.fromEntries(scaledCriteria.map((c) => [c.id, rubric[c.id] ?? null])),
        feedback: submission.feedback ?? "",
      });
    } else {
      setRubricValue({
        scores: Object.fromEntries(scaledCriteria.map((c) => [c.id, null])),
        feedback: "",
      });
    }
  }, [open, submission, scaledCriteria]);

  // Compute total from rubric scores
  const computedScore = scaledCriteria.reduce((sum, c) => {
    const s = rubricValue.scores[c.id];
    return sum + (s ?? 0);
  }, 0);

  const isPending = gradeSubmission.isPending;

  const handleGrade = async () => {
    if (!submissionId) return;
    try {
      await gradeSubmission.mutateAsync({
        id: submissionId,
        body: {
          score: computedScore,
          rubric: rubricValue.scores as Record<string, unknown>,
          feedback: rubricValue.feedback || undefined,
        },
      });
      toast({ title: "Submission graded", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't grade submission", description, variant: "destructive" });
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Grade submission"
        description={submission ? `Student: ${submission.enrollmentId}` : undefined}
        size="lg"
        data-testid="grade-submission-drawer"
      >
        {isLoading ? (
          <DrawerBody>
            <div className="flex flex-col gap-3" data-testid="grade-submission-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          </DrawerBody>
        ) : isError ? (
          <DrawerBody>
            <EmptyState
              data-testid="grade-submission-error"
              title="Couldn't load submission"
              description="Something went wrong fetching the submission details."
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="grade-submission-retry">
                  Try again
                </Button>
              }
            />
          </DrawerBody>
        ) : !submission ? (
          <DrawerBody>
            <EmptyState
              data-testid="grade-submission-empty"
              title="No submission found"
              description="This submission may have been removed."
            />
          </DrawerBody>
        ) : (
          <>
            <DrawerBody className="flex flex-col gap-4">
              {/* Submission metadata */}
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex-1 flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Status</p>
                  <AssignmentStatusChip status={submission.status} />
                </div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Attempt</p>
                  <p className="text-sm font-medium text-fg">#{submission.attemptNo}</p>
                </div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Submitted</p>
                  <p className="text-sm text-fg">
                    {new Date(submission.submittedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Student submission content — sanitized (AC-J8) */}
              {submission.text ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-fg">Submission text</p>
                  {/* DOMPurify sanitization: student-submitted text is sanitized before innerHTML (AC-J8) */}
                  <div
                    className="prose prose-sm max-w-none rounded-md border border-border bg-surface p-3 text-fg"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(submission.text) }}
                    data-testid="submission-text-content"
                  />
                </div>
              ) : null}

              {/* Submission link — sanitized */}
              {submission.link ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-fg">Submission link</p>
                  <a
                    href={sanitizeHtml(submission.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    data-testid="submission-link"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Open link
                  </a>
                </div>
              ) : null}

              {/* Signed file download links */}
              {submission.fileDownloadUrls.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-fg">Submitted files</p>
                  <ul className="flex flex-col gap-1.5" aria-label="Submitted files">
                    {submission.fileDownloadUrls.map((file, index) => (
                      <li key={file.key}>
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          data-testid={`submission-file-${index}`}
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          <span>File {index + 1}</span>
                          <span className="text-xs text-fg-muted">
                            (expires {new Date(file.expiresAt).toLocaleTimeString()})
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Empty submission warning */}
              {!submission.text && !submission.link && submission.fileDownloadUrls.length === 0 ? (
                <Alert tone="warning" icon={<FileText />}>
                  No submission content found.
                </Alert>
              ) : null}

              {/* Rubric grader */}
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm font-medium text-fg">Rubric grading</p>
                <RubricGrader
                  criteria={scaledCriteria}
                  value={rubricValue}
                  onChange={setRubricValue}
                  feedbackLabel="Feedback for student"
                  data-testid="grade-rubric-grader"
                />
              </div>

              {/* Score preview */}
              <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2">
                <span className="text-sm text-fg-muted">Total score</span>
                <span className="font-mono text-lg font-semibold text-fg" aria-live="polite" aria-atomic="true">
                  {computedScore}
                  <span className="text-sm font-normal text-fg-muted">/{maxScore}</span>
                </span>
              </div>
            </DrawerBody>

            <DrawerFooter>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                data-testid="grade-submission-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleGrade()}
                loading={isPending}
                data-testid="grade-submission-submit"
              >
                {submission.status === "graded" ? "Update grade" : "Submit grade"}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
