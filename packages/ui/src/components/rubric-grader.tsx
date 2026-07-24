import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * RubricGrader — CRM grading surface. Renders a list of criteria, each with a numeric
 * score input (0–maxScore per criterion), an optional criterion description, plus a
 * global feedback textarea. Computes/displays total vs max_score. Controlled (value +
 * onChange). Keyboard-navigable between criteria.
 *
 * Per docs/07-design-system.md §5, docs/03-prd-crm.md §7.8 (assignment grading + rubric).
 *
 * Design rules (docs/07 §11):
 * - Each score input is labelled with criterion name + "score out of N".
 * - Error messages are wired to inputs via aria-describedby (not just red border).
 * - Score input validates: value must be 0–maxScore (integer).
 * - Tab-key cycles through criteria naturally (inputs are in DOM order).
 * - Status conveyed by icon + text, not color alone.
 *
 * Usage:
 *   const [value, setValue] = useState<RubricValue>({
 *     scores: { criterion_1: 8, criterion_2: null },
 *     feedback: "",
 *   });
 *   <RubricGrader
 *     criteria={[
 *       { id: "criterion_1", label: "Code quality", maxScore: 10 },
 *       { id: "criterion_2", label: "Documentation", maxScore: 5, description: "..." },
 *     ]}
 *     value={value}
 *     onChange={setValue}
 *   />
 */

export interface RubricCriterion {
  /** Unique stable id (matches the key in RubricValue.scores). */
  id: string;
  /** Display name for the criterion. */
  label: string;
  /** Maximum score for this criterion (integer ≥ 1). */
  maxScore: number;
  /** Optional descriptive rubric for this criterion. */
  description?: string;
}

export interface RubricValue {
  /** Map of criterion id → awarded score (null = not yet scored). */
  scores: Record<string, number | null>;
  /** Optional overall feedback text. */
  feedback: string;
}

export interface RubricGraderProps {
  criteria: RubricCriterion[];
  value: RubricValue;
  onChange: (value: RubricValue) => void;
  /** Whether the grader is in a read-only state (e.g. already submitted grade). */
  readOnly?: boolean;
  /** Label for the feedback textarea; defaults to "Overall feedback". */
  feedbackLabel?: string;
  /** Whether providing feedback is required. */
  feedbackRequired?: boolean;
  className?: string;
  /** Test hook; defaults to "rubric-grader" when omitted. */
  "data-testid"?: string;
}

function clampScore(raw: string, max: number): number | null {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return null;
  return Math.min(max, Math.max(0, n));
}

export function RubricGrader({
  criteria,
  value,
  onChange,
  readOnly = false,
  feedbackLabel = "Overall feedback",
  feedbackRequired = false,
  className,
  "data-testid": testId,
}: RubricGraderProps): React.JSX.Element {
  const idPrefix = React.useId();

  // Compute total awarded vs max
  const maxTotal = criteria.reduce((acc, c) => acc + c.maxScore, 0);
  const awardedTotal = criteria.reduce((acc, c) => {
    const s = value.scores[c.id];
    return acc + (s != null ? s : 0);
  }, 0);
  const allScored = criteria.every((c) => value.scores[c.id] != null);

  // Validation: track which criterion inputs are out-of-range
  const errors: Record<string, string | null> = {};
  for (const criterion of criteria) {
    const s = value.scores[criterion.id];
    if (s != null && (s < 0 || s > criterion.maxScore)) {
      errors[criterion.id] = `Score must be 0–${criterion.maxScore}`;
    } else {
      errors[criterion.id] = null;
    }
  }

  const handleScoreChange = (criterionId: string, rawValue: string, max: number) => {
    const clamped = clampScore(rawValue, max);
    onChange({
      ...value,
      scores: { ...value.scores, [criterionId]: clamped },
    });
  };

  const handleFeedbackChange = (text: string) => {
    onChange({ ...value, feedback: text });
  };

  return (
    <div
      data-testid={testId ?? "rubric-grader"}
      className={cn("flex flex-col gap-5", className)}
    >
      {/* Score total summary */}
      <div
        className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="text-sm font-medium text-fg-muted">Total score</span>
        <span
          className={cn(
            "font-mono text-lg font-semibold",
            allScored ? "text-fg" : "text-fg-muted",
          )}
          aria-label={`${awardedTotal} out of ${maxTotal} points${allScored ? "" : " — not all criteria scored"}`}
        >
          {awardedTotal}
          <span className="text-sm font-normal text-fg-muted">/{maxTotal}</span>
        </span>
      </div>

      {/* Criteria rows */}
      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="sr-only">Rubric criteria scores</legend>
        {criteria.map((criterion) => {
          const inputId = `${idPrefix}-criterion-${criterion.id}`;
          const errorId = `${idPrefix}-error-${criterion.id}`;
          const descId = criterion.description
            ? `${idPrefix}-desc-${criterion.id}`
            : undefined;
          const error = errors[criterion.id];

          return (
            <div
              key={criterion.id}
              data-testid={`rubric-criterion-${criterion.id}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-1 flex-col gap-0.5">
                  <label
                    htmlFor={inputId}
                    className="text-sm font-medium text-fg"
                  >
                    {criterion.label}
                    <span
                      className="ml-1.5 text-xs font-normal text-fg-muted"
                      aria-hidden="true"
                    >
                      (max {criterion.maxScore})
                    </span>
                  </label>
                  {criterion.description ? (
                    <p
                      id={descId}
                      className="text-xs text-fg-muted"
                      data-testid={`rubric-criterion-desc-${criterion.id}`}
                    >
                      {criterion.description}
                    </p>
                  ) : null}
                </div>

                {/* Score input */}
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      id={inputId}
                      type="number"
                      min={0}
                      max={criterion.maxScore}
                      step={1}
                      value={value.scores[criterion.id] ?? ""}
                      onChange={(e) =>
                        handleScoreChange(criterion.id, e.target.value, criterion.maxScore)
                      }
                      readOnly={readOnly}
                      disabled={readOnly}
                      aria-invalid={Boolean(error) || undefined}
                      aria-describedby={
                        [descId, error ? errorId : null].filter(Boolean).join(" ") ||
                        undefined
                      }
                      aria-label={`${criterion.label} score out of ${criterion.maxScore}`}
                      placeholder="0"
                      className={cn(
                        "h-9 w-20 rounded-md border bg-bg px-3 text-right font-mono text-sm text-fg",
                        "placeholder:text-fg-subtle",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        error
                          ? "border-danger focus-visible:ring-danger"
                          : "border-border hover:border-fg-subtle",
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className="text-sm text-fg-muted"
                    >
                      /{criterion.maxScore}
                    </span>
                  </div>

                  {/* Per-criterion error */}
                  {error ? (
                    <p
                      id={errorId}
                      role="alert"
                      className="flex items-center gap-1 text-xs text-danger"
                      data-testid={`rubric-criterion-error-${criterion.id}`}
                    >
                      <AlertCircle
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </fieldset>

      {/* Feedback textarea */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${idPrefix}-feedback`}
          className="text-sm font-medium text-fg"
        >
          {feedbackLabel}
          {feedbackRequired ? (
            <span aria-hidden="true" className="ml-1 text-danger">
              *
            </span>
          ) : null}
        </label>
        <textarea
          id={`${idPrefix}-feedback`}
          value={value.feedback}
          onChange={(e) => handleFeedbackChange(e.target.value)}
          readOnly={readOnly}
          disabled={readOnly}
          required={feedbackRequired}
          rows={4}
          placeholder="Share feedback with the student…"
          className={cn(
            "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg",
            "placeholder:text-fg-subtle",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "resize-y",
          )}
          data-testid="rubric-grader-feedback"
        />
      </div>
    </div>
  );
}
