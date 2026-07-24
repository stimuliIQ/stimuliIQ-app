"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * CollapsibleSection — generic headed disclosure container, per
 * docs/specs/phase-10-ui-polish-visual-audit.md §2.1. Used for collapsed block-card
 * summaries (Page Builder), the "SEO & metadata (optional)" disclosure on page-detail
 * cards, and any other place a header + body needs a collapse/expand affordance.
 *
 * CRITICAL implementation constraint (zero functionality loss): the body is collapsed
 * via CSS only — it stays mounted in the React tree at all times, even while closed.
 * Consumers (e.g. `KnownBlockCard`) hold a live `useForm()` instance in `children`;
 * unmounting on collapse (`{open && <Body/>}`) would tear that instance down and drop
 * `registerFormApi` entries, silently corrupting Save/Preview's `gatherBlocks()`. The
 * closed state is achieved with a CSS grid `0fr`/`1fr` row-track transition (smoothly
 * animates to/from the content's natural height with no JS measurement, unlike a fixed
 * `max-h-*` value) plus the `overflow-hidden` wrapper Tailwind pattern the spec calls
 * out. The body is additionally marked `inert` while closed so its (still-mounted,
 * still-live) form controls are neither keyboard-focusable nor exposed to assistive
 * tech while hidden — this is what actually satisfies "no functionality loss without
 * a tab-order/screen-reader regression," not just the CSS collapse alone.
 *
 * a11y:
 * - Real `<button aria-expanded aria-controls>` header — Enter/Space toggle natively.
 * - Chevron is `aria-hidden`; the toggle state is conveyed by `aria-expanded`, not the
 *   icon's rotation (docs/07-design-system.md §2, "never convey state by shape/color
 *   alone" extended to icon-orientation-alone).
 * - `headerActions` render as a sibling of the toggle button (never nested inside it —
 *   interactive descendants of a `<button>` are invalid HTML and unreachable for
 *   assistive tech), so trailing icon-buttons (drag/reorder/delete) keep their own
 *   independent click/keyboard handling and never trigger the toggle.
 * - Respects `prefers-reduced-motion` for free — the transition utilities read the
 *   global override in `packages/ui/src/styles.css`, no extra work needed here.
 *
 * Controlled/uncontrolled: pass `open`+`onOpenChange` to drive state externally (e.g.
 * auto-expand a block on validation failure), or `defaultOpen` for self-managed state.
 *
 * Usage:
 *   <CollapsibleSection
 *     defaultOpen={false}
 *     icon={<PanelTop />}
 *     accentTone="chart-1"
 *     header={
 *       <div className="flex items-center gap-2 min-w-0">
 *         <span className="font-medium">1. Hero</span>
 *         <span className="truncate text-sm text-fg-muted">
 *           We bridge the gap between college and career.
 *         </span>
 *       </div>
 *     }
 *     headerActions={
 *       <Button variant="ghost" size="icon" aria-label="Remove block" onClick={onRemove}>
 *         <Trash2 />
 *       </Button>
 *     }
 *   >
 *     <BlockDataFields ... />
 *   </CollapsibleSection>
 */

export type CollapsibleSectionAccentTone =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-6"
  | "neutral";

// Tailwind classes must appear as literal strings for the JIT scanner — resolved via
// lookup rather than string interpolation. Mirrors the tinted-chip pattern already used
// by StatusChip (`bg-<tone>/15 text-<tone>`) and BadgeChip.
const ACCENT_TONE_CLASSES: Record<CollapsibleSectionAccentTone, string> = {
  "chart-1": "bg-chart-1/15 text-chart-1",
  "chart-2": "bg-chart-2/15 text-chart-2",
  "chart-3": "bg-chart-3/15 text-chart-3",
  "chart-6": "bg-chart-6/15 text-chart-6",
  neutral: "bg-fg-muted/15 text-fg-muted",
};

export interface CollapsibleSectionProps {
  /** Controlled open state. Omit to let the component manage its own state. */
  open?: boolean;
  /** Initial open state when uncontrolled. Defaults to `false` (collapsed). */
  defaultOpen?: boolean;
  /** Fires whenever the section is toggled, whether controlled or uncontrolled. */
  onOpenChange?: (open: boolean) => void;
  /** Leading icon shown inside a tinted accent chip. Decorative — always `aria-hidden`. */
  icon?: React.ReactNode;
  /** Accent color for the icon chip. Reuses the categorical chart palette (never the
   *  sole signal of meaning — always paired with the icon + visible text in `header`). */
  accentTone?: CollapsibleSectionAccentTone;
  /** Always-visible header content (title + summary/excerpt) — rendered open or closed. */
  header: React.ReactNode;
  /** Trailing header content (badges, icon-buttons). Sibling of the toggle, not nested
   *  inside it — clicks here never toggle the section. */
  headerActions?: React.ReactNode;
  /** Body content, only visually revealed when open — stays mounted at all times. */
  children: React.ReactNode;
  className?: string;
  /** className applied to the inner body padding wrapper. */
  bodyClassName?: string;
  id?: string;
  /** Test hook; defaults to "collapsible-section" when omitted. */
  "data-testid"?: string;
}

export const CollapsibleSection = React.forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  (
    {
      open: controlledOpen,
      defaultOpen = false,
      onOpenChange,
      icon,
      accentTone = "neutral",
      header,
      headerActions,
      children,
      className,
      bodyClassName,
      id,
      "data-testid": testId,
    },
    ref,
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const open = controlledOpen ?? uncontrolledOpen;

    const generatedId = React.useId();
    const sectionId = id ?? generatedId;
    const headerId = `${sectionId}-header`;
    const bodyId = `${sectionId}-body`;

    function toggle(): void {
      const next = !open;
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }

    // headerActions is already a DOM sibling of the trigger <button> (never a descendant),
    // so a click there cannot bubble through the button's own click handler. The extra
    // stopPropagation is defense-in-depth for callers who wrap this in their own
    // click-delegating container.
    function stopActionsClick(event: React.MouseEvent<HTMLDivElement>): void {
      event.stopPropagation();
    }

    return (
      <div
        ref={ref}
        id={sectionId}
        data-testid={testId ?? "collapsible-section"}
        data-state={open ? "open" : "closed"}
        className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}
      >
        <div className="flex items-center bg-card">
          <button
            type="button"
            id={headerId}
            data-testid="collapsible-section-trigger"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left",
              "transition-colors duration-fast ease-out hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-fg-muted transition-transform duration-fast ease-out",
                open && "rotate-90",
              )}
            />
            {icon ? (
              <span
                aria-hidden="true"
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-md p-1.5",
                  "[&_svg]:size-4 [&_svg]:shrink-0",
                  ACCENT_TONE_CLASSES[accentTone],
                )}
              >
                {icon}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 items-center gap-2">{header}</span>
          </button>

          {headerActions ? (
            <div
              data-testid="collapsible-section-actions"
              onClick={stopActionsClick}
              className="flex shrink-0 items-center gap-1 pr-3"
            >
              {headerActions}
            </div>
          ) : null}
        </div>

        {/* 0fr/1fr grid-row transition: animates smoothly to the content's natural
            height without a JS measurement pass or a magic-number max-height guess. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-base ease-out",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div
              id={bodyId}
              role="region"
              aria-labelledby={headerId}
              data-testid="collapsible-section-body"
              // `inert` (not `hidden`/unmount): keeps the subtree mounted and its state
              // (e.g. a live react-hook-form instance) intact while closed, but removes
              // it from the tab order and the accessibility tree — the CSS collapse
              // alone does neither.
              inert={!open}
              className={cn("border-t border-border px-4 py-3", bodyClassName)}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
CollapsibleSection.displayName = "CollapsibleSection";
