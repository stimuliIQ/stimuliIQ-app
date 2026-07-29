"use client";

/**
 * BookSlotForm — client component that wires the MultiStepForm + step content
 * with the useBookSlot hook.
 *
 * This component owns NO business logic — it delegates all I/O + state to
 * useBookSlot (see src/hooks/use-book-slot.ts).
 *
 * States handled:
 *   - loading (isSubmitting): MultiStepForm disables navigation + shows spinner
 *   - error: formError prop on MultiStepForm + retry path via reset()
 *   - success: confirmation screen with next steps
 *   - empty: N/A (form always has initial state)
 */

import { MultiStepForm } from "@repo/ui";
import type { MultiStep } from "@repo/ui";
import { useBookSlot } from "../../../hooks/use-book-slot";
import { buildWhatsAppHref } from "../../../lib/contact";
import { ProgramStep, type ProgramOption } from "./book-slot-step-program";
import { SlotStep } from "./book-slot-step-slot";
import { DetailsStep } from "./book-slot-step-details";
import { ConfirmStep } from "./book-slot-step-confirm";

interface BookSlotFormProps {
  /** Live CRM programs for the "Program of interest" dropdown (server-fetched on the page). */
  programs?: ProgramOption[];
}

export function BookSlotForm({ programs = [] }: BookSlotFormProps) {
  const {
    formData,
    setFormData,
    currentStep,
    stepErrors,
    submitState,
    goNext,
    goBack,
    submit,
    reset,
  } = useBookSlot();

  // Success state — show confirmation instead of the form
  if (submitState.kind === "success") {
    return (
      <div
        data-testid="book-slot-success"
        role="status"
        aria-live="polite"
        className="rounded-xl border border-success/30 bg-success/10 p-8 text-center"
      >
        <div
          aria-hidden="true"
          className="animate-success-pop mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success/20 text-success"
        >
          <svg
            viewBox="0 0 52 52"
            className="size-8"
            fill="none"
            stroke="currentColor"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path className="animate-success-check" d="M14 27l7 7 17-17" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-fg">Slot Booked!</h2>
        <p className="mt-2 text-fg-muted">
          {submitState.result.message ||
            "Your slot has been booked. A mentor will call you at the scheduled time."}
        </p>
        <p className="mt-3 text-sm text-fg-subtle">
          Booking ID: <code className="font-mono">{submitState.result.bookingId}</code>
        </p>
        <p className="mt-1 text-sm text-fg-subtle">
          A confirmation will be sent to your phone (WhatsApp/SMS coming soon).
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-[44px] items-center rounded-md border border-border px-6 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Book another slot
        </button>
      </div>
    );
  }

  const STEPS: MultiStep[] = [
    {
      id: "program",
      title: "Program",
      content: (
        <ProgramStep
          formData={formData}
          onChange={setFormData}
          errors={stepErrors}
          programs={programs}
        />
      ),
    },
    {
      id: "slot",
      title: "Choose Slot",
      content: (
        <SlotStep
          formData={formData}
          onChange={setFormData}
          errors={stepErrors}
        />
      ),
    },
    {
      id: "details",
      title: "Your Details",
      content: (
        <DetailsStep
          formData={formData}
          onChange={setFormData}
          errors={stepErrors}
        />
      ),
    },
    {
      id: "confirm",
      title: "Confirm",
      content: <ConfirmStep formData={formData} />,
    },
  ];

  const isLastStep = currentStep === STEPS.length - 1;
  const isSubmitting = submitState.kind === "submitting";
  const formError =
    submitState.kind === "error" ? submitState.message : undefined;

  return (
    <div
      className="rounded-xl border border-border bg-card p-6 shadow-sm md:p-8"
      data-testid="book-slot-form"
    >
      <MultiStepForm
        steps={STEPS}
        currentStep={currentStep}
        onNext={goNext}
        onBack={goBack}
        onSubmit={submit}
        isLastStep={isLastStep}
        isSubmitting={isSubmitting}
        nextLabel="Continue"
        submitLabel="Book My Slot"
        backLabel="Back"
        formError={formError}
        data-testid="book-slot-multi-step"
      />

      {/* Error retry path (AC-19-style: retry without losing progress) */}
      {submitState.kind === "error" ? (
        <p className="mt-3 text-center text-sm text-fg-muted">
          Having trouble?{" "}
          <a
            href={buildWhatsAppHref()}
            className="text-brand-500 underline hover:text-brand-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat with us on WhatsApp
          </a>
        </p>
      ) : null}
    </div>
  );
}

BookSlotForm.displayName = "BookSlotForm";
