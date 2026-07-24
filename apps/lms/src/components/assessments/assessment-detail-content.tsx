// AssessmentDetailContent — student assessment detail + quiz runner.
//
// Renders two views:
//   1. Pre-attempt: metadata (time limit, attempts remaining, pass %, etc.) + Start button.
//   2. In-attempt: QuizRunner with CountdownTimer + answer collection + submit.
//   3. Post-submit: instant score for MCQ, pending notice for descriptive.
//
// SECURITY GUARANTEE (AC-D2, AC-J9):
//   - Questions arrive from startAttempt() as AssessmentQuestionPublic[] — NO answer key.
//   - QuizRunner receives ONLY the public types — answerKey/isCorrect NEVER in DOM.
//   - Tab-switch events are reported via flagAttempt() (advisory signal — AC-D6).
//   - timer onExpire calls submitAttempt (client timer is advisory; server enforces time_expires_at).
//
// CLAUDE.md §3: no business logic in components.
"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  CountdownTimer,
  EmptyState,
  QuizRunner,
  Skeleton,
  StatusChip,
  type QuizAnswers,
  type AssessmentQuestionPublic as UIAssessmentQuestionPublic,
} from "@repo/ui";
import type {
  AssessmentDetailPublic,
  AttemptInProgress,
  AttemptResult,
  AssessmentQuestionPublic,
  SubmitAttemptRequest,
} from "@repo/types";

import {
  useAssessmentDetail,
  useStartAttempt,
  useSubmitAttempt,
  useFlagAttempt,
} from "../../hooks/use-assessments";

// ---------------------------------------------------------------------------
// Type assertion: ensure @repo/types AssessmentQuestionPublic is compatible with
// @repo/ui QuizRunner's AssessmentQuestionPublic (same structure, both omit answer key).
// ---------------------------------------------------------------------------

// Both types have: id, type, prompt, options?, points, order.
// This cast is safe because @repo/ui's type is a structural superset of what
// the backend returns — both omit answerKey.
function toUiQuestions(questions: AssessmentQuestionPublic[]): UIAssessmentQuestionPublic[] {
  // Map @repo/types type to @repo/ui type.
  // @repo/types QuestionType = "mcq" | "descriptive"
  // @repo/ui QuizQuestionType = "mcq_single" | "mcq_multi" | "descriptive"
  // We map "mcq" → "mcq_single" (server decides if multi — single select for P4).
  return questions.map((q) => ({
    id: q.id,
    type: q.type === "mcq" ? "mcq_single" : "descriptive",
    prompt: q.prompt,
    options: q.options?.map((o) => ({ id: o.id, text: o.text })) ?? undefined,
    points: q.points,
    order: q.order,
  }));
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AssessmentDetailSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading assessment">
      <Skeleton shape="line" className="mb-3 h-7 w-2/3" />
      <Skeleton shape="line" className="mb-6 h-4 w-1/3" />
      <Skeleton shape="block" className="h-48 w-full rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-attempt metadata view
// ---------------------------------------------------------------------------

interface PreAttemptViewProps {
  assessment: AssessmentDetailPublic;
  onStart: () => Promise<void>;
  isStarting: boolean;
  startError: string | null;
  /** Called when the retry cooldown countdown reaches zero — reloads the assessment so the fresh attempt set opens. */
  onCooldownEnd: () => void;
}

function PreAttemptView({
  assessment,
  onStart,
  isStarting,
  startError,
  onCooldownEnd,
}: PreAttemptViewProps): React.JSX.Element {
  const canStart = assessment.attemptsRemaining > 0 && !assessment.hasPassingAttempt;
  const hasExhausted = assessment.attemptsAllowed > 0 && assessment.attemptsRemaining <= 0;
  // In cooldown when exhausted (and not passed) with a future retry time.
  const inCooldown =
    hasExhausted &&
    !assessment.hasPassingAttempt &&
    assessment.retryAvailableAt != null &&
    new Date(assessment.retryAvailableAt).getTime() > Date.now();

  const formatTime = (s: number | null): string => {
    if (s === null) return "Untimed";
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m} minutes`;
  };

  return (
    <div data-testid="assessment-pre-attempt">
      {/* Metadata card */}
      <div
        className="mb-6 rounded-lg border border-border bg-card p-5"
        data-testid="assessment-metadata"
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Type</dt>
            <dd className="mt-0.5 font-medium text-fg capitalize">{assessment.type}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Time limit</dt>
            <dd className="mt-0.5 font-medium text-fg">{formatTime(assessment.timeLimitS)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Questions</dt>
            <dd className="mt-0.5 font-medium text-fg">{assessment.questionCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Total points</dt>
            <dd className="mt-0.5 font-medium text-fg">{assessment.totalPoints}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Pass score</dt>
            <dd className="mt-0.5 font-medium text-fg">{assessment.passPct}%</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Attempts</dt>
            <dd className="mt-0.5 font-medium text-fg">
              {assessment.attemptsAllowed - assessment.attemptsRemaining} of {assessment.attemptsAllowed} used
            </dd>
          </div>
        </dl>

        {assessment.isRequired ? (
          <p className="mt-4 text-xs font-medium text-brand-500">
            Required for certificate eligibility
          </p>
        ) : null}
      </div>

      {/* Passing status */}
      {assessment.hasPassingAttempt ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success"
          data-testid="assessment-passed-notice"
          role="status"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          You have already passed this assessment.
        </div>
      ) : null}

      {/* Cooldown notice — attempts used, but a fresh set reopens automatically after the timer. */}
      {inCooldown && assessment.retryAvailableAt ? (
        <div
          className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-4"
          data-testid="assessment-cooldown-notice"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Clock className="size-4 shrink-0 text-warning" aria-hidden="true" />
            You&apos;ve used all {assessment.attemptsAllowed} attempt
            {assessment.attemptsAllowed !== 1 ? "s" : ""} for now.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span>A fresh set of attempts unlocks in</span>
            <CountdownTimer
              expiresAt={assessment.retryAvailableAt}
              onExpire={onCooldownEnd}
              className="font-semibold text-fg"
              data-testid="assessment-cooldown-timer"
            />
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Use this time to prepare — this page reopens on its own when the timer ends. No need to refresh.
          </p>
        </div>
      ) : null}

      {/* Hard-exhausted fallback (no retry scheduled — e.g. retries disabled). */}
      {hasExhausted && !assessment.hasPassingAttempt && !inCooldown ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          data-testid="assessment-exhausted-notice"
          role="alert"
        >
          <XCircle className="size-4 shrink-0" aria-hidden="true" />
          You have used all {assessment.attemptsAllowed} attempt{assessment.attemptsAllowed !== 1 ? "s" : ""}.
          No more attempts are allowed right now.
        </div>
      ) : null}

      {/* Start error */}
      {startError ? (
        <p role="alert" className="mb-4 text-sm text-danger" data-testid="start-attempt-error">
          {startError}
        </p>
      ) : null}

      {/* Start button */}
      {canStart ? (
        <Button
          variant="primary"
          loading={isStarting}
          disabled={isStarting}
          onClick={() => void onStart()}
          data-testid="start-attempt-btn"
          className="w-full sm:w-auto"
        >
          Start {assessment.type}
          {assessment.attemptsRemaining < assessment.attemptsAllowed
            ? ` (attempt ${assessment.attemptsAllowed - assessment.attemptsRemaining + 1} of ${assessment.attemptsAllowed})`
            : ""}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-submit results view
// ---------------------------------------------------------------------------

interface ResultsViewProps {
  result: AttemptResult;
  passPct: number;
}

function ResultsView({ result, passPct }: ResultsViewProps): React.JSX.Element {
  const passThreshold = Math.round((result.totalPoints * passPct) / 100);

  return (
    <section
      aria-labelledby="results-heading"
      className="mt-4 rounded-lg border border-border bg-card p-6"
      data-testid="attempt-results"
    >
      <h2 id="results-heading" className="mb-4 text-lg font-semibold text-fg">
        Results
      </h2>

      {/* Score */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-4xl font-bold tabular-nums text-fg" aria-label={`Score: ${result.score ?? 0} of ${result.totalPoints}`}>
          {result.score ?? 0}
        </span>
        <span className="text-xl text-fg-muted">/ {result.totalPoints}</span>
        {result.passed !== null ? (
          <StatusChip
            tone={result.passed ? "success" : "danger"}
            label={result.passed ? "Passed" : "Not passed"}
            data-testid="attempt-passed-chip"
          />
        ) : (
          <StatusChip
            tone="neutral"
            label="Pending review"
            data-testid="attempt-pending-chip"
          />
        )}
      </div>

      {/* Pass threshold */}
      <p className="mb-4 text-sm text-fg-muted">
        Pass score: {passThreshold} points ({passPct}%)
      </p>

      {/* Pending manual grade notice */}
      {result.hasPendingManualGrade ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted"
          data-testid="attempt-pending-grade-notice"
          role="status"
        >
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          Some answers are awaiting manual grading by your faculty.
        </div>
      ) : null}

      {/* Attempts remaining */}
      {result.attemptsRemaining > 0 && result.passed !== true ? (
        <p className="text-sm text-fg-muted" data-testid="attempts-remaining">
          You have {result.attemptsRemaining} attempt{result.attemptsRemaining !== 1 ? "s" : ""} remaining.
        </p>
      ) : null}

      {/* Per-question results */}
      {result.questionResults && result.questionResults.length > 0 ? (
        <div className="mt-5" data-testid="question-results">
          <h3 className="mb-3 text-sm font-semibold text-fg-muted uppercase tracking-wide">
            Per-question breakdown
          </h3>
          <ul className="flex flex-col gap-2">
            {result.questionResults.map((qr, i) => (
              <li
                key={qr.questionId}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm"
                data-testid={`question-result-${qr.questionId}`}
              >
                <span className="text-fg-muted">Question {i + 1}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">
                    {qr.earnedPoints}/{qr.maxPoints} pts
                  </span>
                  {qr.type === "mcq" && qr.isCorrectForMcq !== null ? (
                    <StatusChip
                      tone={qr.isCorrectForMcq ? "success" : "danger"}
                      label={qr.isCorrectForMcq ? "Correct" : "Incorrect"}
                      size="sm"
                    />
                  ) : qr.isPendingManualGrade ? (
                    <StatusChip tone="neutral" label="Pending" size="sm" />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex gap-3">
        <Button asChild variant="secondary" size="sm" data-testid="back-to-assessments-btn">
          <Link href="/assessments">All assessments</Link>
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssessmentDetailContent — top-level client component
// ---------------------------------------------------------------------------

interface AssessmentDetailContentProps {
  assessmentId: string;
}

export function AssessmentDetailContent({ assessmentId }: AssessmentDetailContentProps): React.JSX.Element {
  const { assessment, isLoading, isSignedOut, isError, error, refetch } =
    useAssessmentDetail(assessmentId);
  const { startAttempt, isStarting, error: startError } = useStartAttempt();
  const { submitAttempt, isSubmitting } = useSubmitAttempt();
  const { flagAttempt } = useFlagAttempt();

  const [activeAttempt, setActiveAttempt] = React.useState<AttemptInProgress | null>(null);
  const [result, setResult] = React.useState<AttemptResult | null>(null);

  if (isLoading) return <AssessmentDetailSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="assessment-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to access this assessment.</CardDescription>
        </CardHeader>
        <CardFooter><Button asChild><a href="/login">Sign in</a></Button></CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="assessment-error">
        <CardHeader>
          <CardTitle>Failed to load assessment</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="assessment-retry">Try again</Button>
        </CardFooter>
      </Card>
    );
  }

  if (!assessment) {
    return (
      <EmptyState
        data-testid="assessment-not-found"
        title="Assessment not found"
        description="This assessment doesn't exist or is not available for your enrollment."
        action={
          <Button asChild variant="secondary">
            <Link href="/assessments">Back to assessments</Link>
          </Button>
        }
      />
    );
  }

  const handleStart = async (): Promise<void> => {
    const inProgress = await startAttempt(assessmentId);
    setActiveAttempt(inProgress);
    setResult(null);
  };

  const handleSubmit = async (answers: QuizAnswers, tabSwitchCount: number): Promise<void> => {
    if (!activeAttempt) return;

    // Convert QuizRunner QuizAnswers to AttemptAnswers DTO
    const answersPayload = Object.entries(answers)
      .filter(([, v]) => v !== undefined)
      .map(([questionId, value]) => ({
        questionId,
        value: (Array.isArray(value) ? value : value ?? "") as string | string[],
      }));

    const body: SubmitAttemptRequest = {
      answers: answersPayload,
      flags: { tabSwitchCount },
    };

    const attemptResult = await submitAttempt(activeAttempt.attempt.id, body);
    setResult(attemptResult);
    setActiveAttempt(null);
  };

  const handleExpire = (): void => {
    // Timer expired — QuizRunner calls onSubmit automatically after onExpire
    // No additional action needed here; the QuizRunner already calls onSubmit
  };

  const handleTabSwitchFlag = (attemptId: string): void => {
    flagAttempt(attemptId, { event: "tab_switch" });
  };

  return (
    <div data-testid="assessment-detail-content">
      {/* Back link (only show when not in-attempt) */}
      {!activeAttempt ? (
        <Link
          href="/assessments"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="assessment-detail-back"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All assessments
        </Link>
      ) : null}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg" data-testid="assessment-title">
            {assessment.title}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{assessment.moduleTitle}</p>
        </div>
        {!activeAttempt ? (
          (() => {
            const passed = assessment.hasPassingAttempt;
            const exhausted = assessment.attemptsRemaining <= 0;
            const cooling =
              !passed &&
              exhausted &&
              assessment.retryAvailableAt != null &&
              new Date(assessment.retryAvailableAt).getTime() > Date.now();
            return (
              <StatusChip
                tone={passed ? "success" : cooling ? "warning" : "neutral"}
                label={passed ? "Passed" : cooling ? "Cooldown" : exhausted ? "Exhausted" : "Not started"}
                data-testid="assessment-list-status"
              />
            );
          })()
        ) : null}
      </div>

      {/* Main content area */}
      {activeAttempt ? (
        /* In-attempt: QuizRunner with server-authoritative timer */
        <div data-testid="assessment-in-attempt">
          <QuizRunner
            // Pass PUBLIC questions only — no answer key (AC-D2, AC-J9)
            questions={toUiQuestions(activeAttempt.questions)}
            // time_expires_at from server (authoritative); client timer is advisory
            expiresAt={activeAttempt.attempt.timeExpiresAt ?? undefined}
            onSubmit={({ answers, tabSwitchCount }) => {
              // Report tab switch advisory signal before submitting
              if (tabSwitchCount > 0) {
                handleTabSwitchFlag(activeAttempt.attempt.id);
              }
              void handleSubmit(answers, tabSwitchCount);
            }}
            onExpire={handleExpire}
            submitting={isSubmitting}
            data-testid="quiz-runner"
          />
        </div>
      ) : result ? (
        /* Post-submit: results */
        <ResultsView result={result} passPct={assessment.passPct} />
      ) : (
        /* Pre-attempt: metadata + start button */
        <PreAttemptView
          assessment={assessment}
          onStart={handleStart}
          isStarting={isStarting}
          startError={startError?.problem.detail ?? startError?.problem.title ?? null}
          onCooldownEnd={refetch}
        />
      )}
    </div>
  );
}
