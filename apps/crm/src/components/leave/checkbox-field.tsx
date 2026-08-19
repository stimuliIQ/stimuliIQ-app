// A labelled checkbox.
//
// `@repo/ui`'s `Checkbox` is the bare Radix control with no label slot — every existing call
// site pairs it with its own text, which is fine for one-offs but not for the setup screen,
// where five of them sit in a column and each needs a label and a line of help. This wraps
// the shared primitive rather than reimplementing it, and keeps the association a real
// `<label htmlFor>` so clicking the text toggles the box and a screen reader reads the two
// together.
//
// Local to the leave feature on purpose. If a second feature needs the same thing, that is
// the moment to promote it into @repo/ui — not before.
import * as React from "react";
import { Checkbox } from "@repo/ui";

interface CheckboxFieldProps {
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
