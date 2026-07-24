"use client";

import * as React from "react";
import { Users, FileText, Calendar, ClipboardList } from "lucide-react";

import { cn } from "../lib/cn";
import { MultiStepForm, type MultiStep } from "./multi-step-form";

/**
 * CampaignBuilder shell — a 4-step multi-step wrapper for creating bulk campaigns
 * (segment → template → schedule → review).
 *
 * Per docs/03-prd-crm.md §7.13, docs/06 §13, docs/07 §5, and the task spec (task #5):
 * "built on the EXISTING MultiStepForm — do NOT rebuild it."
 *
 * Responsibilities (shell only — presentational):
 * - Owns the step progression and step titles.
 * - Renders caller-supplied content for each step via slot props.
 * - Delegates all navigation state, validation, and submission to the caller.
 * - Does NOT own campaign data state, API calls, or validation logic.
 *
 * The four steps per the plan:
 *   1. Segment — audience filter (renders AudienceSegmentFilter or the caller's slot)
 *   2. Template — channel + template selection / compose
 *   3. Schedule — schedule_at datetime or send-now
 *   4. Review — summary before submit
 *
 * a11y: Inherits all a11y properties from MultiStepForm (live-region step announcement,
 * focus management on step change, progressbar, step heading focus).
 *
 * Usage:
 *   <CampaignBuilder
 *     currentStep={step}
 *     onNext={handleNext}
 *     onBack={handleBack}
 *     onSubmit={handleSubmit}
 *     isSubmitting={creating}
 *     formError={apiError}
 *     segmentStep={<AudienceSegmentFilter ... />}
 *     templateStep={<TemplateForm ... />}
 *     scheduleStep={<ScheduleForm ... />}
 *     reviewStep={<CampaignReview ... />}
 *   />
 */

export interface CampaignBuilderProps {
  currentStep: number;
  /** Called to advance to the next step; caller validates before calling. */
  onNext?: () => void;
  onBack?: () => void;
  /** Called on final Review step submission. */
  onSubmit?: () => void;
  isSubmitting?: boolean;
  /** Global form error (API error on submit). */
  formError?: string;
  /** Step 1 content: audience segment filter UI. */
  segmentStep: React.ReactNode;
  /** Step 2 content: channel + template selection/compose. */
  templateStep: React.ReactNode;
  /** Step 3 content: schedule datetime or send-now selector. */
  scheduleStep: React.ReactNode;
  /** Step 4 content: full review before submitting. */
  reviewStep: React.ReactNode;
  /** Custom submit label for the final step. Defaults to "Send campaign". */
  submitLabel?: string;
  className?: string;
  /** Test hook; defaults to "campaign-builder". */
  "data-testid"?: string;
}

const CAMPAIGN_STEP_META = [
  { id: "segment", title: "Audience", icon: Users },
  { id: "template", title: "Template", icon: FileText },
  { id: "schedule", title: "Schedule", icon: Calendar },
  { id: "review", title: "Review", icon: ClipboardList },
] as const;

export function CampaignBuilder({
  currentStep,
  onNext,
  onBack,
  onSubmit,
  isSubmitting = false,
  formError,
  segmentStep,
  templateStep,
  scheduleStep,
  reviewStep,
  submitLabel = "Send campaign",
  className,
  "data-testid": testId,
}: CampaignBuilderProps): React.JSX.Element {
  const stepContents: React.ReactNode[] = [segmentStep, templateStep, scheduleStep, reviewStep];

  const steps: MultiStep[] = CAMPAIGN_STEP_META.map((meta, i) => ({
    id: meta.id,
    title: meta.title,
    content: (
      <StepContentWrapper icon={meta.icon} title={meta.title}>
        {stepContents[i]}
      </StepContentWrapper>
    ),
  }));

  const isLastStep = currentStep === steps.length - 1;

  return (
    <div
      data-testid={testId ?? "campaign-builder"}
      className={cn("w-full", className)}
    >
      <MultiStepForm
        steps={steps}
        currentStep={currentStep}
        onNext={onNext}
        onBack={onBack}
        onSubmit={onSubmit}
        isLastStep={isLastStep}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        formError={formError}
      />
    </div>
  );
}

CampaignBuilder.displayName = "CampaignBuilder";

/** Internal wrapper that adds the step icon to the heading context. */
function StepContentWrapper({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {/* Step icon + subtitle (heading comes from MultiStepForm above this) */}
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <p className="text-sm">{title} configuration</p>
      </div>
      {children}
    </div>
  );
}
