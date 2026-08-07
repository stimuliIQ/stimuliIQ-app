import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Button — primary interactive control. Variants/sizes per docs/07-design-system.md §5.
 * Tokens only (brand/danger/border/fg via Tailwind utilities mapped to CSS variables),
 * never hardcoded colors.
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    "transition-colors duration-fast ease-out",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-brand-500 text-brand-foreground hover:bg-brand-600 active:bg-brand-700",
        secondary: "bg-surface text-fg border border-border hover:bg-card",
        ghost: "bg-transparent text-fg hover:bg-surface",
        destructive: "bg-danger text-danger-foreground hover:bg-danger/90",
        link: "bg-transparent text-brand-500 underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        // `md` and `icon` are density-aware: 40px under the default comfortable density
        // (identical to the old `h-10`/`h-10 w-10`), 32px wherever an ancestor sets
        // `data-density="compact"` (the CRM shell). This is why CRM buttons are `btn-sm`
        // sized without every call site passing size="sm" — see packages/ui/src/styles.css.
        md: "h-[var(--density-control-height)] px-[var(--density-control-px)] text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-[var(--density-control-height)] w-[var(--density-control-height)] p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the styling onto the single child element instead of a <button> (e.g. <a>, Link). */
  asChild?: boolean;
  /** Shows a spinner and disables the button while an async action is in flight. */
  loading?: boolean;
  /** Required when size="icon" and there is no visible text label (a11y). */
  "aria-label"?: string;
  /** Test hook; defaults to "button" when omitted. */
  "data-testid"?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    // Radix Slot requires exactly one React element child — it can't merge props onto a
    // fragment of [spinner, children]. So when asChild is set, render children unmodified
    // (the loading spinner only applies to the native <button> rendering path).
    if (asChild) {
      return (
        <Slot
          ref={ref}
          data-testid={testId ?? "button"}
          className={cn(buttonVariants({ variant, size }), className)}
          aria-disabled={disabled || loading || undefined}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        data-testid={testId ?? "button"}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        aria-disabled={disabled || loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
