"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

/**
 * StarRatingInput + TestimonialInput — accessible rating input and the testimonial
 * submission form that pairs with the existing display-only `TestimonialCard` (T19,
 * docs/plans/phase-9-completion.md).
 *
 * `StarRatingInput` follows the WAI-ARIA "radio group" rating pattern: one star = one
 * `role="radio"` in a `role="radiogroup"`, roving tabindex (ArrowLeft/Right move + select,
 * Home/End jump to 1/max), single accessible name via `aria-label` on the group.
 *
 * a11y:
 * - The rating is never conveyed by filled-star color alone — `aria-label` on the group
 *   announces "Rating: {value} out of {max} stars" and each star has its own label.
 * - Form fields reuse `Input`/`Label` for consistent label/error wiring.
 *
 * Usage:
 *   <TestimonialInput
 *     value={draft}
 *     onChange={setDraft}
 *     onSubmit={(v) => submitTestimonial(v)}
 *     submitting={isSubmitting}
 *   />
 */
export interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Test hook; defaults to "star-rating-input" when omitted. */
  "data-testid"?: string;
}

export function StarRatingInput({
  value,
  onChange,
  max = 5,
  label = "Rating",
  disabled = false,
  className,
  "data-testid": testId,
}: StarRatingInputProps): React.JSX.Element {
  const stars = Array.from({ length: max }, (_, i) => i + 1);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, star: number): void {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(max, star + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, star - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = max;
    else if (e.key === "Enter" || e.key === " ") next = star;
    if (next !== null) {
      e.preventDefault();
      onChange(next);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={`${label}: ${value} out of ${max} stars`}
      data-testid={testId ?? "star-rating-input"}
      className={cn("flex items-center gap-1", className)}
    >
      {stars.map((star) => {
        const isSelected = star === value;
        const isRovingTarget = star === (value || 1);
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            tabIndex={isRovingTarget ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(star)}
            onKeyDown={(e) => handleKeyDown(e, star)}
            data-testid={`star-rating-input-star-${star}`}
            className={cn(
              "rounded p-0.5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Star
              aria-hidden="true"
              className={cn("size-5", star <= value ? "fill-warning text-warning" : "fill-none text-border")}
            />
          </button>
        );
      })}
    </div>
  );
}
StarRatingInput.displayName = "StarRatingInput";

// ---------------------------------------------------------------------------
// TestimonialInput
// ---------------------------------------------------------------------------

export interface TestimonialFormValues {
  quote: string;
  ratingStars: number;
  studentName: string;
  college?: string;
  program?: string;
}

export interface TestimonialInputProps {
  value: TestimonialFormValues;
  onChange: (value: TestimonialFormValues) => void;
  onSubmit?: (value: TestimonialFormValues) => void;
  submitting?: boolean;
  errors?: Partial<Record<keyof TestimonialFormValues, string>>;
  /**
   * Render the College + Program pair. Defaults to `true` (the public
   * "submit your testimonial" shape this component was built for).
   *
   * Pass `false` on a surface that cannot persist them — an input whose value is dropped
   * on save is worse than no input: it reads as a working field and silently loses what
   * staff typed. The CRM manager passes `false` because `model Testimonial` has no
   * `college` column (tracked as P11-6 in docs/phase-11-followups.md) and captures the
   * program through a real `programId` picker instead of free text.
   */
  showCollegeProgram?: boolean;
  className?: string;
  /** Test hook; defaults to "testimonial-input" when omitted. */
  "data-testid"?: string;
}

export function TestimonialInput({
  value,
  onChange,
  onSubmit,
  submitting = false,
  errors,
  showCollegeProgram = true,
  className,
  "data-testid": testId,
}: TestimonialInputProps): React.JSX.Element {
  function patch(update: Partial<TestimonialFormValues>): void {
    onChange({ ...value, ...update });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    onSubmit?.(value);
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid={testId ?? "testimonial-input"}
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="testimonial-rating">Your rating</Label>
        <StarRatingInput
          value={value.ratingStars}
          onChange={(v) => patch({ ratingStars: v })}
          data-testid="testimonial-input-rating"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="testimonial-quote">
          Your review
          <span aria-hidden="true" className="text-danger"> *</span>
        </Label>
        <textarea
          id="testimonial-quote"
          value={value.quote}
          onChange={(e) => patch({ quote: e.target.value })}
          rows={4}
          aria-invalid={Boolean(errors?.quote) || undefined}
          data-testid="testimonial-input-quote"
          className={cn(
            "w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg",
            "placeholder:text-fg-subtle",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            errors?.quote && "border-danger focus-visible:ring-danger",
          )}
        />
        {errors?.quote ? (
          <p role="alert" className="text-sm text-danger">
            {errors.quote}
          </p>
        ) : null}
      </div>

      <Input
        label="Your name"
        value={value.studentName}
        onChange={(e) => patch({ studentName: e.target.value })}
        error={errors?.studentName}
        data-testid="testimonial-input-name"
        required
      />

      {showCollegeProgram ? (
        <div className="flex gap-3">
          <Input
            label="College"
            value={value.college ?? ""}
            onChange={(e) => patch({ college: e.target.value })}
            data-testid="testimonial-input-college"
            wrapperClassName="flex-1"
          />
          <Input
            label="Program"
            value={value.program ?? ""}
            onChange={(e) => patch({ program: e.target.value })}
            data-testid="testimonial-input-program"
            wrapperClassName="flex-1"
          />
        </div>
      ) : null}

      {onSubmit ? (
        <Button type="submit" loading={submitting} data-testid="testimonial-input-submit" className="self-start">
          Submit review
        </Button>
      ) : null}
    </form>
  );
}
TestimonialInput.displayName = "TestimonialInput";
