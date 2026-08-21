"use client";

/**
 * OnboardingQuestion — renders ONE staff-authored question card.
 *
 * This is the component that makes "staff can add a field from the CRM" actually work: it
 * switches on `field.type` and nothing else, so a question type that exists in the registry
 * renders correctly the moment a row appears — no deploy, no per-question component.
 *
 * Layout follows the Google Form the students already know: one white card per question,
 * the label in body weight with a red asterisk when required, optional grey help text, and
 * an underline-style input. The visual language is Stimuli IQ's own tokens rather than
 * Google's purple, so the page reads as ours while the shape stays familiar.
 */

import { useId } from "react";
import { FileUpload, PHONE_INPUT_PROPS, PHONE_PLACEHOLDER, toLocalPhoneDigits } from "@repo/ui";
import type { OnboardingAnswerValue, OnboardingProgramOption, PublicOnboardingField } from "@repo/types";

/** Google-Forms' "Other:" escape hatch is modelled as a reserved sentinel choice. */
export const OTHER_CHOICE = "__other__";

const underlineInput = [
  "w-full border-0 border-b border-border bg-transparent px-0 py-2 text-base text-fg",
  "placeholder:text-fg-subtle",
  "focus:border-brand-500 focus:outline-none focus:ring-0",
].join(" ");

export interface OnboardingQuestionProps {
  field: PublicOnboardingField;
  value: OnboardingAnswerValue | undefined;
  onChange: (value: OnboardingAnswerValue | undefined) => void;
  error?: string;
  /** Choices for a `program`-typed field, resolved live from the catalog. */
  programs: OnboardingProgramOption[];
  disabled: boolean;
  requestUploadUrl: (file: File) => Promise<{ url: string; storageKey: string }>;
}

export function OnboardingQuestion({
  field,
  value,
  onChange,
  error,
  programs,
  disabled,
  requestUploadUrl,
}: OnboardingQuestionProps) {
  const controlId = useId();
  const errorId = `${controlId}-error`;
  const helpId = `${controlId}-help`;
  const describedBy = [field.helpText ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const text = typeof value === "string" ? value : "";

  // For a choice field, an answer that is not one of the listed choices IS the "Other"
  // free text — so re-opening the form with a saved answer restores the right radio.
  const choices = field.options ?? [];
  const isOtherSelected = field.allowOther && text.length > 0 && !choices.includes(text);

  const commonProps = {
    id: controlId,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid={`onboarding-question-${field.key}`}
    >
      {/* `<label>` for single-control questions; a `<fieldset>`'s legend does the job for
          radio groups, so those render their own grouping below instead. */}
      {field.type === "radio" ? (
        <fieldset className="border-0 p-0">
          <legend className="mb-1 text-base font-medium text-fg">
            {field.label}
            {field.required ? <RequiredMark /> : null}
          </legend>
          {field.helpText ? <HelpText id={helpId}>{field.helpText}</HelpText> : null}
          <div className="mt-3 flex flex-col gap-3">
            {choices.map((choice) => (
              <label key={choice} className="flex items-center gap-3 text-base text-fg">
                <input
                  type="radio"
                  name={controlId}
                  value={choice}
                  checked={text === choice}
                  disabled={disabled}
                  onChange={() => onChange(choice)}
                  className="size-4 accent-brand-500"
                />
                <span>{choice}</span>
              </label>
            ))}
            {field.allowOther ? (
              <label className="flex items-center gap-3 text-base text-fg">
                <input
                  type="radio"
                  name={controlId}
                  value={OTHER_CHOICE}
                  checked={isOtherSelected}
                  disabled={disabled}
                  // Selecting "Other" clears the answer so the required check still bites
                  // until something is actually typed into the free-text box.
                  onChange={() => onChange("")}
                  className="size-4 accent-brand-500"
                />
                <span>Other:</span>
                <input
                  type="text"
                  aria-label={`${field.label}, other`}
                  value={isOtherSelected ? text : ""}
                  disabled={disabled}
                  onChange={(e) => onChange(e.target.value)}
                  className={[underlineInput, "flex-1"].join(" ")}
                  data-testid={`onboarding-other-${field.key}`}
                />
              </label>
            ) : null}
          </div>
        </fieldset>
      ) : (
        <>
          <label htmlFor={controlId} className="mb-1 block text-base font-medium text-fg">
            {field.label}
            {field.required ? <RequiredMark /> : null}
          </label>
          {field.helpText ? <HelpText id={helpId}>{field.helpText}</HelpText> : null}
          <div className="mt-3">
            {renderControl()}
          </div>
        </>
      )}

      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );

  function renderControl() {
    switch (field.type) {
      case "textarea":
        return (
          <textarea
            {...commonProps}
            rows={3}
            value={text}
            placeholder={field.placeholder ?? "Your answer"}
            onChange={(e) => onChange(e.target.value)}
            className={[underlineInput, "resize-y"].join(" ")}
          />
        );

      case "phone":
        return (
          <input
            {...commonProps}
            {...PHONE_INPUT_PROPS}
            value={text}
            placeholder={field.placeholder ?? PHONE_PLACEHOLDER}
            // The product-wide rule: a mobile is always ten local digits, and pasting
            // "+91 98765 43210" must land as "9876543210" rather than being truncated
            // mid-number (@repo/ui phone.ts).
            onChange={(e) => onChange(toLocalPhoneDigits(e.target.value))}
            className={underlineInput}
          />
        );

      case "checkbox":
        return (
          <label className="flex items-center gap-3 text-base text-fg">
            <input
              {...commonProps}
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="size-4 accent-brand-500"
            />
            <span>{field.placeholder ?? "Yes"}</span>
          </label>
        );

      case "select":
        return (
          <select
            {...commonProps}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className={[underlineInput, "appearance-none"].join(" ")}
          >
            <option value="">Choose</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        );

      case "program":
        return (
          <select
            {...commonProps}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className={[underlineInput, "appearance-none"].join(" ")}
          >
            <option value="">Choose your program</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.title}
              </option>
            ))}
          </select>
        );

      case "file":
        return (
          <FileUpload
            requestUploadUrl={requestUploadUrl}
            onUploaded={(storageKey) => onChange(storageKey)}
            onRemoved={() => onChange(undefined)}
            acceptedTypes={["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]}
            maxBytes={10 * 1024 * 1024}
            disabled={disabled}
            label={field.placeholder ?? "Add file"}
            data-testid={`onboarding-upload-${field.key}`}
          />
        );

      case "date":
        return (
          <input
            {...commonProps}
            type="date"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className={underlineInput}
          />
        );

      case "number":
        return (
          <input
            {...commonProps}
            type="number"
            inputMode="numeric"
            value={text}
            placeholder={field.placeholder ?? "Your answer"}
            onChange={(e) => onChange(e.target.value)}
            className={underlineInput}
          />
        );

      case "email":
        return (
          <input
            {...commonProps}
            type="email"
            autoComplete="email"
            value={text}
            placeholder={field.placeholder ?? "Your answer"}
            onChange={(e) => onChange(e.target.value)}
            className={underlineInput}
          />
        );

      case "text":
      default:
        return (
          <input
            {...commonProps}
            type="text"
            value={text}
            placeholder={field.placeholder ?? "Your answer"}
            onChange={(e) => onChange(e.target.value)}
            className={underlineInput}
          />
        );
    }
  }
}

function RequiredMark() {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="text-danger">
        *
      </span>
      <span className="sr-only">(required)</span>
    </>
  );
}

function HelpText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-fg-muted">
      {children}
    </p>
  );
}

OnboardingQuestion.displayName = "OnboardingQuestion";
