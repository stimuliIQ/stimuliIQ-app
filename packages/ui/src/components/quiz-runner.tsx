"use client";

import * as React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Send } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";
import { CountdownTimer } from "./countdown-timer";

/**
 * QuizRunner / QuestionCard — student-facing assessment UI.
 *
 * Per docs/02-prd-lms.md §7.9 and docs/07-design-system.md §5/§11.
 *
 * SECURITY CONTRACT (verified in tests):
 * - The component receives `AssessmentQuestionPublic[]` — prompts + options ONLY.
 * - There is NO `isCorrect`, `answerKey`, or `correctOptionId` field on the question
 *   or option types exported here. The TypeScript types structurally enforce this.
 * - Shuffle is done server-side; the component receives already-ordered questions and
 *   does NOT reorder them (no answer-key dependency).
 *
 * ANTI-CHEAT (basics only per docs/02 §7.9 and P4 scope):
 * - Tab-switch / visibility-blur events are counted and included in the `onSubmit`
 *   payload as `tabSwitchCount`. The component does NOT hard-block the user (server
 *   is authoritative); it just counts and reports.
 *
 * a11y rules (docs/07 §11):
 * - MCQ options are radio buttons (single) or checkboxes (multi) in a <fieldset>
 *   with a <legend> = the question prompt.
 * - Descriptive questions: a labelled <textarea>.
 * - Focus moves to the first control of the new question on navigation.
 * - Timer announces politely via aria-live (inside CountdownTimer).
 * - prefers-reduced-motion: the animated question-transition is disabled.
 *
 * Usage:
 *   <QuizRunner
 *     questions={publicQuestions}   // NO answer key fields present
 *     expiresAt={attempt.time_expires_at}
 *     onSubmit={(answers, tabSwitchCount) => submitAttempt({ answers, tabSwitchCount })}
 *     onExpire={() => void submitAttempt({ answers: currentAnswers, tabSwitchCount })}
 *     submitting={isSubmitting}
 *   />
 */

// ---------------------------------------------------------------------------
// Public-only question types — NO answer-key fields
// ---------------------------------------------------------------------------

/** A single MCQ option. No `isCorrect` / `answerKey` field. */
export interface QuizOption {
  id: string;
  text: string;
}

/** Question types supported in QuizRunner. */
export type QuizQuestionType = "mcq_single" | "mcq_multi" | "descriptive";

/**
 * Public question shape — ONLY what the student sees.
 * TypeScript structurally prevents adding `answerKey` / `isCorrect` / `correctOptionId`
 * because they are simply not declared here. Tests assert this.
 */
export interface AssessmentQuestionPublic {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** Present only for MCQ types; absent for descriptive. */
  options?: QuizOption[];
  /** Point value (display-only). */
  points: number;
  /** 1-based display order (already-shuffled server-side). */
  order: number;
}

// ---------------------------------------------------------------------------
// Answer map type
// ---------------------------------------------------------------------------

/** Map of question id → answer. For MCQ: selected option id(s). For descriptive: text. */
export type QuizAnswers = Record<
  string,
  | string        // MCQ single: selected option id
  | string[]      // MCQ multi: selected option ids
  | undefined     // not yet answered
>;

// ---------------------------------------------------------------------------
// QuestionCard
// ---------------------------------------------------------------------------

export interface QuestionCardProps {
  question: AssessmentQuestionPublic;
  /** 1-based index for display ("Question 3 of 10"). */
  index: number;
  total: number;
  answer: string | string[] | undefined;
  onAnswerChange: (questionId: string, answer: string | string[] | undefined) => void;
  /** If true, all controls are disabled (after submission or time-up). */
  disabled?: boolean;
  /** Test hook; defaults to "question-card" when omitted. */
  "data-testid"?: string;
}

// Internal ref used to focus the first control when the card becomes visible.
const QuestionCard = React.forwardRef<HTMLDivElement, QuestionCardProps>(
  (
    {
      question,
      index,
      total,
      answer,
      onAnswerChange,
      disabled = false,
      "data-testid": testId,
    },
    ref,
  ) => {
    const legendId = React.useId();
    const textareaId = React.useId();

    const handleMcqSingleChange = (optionId: string) => {
      onAnswerChange(question.id, optionId);
    };

    const handleMcqMultiChange = (optionId: string, checked: boolean) => {
      const current = Array.isArray(answer) ? answer : [];
      const next = checked ? [...current, optionId] : current.filter((id) => id !== optionId);
      onAnswerChange(question.id, next.length > 0 ? next : undefined);
    };

    const handleDescriptiveChange = (text: string) => {
      onAnswerChange(question.id, text.length > 0 ? text : undefined);
    };

    return (
      <div
        ref={ref}
        data-testid={testId ?? "question-card"}
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6"
      >
        {/* Question header */}
        <div className="flex items-start justify-between gap-4">
          <span className="text-xs font-medium text-fg-muted" aria-hidden="true">
            Question {index} of {total}
          </span>
          <span
            className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted"
            aria-label={`${question.points} point${question.points === 1 ? "" : "s"}`}
            aria-hidden="true"
          >
            {question.points} pt{question.points === 1 ? "" : "s"}
          </span>
        </div>

        {/* MCQ single / multi */}
        {(question.type === "mcq_single" || question.type === "mcq_multi") && question.options ? (
          <fieldset className="flex flex-col gap-1 border-0 p-0">
            <legend
              id={legendId}
              className="mb-3 text-base font-medium leading-snug text-fg"
            >
              {question.prompt}
            </legend>
            <div
              role="group"
              aria-describedby={legendId}
              className="flex flex-col gap-2"
            >
              {question.options.map((option) => {
                const optInputId = `${legendId}-opt-${option.id}`;
                const isSelected =
                  question.type === "mcq_single"
                    ? answer === option.id
                    : Array.isArray(answer) && answer.includes(option.id);

                if (question.type === "mcq_single") {
                  return (
                    <label
                      key={option.id}
                      htmlFor={optInputId}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors duration-fast",
                        "hover:bg-surface",
                        isSelected
                          ? "border-brand-500 bg-brand-50 text-fg"
                          : "border-border bg-bg text-fg",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                      data-testid={`option-${option.id}`}
                    >
                      <input
                        id={optInputId}
                        type="radio"
                        name={`q-${question.id}`}
                        value={option.id}
                        checked={isSelected}
                        onChange={() => handleMcqSingleChange(option.id)}
                        disabled={disabled}
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 accent-brand-500",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                        )}
                      />
                      {option.text}
                    </label>
                  );
                }

                // mcq_multi
                return (
                  <label
                    key={option.id}
                    htmlFor={optInputId}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors duration-fast",
                      "hover:bg-surface",
                      isSelected
                        ? "border-brand-500 bg-brand-50 text-fg"
                        : "border-border bg-bg text-fg",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                    data-testid={`option-${option.id}`}
                  >
                    <input
                      id={optInputId}
                      type="checkbox"
                      value={option.id}
                      checked={isSelected}
                      onChange={(e) => handleMcqMultiChange(option.id, e.target.checked)}
                      disabled={disabled}
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0 accent-brand-500",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                      )}
                    />
                    {option.text}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {/* Descriptive */}
        {question.type === "descriptive" ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor={textareaId}
              className="text-base font-medium leading-snug text-fg"
            >
              {question.prompt}
            </label>
            <textarea
              id={textareaId}
              value={typeof answer === "string" ? answer : ""}
              onChange={(e) => handleDescriptiveChange(e.target.value)}
              disabled={disabled}
              rows={5}
              placeholder="Write your answer here…"
              className={cn(
                "w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg",
                "placeholder:text-fg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
              data-testid={`question-${question.id}-textarea`}
            />
          </div>
        ) : null}
      </div>
    );
  },
);
QuestionCard.displayName = "QuestionCard";

// ---------------------------------------------------------------------------
// QuizRunner
// ---------------------------------------------------------------------------

export interface QuizRunnerSubmitPayload {
  answers: QuizAnswers;
  tabSwitchCount: number;
}

export interface QuizRunnerProps {
  /**
   * Already-shuffled questions from the server — public shape only, NO answer key.
   * Shuffle happens server-side; this component does not reorder.
   */
  questions: AssessmentQuestionPublic[];
  /**
   * Server-computed expiry (ISO string or Date). Passed through to CountdownTimer.
   * When null/undefined, no timer is shown (untimed assessment).
   */
  expiresAt?: string | Date | null;
  /**
   * Called when the student submits or when time expires.
   * The payload includes current answers + the tab-switch count.
   */
  onSubmit: (payload: QuizRunnerSubmitPayload) => void;
  /**
   * Called when the CountdownTimer reaches 0 (server is still authoritative).
   * The component also auto-calls onSubmit with current state on expire.
   */
  onExpire?: () => void;
  /** Whether a submit action is in-flight. Disables navigation + submit button. */
  submitting?: boolean;
  /** Test hook; defaults to "quiz-runner" when omitted. */
  "data-testid"?: string;
}

export function QuizRunner({
  questions,
  expiresAt,
  onSubmit,
  onExpire,
  submitting = false,
  "data-testid": testId,
}: QuizRunnerProps): React.JSX.Element {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<QuizAnswers>({});
  const [tabSwitchCount, setTabSwitchCount] = React.useState(0);
  const [expired, setExpired] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const firstControlRef = React.useRef<HTMLDivElement>(null);

  // Basics-only anti-cheat: count tab-switch / visibility blur events.
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Focus the first interactive element when the current question changes.
  React.useEffect(() => {
    const firstFocusable = firstControlRef.current?.querySelector<HTMLElement>(
      "input, textarea, button",
    );
    firstFocusable?.focus({ preventScroll: false });
  }, [currentIndex]);

  const handleAnswerChange = (questionId: string, answer: string | string[] | undefined) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleExpire = React.useCallback(() => {
    setExpired(true);
    onExpire?.();
    // Auto-submit with whatever answers were given so far.
    onSubmit({ answers, tabSwitchCount });
    // Intentional snapshot of answers/tabSwitchCount at expiry (react-hooks/exhaustive-deps
    // is not registered in @repo/ui's flat config, so no disable directive is used here).
  }, [answers, tabSwitchCount, onExpire, onSubmit]);

  const handleSubmit = () => {
    onSubmit({ answers, tabSwitchCount });
  };

  const isDisabled = submitting || expired;
  const total = questions.length;
  const current = questions[currentIndex];
  const isLastQuestion = currentIndex === total - 1;

  // Progress: answered count (any non-undefined answer).
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;
  const unansweredCount = total - answeredCount;
  const allAnswered = unansweredCount === 0;

  // Jump to the first unanswered question — helps a student find what's left before submitting.
  const goToFirstUnanswered = () => {
    const idx = questions.findIndex((q) => answers[q.id] === undefined);
    if (idx >= 0) setCurrentIndex(idx);
  };

  if (total === 0) {
    return (
      <div
        data-testid={testId ?? "quiz-runner"}
        className="flex items-center justify-center rounded-lg border border-border bg-card p-12 text-sm text-fg-muted"
      >
        No questions available.
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? "quiz-runner"}
      className="flex flex-col gap-5"
    >
      {/* Header: timer + progress */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Progress indicator */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-fg-muted"
          >
            <span className="font-medium text-fg">{answeredCount}</span>
            {" of "}
            <span className="font-medium text-fg">{total}</span>
            {" answered"}
          </div>

          {/* Progress bar (visual only) */}
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-border"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-base ease-out"
              style={{ width: `${(answeredCount / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Timer */}
        {expiresAt ? (
          <CountdownTimer
            expiresAt={expiresAt}
            onExpire={handleExpire}
            data-testid="quiz-runner-timer"
          />
        ) : null}

        {/* Expired banner */}
        {expired ? (
          <div
            role="alert"
            className="flex items-center gap-1.5 text-sm font-medium text-danger"
            data-testid="quiz-runner-expired"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Time is up — your answers have been submitted.
          </div>
        ) : null}
      </div>

      {/* Question nav dots */}
      <nav
        aria-label="Question navigation"
        className="flex flex-wrap gap-1.5"
        data-testid="quiz-runner-nav"
      >
        {questions.map((q, i) => {
          const isAnswered = answers[q.id] !== undefined;
          const isCurrent = i === currentIndex;
          return (
            <button
              key={q.id}
              type="button"
              aria-label={`Question ${i + 1}${isAnswered ? " (answered)" : ""}${isCurrent ? ", current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => setCurrentIndex(i)}
              disabled={isDisabled}
              className={cn(
                "h-7 w-7 rounded-md border text-xs font-medium",
                "transition-colors duration-fast ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                "disabled:pointer-events-none disabled:opacity-50",
                isCurrent
                  ? "border-brand-500 bg-brand-500 text-white"
                  : isAnswered
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-border bg-surface text-fg-muted hover:bg-card hover:text-fg",
              )}
              data-testid={`quiz-nav-${i + 1}`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>

      {/* Legend — clarifies what the numbered chips mean. */}
      <div
        className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-brand-500 bg-brand-500" />
          Current
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-success/40 bg-success/10" />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border bg-surface" />
          Not answered
        </span>
      </div>

      {/* Current question */}
      {current ? (
        <div
          className={cn(
            "transition-opacity duration-fast",
            "motion-reduce:transition-none",
          )}
        >
          <QuestionCard
            ref={firstControlRef}
            key={current.id}
            question={current}
            index={currentIndex + 1}
            total={total}
            answer={answers[current.id]}
            onAnswerChange={handleAnswerChange}
            disabled={isDisabled}
          />
        </div>
      ) : null}

      {/* Navigation + submit.
          Clearer flow (per feedback): Next moves through questions; Submit appears only on the
          LAST question, is disabled until every question is answered, and asks for confirmation. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0 || isDisabled}
            aria-label="Go to previous question"
            data-testid="quiz-runner-prev"
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>

          {!isLastQuestion ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
              disabled={isDisabled}
              aria-label="Go to next question"
              data-testid="quiz-runner-next"
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : !expired ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setConfirmOpen(true)}
              loading={submitting}
              disabled={isDisabled || !allAnswered}
              aria-label={`Submit assessment (${answeredCount} of ${total} questions answered)`}
              data-testid="quiz-runner-submit"
            >
              <Send aria-hidden="true" />
              Submit
            </Button>
          ) : null}
        </div>

        {/* Why-disabled helper on the last question — tells the student exactly what's left. */}
        {isLastQuestion && !expired && !allAnswered ? (
          <div
            className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-fg-muted"
            data-testid="quiz-runner-submit-hint"
          >
            <span>
              Answer all questions to submit — {unansweredCount} left.
            </span>
            <button
              type="button"
              onClick={goToFirstUnanswered}
              disabled={isDisabled}
              className={cn(
                "font-medium text-brand-500 underline underline-offset-2",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              data-testid="quiz-runner-goto-unanswered"
            >
              Go to first unanswered
            </button>
          </div>
        ) : null}
      </div>

      {/* Submit confirmation — explicit "are you sure?" step before the answers are sent. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit your answers?"
        description={
          `You've answered all ${total} question${total === 1 ? "" : "s"}. ` +
          "Once submitted you can't change your answers for this attempt."
        }
        confirmLabel="Submit"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmOpen(false);
          handleSubmit();
        }}
        loading={submitting}
        data-testid="quiz-runner-submit-confirm"
      />
    </div>
  );
}

// Re-export QuestionCard so it can be used standalone (e.g. in review mode).
export { QuestionCard };
