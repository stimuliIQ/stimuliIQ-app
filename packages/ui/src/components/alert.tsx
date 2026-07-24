import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";
import type { StatusChipTone } from "./status-chip";

/**
 * Alert (aka Callout) — tinted inline notice box, per
 * docs/specs/crm-ui-consistency.md §8. Replaces ~15 hand-rolled
 * `rounded-md border-<tone>/30 bg-<tone>/10` boxes across the apps, which had
 * drifted between `/30` and `/40` border alpha. This component is the single
 * source of truth: **border alpha `/30`, background alpha `/10`** — always,
 * for all five tones (shares the tone vocabulary with `StatusChip`).
 *
 * Not color-only (WCAG 1.4.1): the tone always pairs with visible text
 * (`title` and/or `children`); `icon` is a supplementary visual cue only.
 *
 * Usage:
 *   <Alert tone="warning" title="Backup codes" icon={<AlertTriangle className="size-4" />}>
 *     Store these somewhere safe — they won't be shown again.
 *   </Alert>
 *
 *   <Alert tone="danger">{error}</Alert>
 */
const alertVariants = cva(
  "flex items-start gap-2 rounded-md border p-3 text-sm",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface text-fg",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        info: "border-info/30 bg-info/10 text-info",
      } satisfies Record<StatusChipTone, string>,
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  /** Optional bold heading line above the body content. */
  title?: React.ReactNode;
  /** Optional leading icon — supplementary only, never the sole meaning-carrier. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** Test hook; defaults to "alert" when omitted. */
  "data-testid"?: string;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ tone = "neutral", title, icon, className, children, "data-testid": testId, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-testid={testId ?? "alert"}
        className={cn(alertVariants({ tone }), className)}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {title ? <p className="font-semibold leading-tight">{title}</p> : null}
          {children ? <div className={cn(tone === "neutral" ? "text-fg-muted" : undefined)}>{children}</div> : null}
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

/** Alias — some call sites conceptually reach for "Callout" over "Alert"; same component. */
export const Callout = Alert;
