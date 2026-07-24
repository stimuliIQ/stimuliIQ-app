import * as React from "react";

import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * Textarea — accessible multi-line text input, mirroring `Input`'s API (label,
 * error, helperText, required, size) and visual recipe exactly (same bg/border
 * tokens, same `focus-visible` ring, same error styling) so the two compose
 * predictably in any form. Per docs/specs/crm-ui-consistency.md §4: replaces
 * ~8 hand-rolled `<textarea>` elements across the CRM, one of which had **no**
 * focus-visible ring at all (a WCAG 2.4.7 violation) — this component always
 * renders the shared ring.
 *
 * Resizing is vertical-only (`resize-y`) — horizontal resize breaks layout in
 * flex/grid form rows.
 *
 * Usage:
 *   <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
 */
export type TextareaSize = "sm" | "md";

const TEXTAREA_SIZE_CLASSES: Record<TextareaSize, string> = {
  sm: "px-2.5 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
};

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /** Visible label text. Required unless `aria-label`/`aria-labelledby` is supplied instead. */
  label?: string;
  /** Error message; when present the textarea is marked invalid (`aria-invalid`) and styled accordingly. */
  error?: string;
  /** Helper/hint text shown when there is no error. */
  helperText?: string;
  /** Density variant. Defaults to "md" — mirrors `Input`'s size scale. */
  size?: TextareaSize;
  /** Wrapper className, e.g. for layout (the textarea itself uses `className`). */
  wrapperClassName?: string;
  /** Test hook; defaults to "textarea" when omitted. */
  "data-testid"?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      id,
      label,
      error,
      helperText,
      size = "md",
      className,
      wrapperClassName,
      disabled,
      required,
      rows = 4,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;
    const describedBy =
      [error ? errorId : null, !error && helperText ? helperId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
        {label ? (
          <Label htmlFor={textareaId}>
            {label}
            {required ? (
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
              </span>
            ) : null}
          </Label>
        ) : null}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          data-testid={testId ?? "textarea"}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={cn(
            "flex w-full resize-y rounded-md border border-border bg-bg text-fg",
            TEXTAREA_SIZE_CLASSES[size],
            "placeholder:text-fg-subtle",
            "transition-colors duration-fast ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger focus-visible:ring-danger",
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-sm text-fg-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
