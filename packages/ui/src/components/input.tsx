import * as React from "react";

import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * Input — accessible text input with label association, helper text, and error state
 * per docs/07-design-system.md §5 and CLAUDE.md §3.9. Label, control, and error/helper
 * text are wired together via generated/explicit ids and `aria-describedby` so screen
 * readers announce both the purpose and the validation state.
 *
 * `size`: "md" (default, `h-10` — unchanged, existing call sites are unaffected) or
 * "sm" (`h-8`, tighter `px-2.5`) — mirrors `Button`'s `sm/md/lg` size scale, added per
 * docs/specs/phase-10-ui-polish-visual-audit.md §2.4 for compact spreadsheet-style rows
 * (link lists, footer columns, CTA buttons) where the default height costs ~110px/row.
 *
 * Designed to compose with `FormField`/react-hook-form later: this component itself
 * carries no validation/business logic, only presentation + a11y wiring.
 */
export type InputSize = "sm" | "md";

const INPUT_SIZE_CLASSES: Record<InputSize, string> = {
  sm: "h-8 px-2.5 py-1 text-sm",
  md: "h-10 px-3 py-2 text-sm",
};

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible label text. Required unless `aria-label`/`aria-labelledby` is supplied instead. */
  label?: string;
  /** Error message; when present the input is marked invalid (`aria-invalid`) and styled accordingly. */
  error?: string;
  /** Helper/hint text shown when there is no error. */
  helperText?: string;
  /**
   * Height/density variant. Defaults to "md" (unchanged `h-10` behavior). Note: this
   * intentionally shadows/replaces the native HTML `size` attribute (number of visible
   * characters) — no existing call site in the repo used the native attribute, and the
   * design-system size scale is far more broadly useful for this component.
   */
  size?: InputSize;
  /** Wrapper className, e.g. for layout (the input itself uses `className`). */
  wrapperClassName?: string;
  /** Test hook; defaults to "input" when omitted. */
  "data-testid"?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
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
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const describedBy =
      [error ? errorId : null, !error && helperText ? helperId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
        {label ? (
          <Label htmlFor={inputId}>
            {label}
            {required ? (
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
              </span>
            ) : null}
          </Label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          data-testid={testId ?? "input"}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={cn(
            "flex w-full rounded-md border border-border bg-bg text-fg",
            INPUT_SIZE_CLASSES[size],
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
Input.displayName = "Input";
