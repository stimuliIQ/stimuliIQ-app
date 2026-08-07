import * as React from "react";

import { cn } from "../lib/cn";

interface DivProps extends React.HTMLAttributes<HTMLDivElement> {
  "data-testid"?: string;
}

/**
 * Card — composable surface (header/content/footer) per docs/07-design-system.md §5.
 * Used for program cards, KPI tiles, lesson cards across web/lms/crm.
 *
 * Header/content/footer inset is density-aware (`--density-card-padding`): 24px under the
 * default comfortable density — identical to the `p-6` it replaced — and 16px wherever an
 * ancestor sets `data-density="compact"` (the CRM shell). See packages/ui/src/styles.css.
 */
export const Card = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className, "data-testid": testId, ...props }, ref) => (
    <div
      ref={ref}
      data-testid={testId ?? "card"}
      className={cn(
        "rounded-lg border border-border bg-card text-fg shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1.5 p-[var(--density-card-padding)]", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-lg font-semibold leading-heading tracking-tight text-fg", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-fg-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-[var(--density-card-padding)] pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 p-[var(--density-card-padding)] pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
