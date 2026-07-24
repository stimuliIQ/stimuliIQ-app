import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

/**
 * StatusChip — semantic status indicator, per docs/07-design-system.md §5 + §15 ("never
 * convey status by color alone" — the always-rendered TEXT LABEL is the non-color
 * differentiator; WCAG 1.4.1 is satisfied without a redundant icon). Domain enums
 * (lead/active/alumni, planned/active/completed/archived, valid/revoked, ...) map to
 * one of five tones at the call site — this component never hardcodes a domain enum,
 * only the tone→color-token pairing.
 *
 * Visual language: flat "soft badge" — tinted background at low opacity with the tone's
 * strong text color, small radius, bold compact type, no border/icon (the earlier
 * outlined-pill-with-icon look read as noisy in dense tables). Pass `icon` explicitly
 * for the rare chip that genuinely needs one (e.g. gamification badges).
 *
 * Usage:
 *   <StatusChip tone="success" label="Active" />
 *   <StatusChip tone="neutral" label="Lead" />
 */
export type StatusChipTone = "neutral" | "success" | "warning" | "danger" | "info";

const statusChipVariants = cva(
  [
    "inline-flex items-center gap-1 whitespace-nowrap rounded font-bold leading-tight",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral: "bg-fg-muted/15 text-fg-muted",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        danger: "bg-danger/15 text-danger",
        info: "bg-info/15 text-info",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[11px] [&_svg]:size-3",
        md: "px-2 py-0.5 text-xs [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  },
);

export interface StatusChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof statusChipVariants> {
  /** Visible text label — always rendered; the chip never relies on color alone. */
  label: string;
  /** Optional icon rendered before the label. Chips are icon-free by default. */
  icon?: React.ReactNode | null;
  /** Test hook; defaults to "status-chip" when omitted. */
  "data-testid"?: string;
}

export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  (
    { className, tone = "neutral", size, label, icon, "data-testid": testId, ...props },
    ref,
  ) => {
    return (
      <span
        ref={ref}
        data-testid={testId ?? "status-chip"}
        className={cn(statusChipVariants({ tone, size }), className)}
        {...props}
      >
        {icon ?? null}
        {label}
      </span>
    );
  },
);
StatusChip.displayName = "StatusChip";

/**
 * makeStatusChip — factory that collapses a `Record<Enum, tone>` +
 * `Record<Enum, label>` pair into one typed chip component, per
 * docs/specs/crm-ui-consistency.md §3 ("the 17 near-identical chip files may
 * collapse onto a shared factory, drift-proofing"). Each app currently
 * hand-rolls a `FooStatusChip({ status })` wrapper around `StatusChip` with
 * its own local `Record<FooStatus, {tone, label}>` — this factory produces
 * the exact same component shape (a `{ status }`-prop component) from two
 * plain maps, so call sites collapse to one line:
 *
 *   const CampaignStatusChip = makeStatusChip<CampaignStatus>(
 *     { draft: "neutral", scheduled: "info", sending: "warning", sent: "success",
 *       paused: "warning", cancelled: "neutral", failed: "danger" },
 *     { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent",
 *       paused: "Paused", cancelled: "Cancelled", failed: "Failed" },
 *     "campaign-status-chip",
 *   );
 *   <CampaignStatusChip status={campaign.status} />
 *
 * Unrecognized status values (e.g. a value added server-side but not yet in
 * the map) fail safe to `neutral` + the raw status string rather than crash.
 */
export function makeStatusChip<TStatus extends string>(
  toneMap: Record<TStatus, StatusChipTone>,
  labelMap: Record<TStatus, string>,
  defaultTestId: string,
): React.ForwardRefExoticComponent<
  { status: TStatus } & Omit<StatusChipProps, "tone" | "label"> & React.RefAttributes<HTMLSpanElement>
> {
  const Chip = React.forwardRef<
    HTMLSpanElement,
    { status: TStatus } & Omit<StatusChipProps, "tone" | "label">
  >(({ status, "data-testid": testId, ...props }, ref) => {
    const tone = toneMap[status] ?? "neutral";
    const label = labelMap[status] ?? status;
    return (
      <StatusChip
        ref={ref}
        tone={tone}
        label={label}
        data-testid={testId ?? defaultTestId}
        {...props}
      />
    );
  });
  Chip.displayName = `StatusChip(${defaultTestId})`;
  return Chip;
}
