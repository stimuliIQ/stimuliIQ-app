import * as React from "react";

import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * FormField — standardizes the label+control+helper+error layout for react-hook-form
 * fields, per docs/07-design-system.md §5. Use this when composing a non-Input/Select
 * control (e.g. a Combobox, a custom widget, a group of checkboxes) that needs the same
 * a11y wiring as `Input`/`Select`: a generated id passed to the control via the render
 * prop, `aria-invalid`, and `aria-describedby` linking to the error/helper text.
 *
 * Input and Select already implement this pattern internally — prefer them directly for
 * plain text/select fields. Reach for FormField when wrapping something else, or when you
 * want the label/error chrome decoupled from the control implementation.
 *
 * Usage (RHF):
 *   <FormField label="College" error={errors.college?.message} required>
 *     {(fieldProps) => <Input {...register("college")} {...fieldProps} />}
 *   </FormField>
 */
export interface FormFieldRenderProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

export interface FormFieldProps {
  label: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  /** Explicit id; auto-generated when omitted. */
  id?: string;
  className?: string;
  /** Render prop receiving the a11y wiring to spread onto the underlying control. */
  children: (fieldProps: FormFieldRenderProps) => React.ReactNode;
  /** Test hook; defaults to "form-field" when omitted. */
  "data-testid"?: string;
}

export function FormField({
  label,
  error,
  helperText,
  required,
  id,
  className,
  children,
  "data-testid": testId,
}: FormFieldProps): React.JSX.Element {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const helperId = `${fieldId}-helper`;
  const describedBy =
    [error ? errorId : null, !error && helperText ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div data-testid={testId ?? "form-field"} className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children({
        id: fieldId,
        "aria-invalid": Boolean(error) || undefined,
        "aria-describedby": describedBy,
      })}
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
}
