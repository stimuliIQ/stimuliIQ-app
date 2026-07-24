import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "../lib/cn";
import { Input, type InputProps } from "./input";

/**
 * PasswordInput — an {@link Input} with a built-in show/hide toggle. Wraps the
 * standard input so every password field across the apps gets the same
 * accessible eye button instead of each form re-implementing it.
 *
 * a11y: the toggle is a real `<button type="button">` with an `aria-label` that
 * reflects the current action ("Show password" / "Hide password") and
 * `aria-pressed` state. It sits outside the tab order (`tabIndex={-1}`) so
 * keyboard users flow field → field → submit uninterrupted, but remains
 * clickable and screen-reader reachable.
 *
 * Layout note: this composes with a *bare* Input (label + error rendered by the
 * caller, as every current call site does). Pass `label`/`error` to the caller's
 * own markup, not here — the toggle is positioned over the input control only.
 */
export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** Test hook for the toggle button; defaults to "password-toggle". */
  toggleTestId?: string;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, toggleTestId, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          data-testid={toggleTestId ?? "password-toggle"}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center px-3 text-fg-muted",
            "transition-colors hover:text-fg",
            "focus-visible:text-fg focus-visible:outline-none",
          )}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
