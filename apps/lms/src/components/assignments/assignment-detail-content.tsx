// AssignmentDetailContent — student assignment detail + submission form.
//
// Shows: assignment instructions, due date, current status,
// submission form (FileUpload + text + link), grade + rubric + feedback (DOMPurify-sanitized).
//
// SECURITY: All student-submitted feedback/text is sanitized with DOMPurify before render (AC-J8).
// FileUpload seam: requestUploadUrl → POST /storage/upload-url → returns {url, storageKey}.
//   The component calls PUT to url, then reports storageKey to us.
//   Only storageKey goes into the submit payload (never the raw signed URL).
//
// CLAUDE.md §3: no business logic in components — hooks own fetch+mutate.
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  EmptyState,
  FileUpload,
  Skeleton,
  StatusChip,
} from "@repo/ui";
import type { SubmitAssignmentRequest } from "@repo/types";

import {
  useAssignmentDetail,
  useMySubmission,
  useSubmitAssignment,
  useRequestUploadUrl,
} from "../../hooks/use-assignments";
import { sanitizeHtml } from "../../lib/sanitize";
import { AssignmentStatusChip } from "./assignment-status-chip";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AssignmentDetailSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading assignment">
      <Skeleton shape="line" className="mb-3 h-7 w-2/3" />
      <Skeleton shape="line" className="mb-6 h-4 w-1/3" />
      <Skeleton shape="block" className="h-32 w-full rounded-lg" />
      <Skeleton shape="block" className="mt-4 h-24 w-full rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade + Feedback view (after grading)
// Sanitizes feedback with DOMPurify before rendering (AC-J8).
// ---------------------------------------------------------------------------

/**
 * The reviewer's reason for sending work back, sanitized before render.
 *
 * Same DOMPurify posture as GradeFeedback (AC-J8) — this text is staff-authored, but it
 * travels the identical path into `dangerouslySetInnerHTML` and gets the identical
 * treatment rather than an exception nobody would remember to revisit.
 */
function ReturnedReason({ reason }: { reason: string }): React.JSX.Element {
  const sanitized = React.useMemo(() => sanitizeHtml(reason), [reason]);
  return (
    <div
      className="prose prose-sm max-w-none overflow-x-auto text-fg prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto"
      data-testid="assignment-returned-reason"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

interface GradeFeedbackProps {
  score: number | null;
  maxScore: number;
  feedback: string | null;
  rubric: Record<string, unknown> | null;
  gradedAt: string | null;
  gradedByName: string | null;
}

function GradeFeedback({
  score,
  maxScore,
  feedback,
  rubric,
  gradedAt,
  gradedByName,
}: GradeFeedbackProps): React.JSX.Element {
  const sanitizedFeedback = React.useMemo(() => sanitizeHtml(feedback), [feedback]);
  const formattedDate = gradedAt
    ? new Date(gradedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <section
      aria-labelledby="grade-section-heading"
      className="mt-6 rounded-lg border border-success/30 bg-success/5 p-5"
      data-testid="assignment-grade-section"
    >
      <h2
        id="grade-section-heading"
        className="mb-4 text-base font-semibold text-fg"
      >
        Grade &amp; Feedback
      </h2>

      {/* Score */}
      <div className="mb-4 flex items-center gap-3" data-testid="assignment-score">
        <span className="text-3xl font-bold tabular-nums text-fg">
          {score !== null ? score : "—"}
        </span>
        <span className="text-lg text-fg-muted">/ {maxScore}</span>
        {score !== null ? (
          <StatusChip
            tone={score >= maxScore * 0.6 ? "success" : "warning"}
            label={`${Math.round((score / maxScore) * 100)}%`}
            size="sm"
          />
        ) : null}
      </div>

      {/* Rubric breakdown */}
      {rubric && Object.keys(rubric).length > 0 ? (
        <div className="mb-4" data-testid="assignment-rubric">
          <h3 className="mb-2 text-sm font-medium text-fg-muted">Rubric</h3>
          <dl className="space-y-1">
            {Object.entries(rubric).map(([criterion, value]) => (
              <div key={criterion} className="flex items-center gap-2 text-sm">
                <dt className="text-fg-muted">{criterion}:</dt>
                <dd className="font-medium text-fg">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {/* Faculty feedback — DOMPurify sanitized */}
      {sanitizedFeedback ? (
        <div data-testid="assignment-feedback">
          <h3 className="mb-2 text-sm font-medium text-fg-muted">Feedback</h3>
          {/* DOMPurify sanitizes before render — resolves P3 L-2 (AC-J8) */}
          <div
            className="prose prose-sm max-w-none overflow-x-auto text-fg prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: sanitizedFeedback }}
          />
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No written feedback provided.</p>
      )}

      {/* Graded by / date */}
      {(gradedByName ?? formattedDate) ? (
        <p className="mt-3 text-xs text-fg-subtle">
          Graded{gradedByName ? ` by ${gradedByName}` : ""}
          {formattedDate ? ` on ${formattedDate}` : ""}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Submission form
// Collects files (via FileUpload seam), text, and link.
// Validates: at least one of files/text/link required.
// ---------------------------------------------------------------------------

interface SubmissionFormProps {
  assignmentId: string;
  canResubmit: boolean;
  isDisabled: boolean;
  onSubmitted: () => void;
}

function SubmissionForm({
  assignmentId,
  canResubmit: _canResubmit,
  isDisabled,
  onSubmitted,
}: SubmissionFormProps): React.JSX.Element {
  const [storageKeys, setStorageKeys] = React.useState<string[]>([]);
  const [text, setText] = React.useState("");
  const [link, setLink] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const { submit, isSubmitting, error: submitError } = useSubmitAssignment();
  const requestUploadUrl = useRequestUploadUrl();

  const handleFileUploaded = (storageKey: string) => {
    setStorageKeys((prev) => [...prev, storageKey]);
  };

  const handleFileRemoved = (storageKey: string | null) => {
    if (storageKey) {
      setStorageKeys((prev) => prev.filter((k) => k !== storageKey));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (storageKeys.length === 0 && !text.trim() && !link.trim()) {
      setValidationError("Please provide at least one: file upload, text response, or a link.");
      return;
    }

    const body: SubmitAssignmentRequest = {
      files: storageKeys,
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(link.trim() ? { link: link.trim() } : {}),
    };

    try {
      await submit(assignmentId, body);
      onSubmitted();
    } catch {
      // Error displayed from submitError below
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      data-testid="assignment-submit-form"
      className="mt-6 flex flex-col gap-5"
    >
      <h2 className="text-base font-semibold text-fg">
        {_canResubmit ? "Resubmit Assignment" : "Submit Assignment"}
      </h2>

      {/* File upload seam — requestUploadUrl calls POST /storage/upload-url
          and returns {url, storageKey}. The FileUpload PUT's to url, then
          calls onUploaded(storageKey). We collect storageKeys only. */}
      <div>
        <label className="mb-2 block text-sm font-medium text-fg" id="file-upload-label">
          Upload files <span className="text-fg-subtle">(optional)</span>
        </label>
        <FileUpload
          requestUploadUrl={requestUploadUrl}
          onUploaded={handleFileUploaded}
          onRemoved={(key) => handleFileRemoved(key)}
          multiple
          maxBytes={50 * 1024 * 1024} // 50 MB client hint
          acceptedTypes={["application/pdf", "image/*", "application/zip", "text/plain"]}
          disabled={isDisabled || isSubmitting}
          label="Upload assignment files"
          data-testid="assignment-file-upload"
        />
      </div>

      {/* Text response */}
      <div>
        <label htmlFor="assignment-text" className="mb-2 block text-sm font-medium text-fg">
          Text response <span className="text-fg-subtle">(optional)</span>
        </label>
        <textarea
          id="assignment-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Write your response here…"
          disabled={isDisabled || isSubmitting}
          className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="assignment-text-input"
        />
      </div>

      {/* Link */}
      <div>
        <label htmlFor="assignment-link" className="mb-2 block text-sm font-medium text-fg">
          Link / URL <span className="text-fg-subtle">(optional: repo, demo, etc.)</span>
        </label>
        <input
          id="assignment-link"
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://github.com/your/repo"
          disabled={isDisabled || isSubmitting}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="assignment-link-input"
        />
      </div>

      {/* Validation error */}
      {validationError ? (
        <p role="alert" className="text-sm text-danger" data-testid="assignment-validation-error">
          {validationError}
        </p>
      ) : null}

      {/* API error */}
      {submitError ? (
        <p role="alert" className="text-sm text-danger" data-testid="assignment-submit-error">
          {submitError.problem.detail ?? submitError.problem.title ?? "Submission failed. Please try again."}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        loading={isSubmitting}
        disabled={isDisabled || isSubmitting}
        data-testid="assignment-submit-btn"
        className="self-start"
      >
        Submit assignment
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AssignmentDetailContent — top-level client component
// ---------------------------------------------------------------------------

interface AssignmentDetailContentProps {
  assignmentId: string;
}

export function AssignmentDetailContent({
  assignmentId,
}: AssignmentDetailContentProps): React.JSX.Element {
  const { assignment, isLoading, isSignedOut, isError, error, refetch } =
    useAssignmentDetail(assignmentId);
  const { submission, isLoading: submissionLoading } = useMySubmission(assignmentId);
  const [showResubmitForm, setShowResubmitForm] = React.useState(false);

  if (isLoading || submissionLoading) return <AssignmentDetailSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="assignment-detail-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view this assignment.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild><a href="/login">Sign in</a></Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="assignment-detail-error">
        <CardHeader>
          <CardTitle>Failed to load assignment</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="assignment-detail-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!assignment) {
    return (
      <EmptyState
        data-testid="assignment-not-found"
        title="Assignment not found"
        description="This assignment doesn't exist or is not available for your enrollment."
        action={
          <Button asChild variant="secondary">
            <Link href="/assignments">Back to assignments</Link>
          </Button>
        }
      />
    );
  }

  const isGraded = submission?.status === "graded";
  const isSubmitted = submission?.status === "submitted";
  // Sent back by a reviewer: the student has been asked to change something and resubmit.
  const isReturned = submission?.status === "returned";
  // `isReturned` was missing from this condition, which made the send-back loop impossible
  // to complete from this screen: the reviewer asked for changes, the API allowed a new
  // attempt, and the Submit-again button still never rendered. The API switches
  // `allowResubmit` on whenever it returns work, so the flag check passes for this case.
  const canResubmit = assignment.allowResubmit && (isGraded || isSubmitted || isReturned);
  const isOverdue = assignment.status === "overdue";
  const showForm =
    !submission || (canResubmit && showResubmitForm) || assignment.status === "assigned";

  const formattedDue = assignment.dueAt
    ? new Date(assignment.dueAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // Sanitize instructions (faculty-authored HTML — safe to render, but still sanitize defensively)
  const sanitizedInstructions = React.useMemo(
    () => sanitizeHtml(assignment.instructions),
    [assignment.instructions],
  );

  return (
    <div data-testid="assignment-detail-content">
      {/* Back link */}
      <Link
        href="/assignments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="assignment-detail-back"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All assignments
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg" data-testid="assignment-title">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-fg-muted" data-testid="assignment-lesson">
            {assignment.lessonTitle}
            {formattedDue ? ` · Due ${formattedDue}` : ""}
          </p>
        </div>
        <AssignmentStatusChip status={assignment.status} />
      </div>

      {/* Instructions */}
      {sanitizedInstructions ? (
        <section
          aria-labelledby="instructions-heading"
          className="mb-6 rounded-lg border border-border bg-card p-5"
          data-testid="assignment-instructions"
        >
          <h2
            id="instructions-heading"
            className="mb-3 text-base font-semibold text-fg"
          >
            Instructions
          </h2>
          <div
            className="prose prose-sm max-w-none overflow-x-auto text-fg prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: sanitizedInstructions }}
          />
          <p className="mt-3 text-sm text-fg-muted">
            Max score: <span className="font-medium text-fg">{assignment.maxScore} points</span>
          </p>
        </section>
      ) : null}

      {/* Submitted content preview */}
      {submission ? (
        <section
          aria-labelledby="submission-heading"
          className="mb-6 rounded-lg border border-border bg-card p-5"
          data-testid="assignment-submission"
        >
          <h2
            id="submission-heading"
            className="mb-3 text-base font-semibold text-fg"
          >
            Your submission
          </h2>
          <p className="text-xs text-fg-muted mb-3">
            Submitted{" "}
            {new Date(submission.submittedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {submission.attemptNo > 1 ? ` (attempt ${submission.attemptNo})` : ""}
          </p>

          {/* Files */}
          {submission.fileDownloadUrls.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {submission.fileDownloadUrls.map((f) => (
                <li key={f.key}>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Download submitted file (opens in new tab)`}
                    data-testid="submission-file-link"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Download file
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Text — DOMPurify sanitized (student-submitted content, AC-J8) */}
          {submission.text ? (
            <div
              className="prose prose-sm max-w-none overflow-x-auto text-fg prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(submission.text) }}
              data-testid="submission-text"
            />
          ) : null}

          {/* Link */}
          {submission.link ? (
            <a
              href={submission.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 break-all text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View submitted link (opens in new tab)"
              data-testid="submission-link"
            >
              {submission.link}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}

          {/* Resubmit button */}
          {canResubmit && !showResubmitForm ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowResubmitForm(true)}
              className="mt-4"
              data-testid="assignment-resubmit-btn"
            >
              Submit again
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* Sent back for changes — the reviewer's reason, and what to do about it. Placed
          ABOVE the grade block and styled as an action, not a verdict: this is the one
          post-submission state that requires the student to do something. */}
      {isReturned && submission ? (
        <section
          role="alert"
          className="mt-6 rounded-lg border border-warning/30 bg-warning/5 p-4"
          data-testid="assignment-returned-notice"
        >
          <h2 className="text-sm font-semibold text-fg">Changes needed before this can be accepted</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Your work hasn&apos;t been graded yet. Make the changes below and submit it again.
          </p>
          {submission.feedback ? (
            <div className="mt-3 rounded-md border border-border bg-bg p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">What to change</p>
              <ReturnedReason reason={submission.feedback} />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Grade + feedback */}
      {isGraded && submission ? (
        <GradeFeedback
          score={submission.score}
          maxScore={submission.maxScore}
          feedback={submission.feedback}
          rubric={submission.rubric as Record<string, unknown> | null}
          gradedAt={submission.gradedAt}
          gradedByName={submission.gradedByName}
        />
      ) : null}

      {/* Submission form */}
      {isOverdue && !submission ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
          data-testid="assignment-overdue-notice"
        >
          This assignment is past its due date. Submission is no longer accepted.
        </div>
      ) : showForm ? (
        <SubmissionForm
          assignmentId={assignmentId}
          canResubmit={canResubmit}
          isDisabled={false}
          onSubmitted={() => {
            setShowResubmitForm(false);
          }}
        />
      ) : isSubmitted ? (
        <div
          className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted"
          data-testid="assignment-pending-grade"
        >
          Your assignment has been submitted and is awaiting grading.
          {canResubmit ? " You may resubmit once it has been reviewed." : ""}
        </div>
      ) : null}
    </div>
  );
}
