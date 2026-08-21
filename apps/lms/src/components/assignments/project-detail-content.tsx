// ProjectDetailContent — student project milestone submission + feedback view.
//
// Projects are assignments with kind='project'. Each milestone must be submitted
// separately. Faculty reviews each milestone and provides feedback.
// Final project approval (all milestones graded) gates certificate eligibility.
//
// SECURITY: Milestone feedback sanitized with DOMPurify (AC-J8).
// CLAUDE.md §3: no business logic in components — hooks own fetch+mutate.
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, FolderKanban, XCircle } from "lucide-react";
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
  type StatusChipTone,
} from "@repo/ui";
import type { MilestoneReviewState, ProjectDetail, SubmitAssignmentRequest } from "@repo/types";

import {
  useMyProject,
  useSubmitMilestone,
  useRequestUploadUrl,
} from "../../hooks/use-assignments";
import { sanitizeHtml } from "../../lib/sanitize";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function milestoneStatusTone(status: MilestoneReviewState["submissionStatus"]): StatusChipTone {
  switch (status) {
    case "graded": return "success";
    case "submitted": return "info";
    case "returned": return "warning";
    default: return "neutral";
  }
}

function milestoneStatusLabel(status: MilestoneReviewState["submissionStatus"]): string {
  switch (status) {
    case "graded": return "Graded";
    case "submitted": return "Submitted";
    case "returned": return "Returned";
    default: return "Not submitted";
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ProjectDetailSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading project">
      <Skeleton shape="line" className="mb-3 h-7 w-2/3" />
      <Skeleton shape="line" className="mb-6 h-4 w-1/3" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} shape="block" className="mb-4 h-32 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone submission mini-form
// ---------------------------------------------------------------------------

interface MilestoneSubmitFormProps {
  assignmentId: string;
  milestoneId: string;
  milestoneTitle: string;
  onSubmitted: () => void;
}

function MilestoneSubmitForm({
  assignmentId,
  milestoneId,
  milestoneTitle,
  onSubmitted,
}: MilestoneSubmitFormProps): React.JSX.Element {
  const [storageKeys, setStorageKeys] = React.useState<string[]>([]);
  const [link, setLink] = React.useState("");
  const [text, setText] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const { submitMilestone, isSubmitting, error } = useSubmitMilestone();
  const requestUploadUrl = useRequestUploadUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (storageKeys.length === 0 && !link.trim() && !text.trim()) {
      setValidationError("Please provide at least one: file upload, link, or text.");
      return;
    }

    const body: SubmitAssignmentRequest = {
      files: storageKeys,
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(link.trim() ? { link: link.trim() } : {}),
    };

    try {
      await submitMilestone(assignmentId, milestoneId, body);
      onSubmitted();
    } catch {
      // error displayed from mutation.error
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      data-testid={`milestone-submit-form-${milestoneId}`}
      className="mt-3 flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
    >
      <h4 className="text-sm font-semibold text-fg">
        Submit: {milestoneTitle}
      </h4>

      <FileUpload
        requestUploadUrl={requestUploadUrl}
        onUploaded={(k) => setStorageKeys((p) => [...p, k])}
        onRemoved={(k) => { if (k) setStorageKeys((p) => p.filter((x) => x !== k)); }}
        multiple
        maxBytes={50 * 1024 * 1024}
        acceptedTypes={["application/pdf", "image/*", "application/zip", "text/plain"]}
        disabled={isSubmitting}
        label={`Upload files for ${milestoneTitle}`}
        data-testid={`milestone-file-upload-${milestoneId}`}
      />

      <div>
        <label htmlFor={`milestone-link-${milestoneId}`} className="mb-1 block text-xs font-medium text-fg">
          Link (repository, demo, etc.)
        </label>
        <input
          id={`milestone-link-${milestoneId}`}
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://github.com/..."
          disabled={isSubmitting}
          className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
          data-testid={`milestone-link-input-${milestoneId}`}
        />
      </div>

      <div>
        <label htmlFor={`milestone-text-${milestoneId}`} className="mb-1 block text-xs font-medium text-fg">
          Notes
        </label>
        <textarea
          id={`milestone-text-${milestoneId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Additional notes about this milestone..."
          disabled={isSubmitting}
          className="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
          data-testid={`milestone-text-input-${milestoneId}`}
        />
      </div>

      {validationError ? (
        <p role="alert" className="text-xs text-danger">{validationError}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error.problem.detail ?? error.problem.title ?? "Submit failed."}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="sm"
        loading={isSubmitting}
        data-testid={`milestone-submit-btn-${milestoneId}`}
        className="self-start"
      >
        Submit milestone
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// MilestoneCard
// ---------------------------------------------------------------------------

interface MilestoneCardProps {
  state: MilestoneReviewState;
  assignmentId: string;
  index: number;
}

function MilestoneCard({ state, assignmentId, index }: MilestoneCardProps): React.JSX.Element {
  const [showForm, setShowForm] = React.useState(false);
  const isSubmitted = state.submissionStatus === "submitted" || state.submissionStatus === "graded";

  const sanitizedFeedback = React.useMemo(
    () => sanitizeHtml(state.feedback),
    [state.feedback],
  );

  const formattedDue = state.milestone.dueAt
    ? new Date(state.milestone.dueAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <li
      className="rounded-lg border border-border bg-card p-5"
      data-testid={`milestone-card-${state.milestone.id}`}
    >
      {/* Milestone header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {state.submissionStatus === "graded" ? (
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          ) : state.submissionStatus === "submitted" ? (
            <Clock className="size-4 text-brand-500" aria-hidden="true" />
          ) : (
            <XCircle className="size-4 text-fg-subtle" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-fg">
            Milestone {index}: {state.milestone.title}
          </span>
        </div>
        <StatusChip
          tone={milestoneStatusTone(state.submissionStatus)}
          label={milestoneStatusLabel(state.submissionStatus)}
          size="sm"
          data-testid={`milestone-status-${state.milestone.id}`}
        />
      </div>

      {formattedDue ? (
        <p className="mt-1 text-xs text-fg-muted">Due: {formattedDue}</p>
      ) : null}

      {/* Grade */}
      {state.submissionStatus === "graded" && state.score !== null ? (
        <p className="mt-2 text-sm font-medium text-success" aria-label={`Score: ${state.score}`}>
          Score: {state.score}
        </p>
      ) : null}

      {/* Feedback — DOMPurify sanitized (AC-J8) */}
      {sanitizedFeedback ? (
        <div className="mt-3" data-testid={`milestone-feedback-${state.milestone.id}`}>
          <h4 className="mb-1 text-xs font-medium text-fg-muted">Faculty feedback</h4>
          <div
            className="prose prose-sm max-w-none overflow-x-auto text-fg prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: sanitizedFeedback }}
          />
        </div>
      ) : null}

      {/* Submit form or button */}
      {!isSubmitted ? (
        showForm ? (
          <MilestoneSubmitForm
            assignmentId={assignmentId}
            milestoneId={state.milestone.id}
            milestoneTitle={state.milestone.title}
            onSubmitted={() => setShowForm(false)}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm(true)}
            className="mt-4"
            data-testid={`milestone-open-form-${state.milestone.id}`}
          >
            Submit milestone
          </Button>
        )
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// ProjectDetailContent — top-level client component
// ---------------------------------------------------------------------------

function overallStatusLabel(status: ProjectDetail["overallStatus"]): { tone: StatusChipTone; label: string } {
  switch (status) {
    case "graded": return { tone: "success", label: "Approved" };
    case "under_review": return { tone: "info", label: "Under review" };
    case "in_progress": return { tone: "neutral", label: "In progress" };
    default: return { tone: "neutral", label: "Not started" };
  }
}

interface ProjectDetailContentProps {
  assignmentId: string;
}

export function ProjectDetailContent({ assignmentId }: ProjectDetailContentProps): React.JSX.Element {
  const { project, isLoading, isSignedOut, isError, error, refetch } = useMyProject(assignmentId);

  if (isLoading) return <ProjectDetailSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="project-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view this project.</CardDescription>
        </CardHeader>
        <CardFooter><Button asChild><a href="/login">Sign in</a></Button></CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="project-error">
        <CardHeader>
          <CardTitle>Failed to load project</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="project-retry">Try again</Button>
        </CardFooter>
      </Card>
    );
  }

  if (!project) {
    return (
      <EmptyState
        data-testid="project-not-found"
        title="Project not found"
        description="This project doesn't exist or is not available for your enrollment."
        action={
          <Button asChild variant="secondary">
            <Link href="/assignments">Back to assignments</Link>
          </Button>
        }
      />
    );
  }

  const { tone, label } = overallStatusLabel(project.overallStatus);

  return (
    <div data-testid="project-detail-content">
      {/* Back link */}
      <Link
        href="/assignments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="project-detail-back"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All assignments
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FolderKanban className="size-5 text-fg-muted" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-fg" data-testid="project-title">
              {project.assignment.title}
            </h1>
          </div>
          <p className="text-sm text-fg-muted">{project.assignment.lessonTitle}</p>
          {project.assignment.isFinal ? (
            <p className="mt-1 text-xs font-medium text-brand-500">
              Final project, required for certificate eligibility
            </p>
          ) : null}
        </div>
        <StatusChip tone={tone} label={label} data-testid="project-overall-status" />
      </div>

      {/* Milestone list */}
      <section aria-labelledby="milestones-heading">
        <h2
          id="milestones-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Milestones ({project.milestoneStates.length})
        </h2>
        {project.milestoneStates.length === 0 ? (
          <p className="text-sm text-fg-muted">No milestones defined for this project.</p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Project milestones">
            {project.milestoneStates.map((state, i) => (
              <MilestoneCard
                key={state.milestone.id}
                state={state}
                assignmentId={assignmentId}
                index={i + 1}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
