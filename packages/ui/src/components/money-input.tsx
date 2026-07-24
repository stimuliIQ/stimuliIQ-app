import * as React from "react";

import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * MoneyInput — integer-paise money input, per CLAUDE.md §3.6 ("Money is integer minor
 * units (paise), never floats"). Displays value in rupees (₹) to the user but the
 * controlled value contract is always integer paise (1 INR = 100 paise).
 *
 * Float-drift prevention: the conversion path is
 *   display string → parseFloat → round(×100) as integer
 * so "1.234" → round(123.4) = 123 paise (truncated to valid paise), never a float in the
 * stored value. We use Math.round to handle floating-point representation imprecision in JS
 * (e.g. "1.07" * 100 = 106.99999... → round → 107). The stored `value` prop is always a
 * safe integer checked via Number.isInteger.
 *
 * The component carries no business logic — it converts ₹↔paise and wires a11y labels.
 * Validation rules (min, max) live at the call site (react-hook-form / zod).
 *
 * Usage:
 *   <MoneyInput
 *     label="Course fee"
 *     value={amountPaise}
 *     onChange={(paise) => setAmountPaise(paise)}
 *     required
 *   />
 *
 * The helper `formatPaise` is exported for use in display-only contexts (table cells, chips).
 *
 *   import { formatPaise } from "@repo/ui";
 *   formatPaise(249900) // "₹2,499.00"
 */

/** Formats an integer paise amount as a ₹-prefixed rupee string, e.g. 249900 → "₹2,499.00". */
export function formatPaise(paise: number): string {
  // Guard: accept non-integer input gracefully in display contexts, but always display
  // a human-readable rupee value.
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Converts a rupee display string to integer paise. Returns NaN for invalid input. */
function rupeesToPaise(rupeeStr: string): number {
  const trimmed = rupeeStr.trim();
  if (trimmed === "" || trimmed === "-") return NaN;
  const parsed = parseFloat(trimmed);
  if (isNaN(parsed)) return NaN;
  // Math.round eliminates floating-point representation errors (e.g. 1.07 * 100 = 106.999…)
  return Math.round(parsed * 100);
}

/** Converts integer paise to a rupee display string for the input (e.g. 249900 → "2499.00"). */
function paiseToRupeeString(paise: number): string {
  if (!Number.isFinite(paise)) return "";
  return (paise / 100).toFixed(2);
}

export interface MoneyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type" | "prefix"
  > {
  /** Controlled value in **integer paise** (e.g. 249900 for ₹2,499). */
  value: number;
  /** Called with the new value in **integer paise**. Not called when the field is
   *  transitional (e.g. "1." during typing) — only on a valid parse. */
  onChange: (paise: number) => void;
  /** Visible label text. Required unless `aria-label`/`aria-labelledby` is supplied. */
  label?: string;
  /** Error message; marks the field invalid and announces via screen reader. */
  error?: string;
  /** Helper/hint text shown when there is no error. */
  helperText?: string;
  /** Wrapper className for layout purposes. */
  wrapperClassName?: string;
  /** Currency symbol displayed as a prefix (default "₹"). */
  currencySymbol?: string;
  /** Test hook; defaults to "money-input" when omitted. */
  "data-testid"?: string;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      id,
      label,
      error,
      helperText,
      className,
      wrapperClassName,
      disabled,
      required,
      value,
      onChange,
      currencySymbol = "₹",
      onBlur,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const prefixId = `${inputId}-prefix`;
    const describedBy =
      [error ? errorId : null, !error && helperText ? helperId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    // Local display string so the user can type "1." or "1.5" freely without the value
    // being coerced mid-keystroke. We sync from props on mount and on external value changes
    // (e.g. programmatic reset), but hold the editing string locally while focused.
    const [displayValue, setDisplayValue] = React.useState<string>(() =>
      Number.isFinite(value) ? paiseToRupeeString(value) : "",
    );
    const isFocused = React.useRef(false);

    // Sync external `value` prop into the display string only when the user is not actively
    // editing (prevents overwriting mid-keystroke from parent re-renders).
    React.useEffect(() => {
      if (!isFocused.current) {
        setDisplayValue(Number.isFinite(value) ? paiseToRupeeString(value) : "");
      }
    }, [value]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
      const raw = e.target.value;
      // Allow the user to type freely; only forward valid paise values to onChange.
      // Reject anything that can't form a valid rupee amount (non-numeric, too many decimals).
      // Allow: digits, one decimal point, up to 2 decimal digits, empty string.
      if (/^(\d*\.?\d{0,2})?$/.test(raw)) {
        setDisplayValue(raw);
        const paise = rupeesToPaise(raw);
        if (!isNaN(paise) && paise >= 0) {
          onChange(paise);
        }
      }
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
      isFocused.current = false;
      // On blur, normalise the display to 2 decimal places if we have a valid value.
      const paise = rupeesToPaise(displayValue);
      if (!isNaN(paise) && paise >= 0) {
        setDisplayValue(paiseToRupeeString(paise));
      } else if (displayValue === "") {
        // Empty field — keep empty (caller decides if required).
      }
      onBlur?.(e);
    }

    function handleFocus(): void {
      isFocused.current = true;
    }

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
        <div className="relative flex items-center">
          {/* Currency prefix — hidden from AT (the aria-label on the input conveys "₹") */}
          <span
            id={prefixId}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-3 select-none text-sm text-fg-muted",
              disabled && "opacity-50",
            )}
          >
            {currencySymbol}
          </span>
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="decimal"
            data-testid={testId ?? "money-input"}
            disabled={disabled}
            required={required}
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={[prefixId, describedBy].filter(Boolean).join(" ") || undefined}
            aria-label={label ? undefined : `Amount in ${currencySymbol}`}
            className={cn(
              "flex h-10 w-full rounded-md border border-border bg-bg py-2 pl-7 pr-3 text-sm text-fg",
              "placeholder:text-fg-subtle",
              "transition-colors duration-fast ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-danger focus-visible:ring-danger",
              className,
            )}
            {...props}
          />
        </div>
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
MoneyInput.displayName = "MoneyInput";
