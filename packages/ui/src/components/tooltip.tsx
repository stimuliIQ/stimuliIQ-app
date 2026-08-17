import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Tooltip — a hover/focus label for a control whose meaning is otherwise carried only by
 * an icon (docs/07-design-system.md §15: an icon-only control needs a visible text
 * affordance, not just an accessible name).
 *
 * DEPENDENCY-FREE ON PURPOSE. The obvious reach here is `@radix-ui/react-tooltip`, but a
 * table row renders one of these per action per row (4 × 25 rows = 100 portalled,
 * JS-positioned tooltips on the Users screen alone) and the entire behaviour we need is
 * "show a label on hover or keyboard focus". CSS `group-hover`/`group-focus-visible`
 * does that with no state, no portal, no re-render, and no new package to get approved.
 *
 * ACCESSIBILITY: this renders VISUAL reinforcement only, and is `aria-hidden`.
 * The trigger is expected to already carry its own accessible name (`aria-label` on the
 * icon button). Exposing the same string again via `role="tooltip"` + `aria-describedby`
 * would make a screen reader announce "Edit Phanendra Gandi, button, Edit" — the label
 * twice. If you use this on a trigger that has NO accessible name, give the trigger an
 * `aria-label` too; do not rely on this component to supply one.
 *
 * `group-focus-visible` (not `group-focus`) so the tooltip appears for keyboard tabbing
 * but not after a mouse click, which would otherwise leave it stuck open under the
 * cursor after the action fires.
 *
 * Usage:
 *   <Tooltip label="Edit">
 *     <Button variant="ghost" size="icon" aria-label={`Edit ${row.name}`}>
 *       <Pencil className="size-4" aria-hidden="true" />
 *     </Button>
 *   </Tooltip>
 */
export type TooltipSide = "top" | "bottom";

export interface TooltipProps {
  /** The visible text. Keep it to a couple of words — this is a label, not help text. */
  label: React.ReactNode;
  /** Which side of the trigger to render on. Defaults to "top". */
  side?: TooltipSide;
  /** The control being labelled. Must be a single focusable element. */
  children: React.ReactNode;
  className?: string;
}

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full mb-1.5",
  bottom: "top-full mt-1.5",
};

export function Tooltip({ label, side = "top", children, className }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          // Positioned relative to the trigger, centred on it. `pointer-events-none` so
          // the tooltip can never sit between the cursor and the button it describes.
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2",
          sideClasses[side],
          "whitespace-nowrap rounded px-2 py-1 text-xs font-medium",
          "bg-fg text-bg shadow-md",
          // Hidden by default; revealed on hover or keyboard focus of anything inside
          // the group. `invisible` rather than `hidden` so the fade has something to
          // animate, and so layout is computed once instead of on first hover.
          "invisible opacity-0 transition-opacity duration-100",
          "group-hover:visible group-hover:opacity-100",
          "group-focus-within:visible group-focus-within:opacity-100",
          // Respect reduced-motion: no fade, just appear.
          "motion-reduce:transition-none",
        )}
      >
        {label}
      </span>
    </span>
  );
}
