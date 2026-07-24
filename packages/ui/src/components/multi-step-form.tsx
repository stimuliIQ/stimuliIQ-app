"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * MultiStepForm — generic multi-step form stepper for book-slot and registration flows.
 * Per docs/01-prd-website.md §7.7/§7.8, docs/07-design-system.md §5/§11.
 *
 * Responsibilities (primitive only):
 * - Renders a step progress bar/list (index + title).
 * - Renders the current step content via `steps[currentStep].content`.
 * - Exposes navigation (next/back/submit) and progress to the caller.
 * - Manages no business logic, no data fetching, no validation execution.
 * - Emits inline zod-style errors via the `errors` prop slot (caller passes these).
 * - Focus management: on step advance, focuses the step heading (sr-announcement).
 * - SR announcements: `aria-live="polite"` for step changes.
 *
 * a11y:
 * - Step heading is a <h2> with a focused ref on each step advance.
 * - Progress bar: `role="progressbar"` with aria-valuenow/max.
 * - Navigation buttons ≥44px.
 * - Form errors: `role="alert"` for inline field errors (caller renders via slot).
 * - Screen-reader live region announces step changes.
 *
 * SSR-safety: `"use client"` for focus management (DOM access via ref in effect).
 *
 * Usage:
 *   const STEPS: MultiStep[] = [
 *     { id: "program", title: "Choose Program", content: <ProgramStep onChange={...} /> },
 *     { id: "slot",    title: "Pick a Slot",    content: <SlotStep onChange={...} /> },
 *     { id: "details", title: "Your Details",   content: <DetailsStep errors={errors} /> },
 *     { id: "confirm", title: "Confirm",         content: <ConfirmStep data={data} /> },
 *   ];
 *
 *   <MultiStepForm
 *     steps={STEPS}
 *     currentStep={currentStep}
 *     onNext={handleNext}
 *     onBack={handleBack}
 *     onSubmit={handleSubmit}
 *     isLastStep={currentStep === STEPS.length - 1}
 *     isSubmitting={isSubmitting}
 *     submitLabel="Book My Slot"
 *   />
 */

export interface MultiStep {
  id: string;
  title: string;
  /** Step content rendered in the form body. */
  content: React.ReactNode;
}

export interface MultiStepFormProps {
  steps: MultiStep[];
  currentStep: number;
  /** Called to advance to the next step; caller runs validation before calling. */
  onNext?: () => void;
  onBack?: () => void;
  /** Called on final step submission. */
  onSubmit?: () => void;
  isLastStep?: boolean;
  isSubmitting?: boolean;
  nextLabel?: string;
  submitLabel?: string;
  backLabel?: string;
  /** Global form error (e.g. API error); rendered above the nav buttons. */
  formError?: string;
  className?: string;
  "data-testid"?: string;
}

export function MultiStepForm({
  steps,
  currentStep,
  onNext,
  onBack,
  onSubmit,
  isLastStep = false,
  isSubmitting = false,
  nextLabel = "Continue",
  submitLabel = "Submit",
  backLabel = "Back",
  formError,
  className,
  "data-testid": testId,
}: MultiStepFormProps): React.JSX.Element {
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const prevStepRef = React.useRef(currentStep);
  const totalSteps = steps.length;
  const step = steps[currentStep];

  // Focus the step heading whenever the current step changes (keyboard + SR UX)
  React.useEffect(() => {
    if (prevStepRef.current !== currentStep && stepHeadingRef.current) {
      stepHeadingRef.current.focus();
    }
    prevStepRef.current = currentStep;
  }, [currentStep]);

  if (!step) return <div />;

  return (
    <div
      data-testid={testId ?? "multi-step-form"}
      className={cn("flex flex-col gap-6", className)}
    >
      {/* Screen-reader step announcement */}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        Step {currentStep + 1} of {totalSteps}: {step.title}
      </p>

      {/* Progress bar */}
      <div aria-hidden="true">
        <div
          role="progressbar"
          aria-valuenow={currentStep + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Step ${currentStep + 1} of ${totalSteps}`}
          className="h-1.5 w-full rounded-full bg-surface overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-[250ms] ease-out"
            style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Step indicator row */}
      <ol
        aria-label="Form steps"
        className="flex items-center gap-0"
        role="list"
      >
        {steps.map((s, index) => {
          const isCurrent = index === currentStep;
          const isCompleted = index < currentStep;
          return (
            <li
              key={s.id}
              className="flex flex-1 flex-col items-center"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex items-center w-full">
                {/* Line before */}
                <div
                  className={cn(
                    "flex-1 h-px",
                    index === 0 ? "invisible" : "",
                    isCompleted || isCurrent ? "bg-brand-500" : "bg-border",
                  )}
                />
                {/* Step circle */}
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    isCompleted
                      ? "border-brand-500 bg-brand-500 text-white"
                      : isCurrent
                        ? "border-brand-500 bg-card text-brand-500"
                        : "border-border bg-card text-fg-subtle",
                  )}
                >
                  {isCompleted ? (
                    <Check aria-hidden="true" className="size-3.5" />
                  ) : (
                    <span aria-hidden="true">{index + 1}</span>
                  )}
                </div>
                {/* Line after */}
                <div
                  className={cn(
                    "flex-1 h-px",
                    index === steps.length - 1 ? "invisible" : "",
                    isCompleted ? "bg-brand-500" : "bg-border",
                  )}
                />
              </div>
              {/* Step label */}
              <span
                className={cn(
                  "mt-1.5 text-xs font-medium text-center px-1",
                  isCurrent ? "text-brand-500" : isCompleted ? "text-fg-muted" : "text-fg-subtle",
                )}
              >
                {s.title}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Step heading — receives focus on step change */}
      <h2
        ref={stepHeadingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-fg outline-none focus-visible:ring-0"
      >
        {step.title}
      </h2>

      {/* Step content */}
      <div role="region" aria-labelledby={undefined}>
        {step.content}
      </div>

      {/* Global form error */}
      {formError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {formError}
        </div>
      ) : null}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 pt-2">
        {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          disabled={currentStep === 0 || isSubmitting}
          className={cn(
            "flex min-h-[44px] items-center rounded-md border border-border px-5 text-sm font-medium text-fg",
            "transition-colors hover:bg-surface",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-40",
            currentStep === 0 && "invisible",
          )}
        >
          {backLabel}
        </button>

        {/* Next / Submit button */}
        {isLastStep ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            aria-disabled={isSubmitting}
            className={cn(
              "flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white",
              "transition-colors hover:bg-brand-600 active:bg-brand-700",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isSubmitting ? (
              <>
                <svg
                  aria-hidden="true"
                  className="mr-2 size-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Submitting…
              </>
            ) : (
              submitLabel
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={isSubmitting}
            className={cn(
              "flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white",
              "transition-colors hover:bg-brand-600 active:bg-brand-700",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

MultiStepForm.displayName = "MultiStepForm";
