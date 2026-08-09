"use client";

import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Switch — accessible on/off toggle used by settings and form screens (T19,
 * docs/plans/phase-9-completion.md). Implemented as a native `<button role="switch">`
 * (the standard WAI-ARIA switch pattern) rather than pulling in `@radix-ui/react-switch`,
 * matching this package's existing preference to avoid new primitive dependencies when a
 * small number of ARIA attributes suffice (see `./kanban.tsx`'s accessible-move-menu for
 * the same reasoning). Space/Enter toggle via native `<button>` semantics; motion respects
 * `prefers-reduced-motion` globally (styles.css).
 *
 * Usage:
 *   <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable dark mode" />
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
  className?: string;
  /** Test hook; defaults to "switch" when omitted. */
  "data-testid"?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      onCheckedChange,
      disabled = false,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      id,
      className,
      "data-testid": testId,
    },
    ref,
  ) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-testid={testId ?? "switch"}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors duration-fast ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-border",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-4 rounded-full bg-bg shadow-sm transition-transform duration-fast ease-out",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  ),
);
Switch.displayName = "Switch";
