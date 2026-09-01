// A labelled checkbox.
//
// `Checkbox` is the bare Radix control with no label slot — fine for a one-off paired with
// its own text, but not for a column of five, where each needs a label and often a line of
// help. This WRAPS the shared primitive rather than reimplementing it, and keeps the
// association a real `<label htmlFor>` so clicking the text toggles the box and a screen
// reader reads the two together.
//
// Promoted here from apps/crm's leave feature when the org-hierarchy team form became its
// second caller — which is exactly the condition the original file said to promote on.
import * as React from "react";

import { Checkbox } from "./checkbox";

export interface CheckboxFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  helperText?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function CheckboxField({
  checked,
  onCheckedChange,
  label,
  helperText,
  disabled,
  "data-testid": testId,
}: CheckboxFieldProps): React.JSX.Element {
  const id = React.useId();
  const helperId = helperText ? `${id}-helper` : undefined;

  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        aria-describedby={helperId}
        className="mt-0.5"
        data-testid={testId}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm text-fg">
          {label}
        </label>
        {helperText ? (
          <span id={helperId} className="text-xs text-fg-muted">
            {helperText}
          </span>
        ) : null}
      </div>
    </div>
  );
}
