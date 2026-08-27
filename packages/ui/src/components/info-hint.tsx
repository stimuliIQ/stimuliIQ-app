"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * InfoHint — a small "what is this?" icon that opens a short explanation.
 *
 * NOT `Tooltip`. That component is a hover-only, `whitespace-nowrap`, `aria-hidden`
 * VISUAL label for an icon-only control that already has an accessible name. This one
 * carries HELP TEXT: a sentence or two that a reader actually needs, which means it has
 * to wrap, has to be reachable on a touch screen (hover does not exist there), and has
 * to be readable by a screen reader rather than hidden from it. So it is a real
 * disclosure: a `<button aria-expanded aria-controls>` plus a panel of plain text.
 *
 * Opens on click/Enter/Space, closes on a second press, on Escape, or on a pointer
 * press outside. Deliberately does NOT open on hover — a panel that appears while the
 * pointer is only passing over a dense table is noise, and a hover-open panel cannot be
 * dismissed by anyone reading it with a finger.
 *
 * DEPENDENCY-FREE, same reasoning as `Tooltip`: a permission matrix renders one of
 * these per row across ~140 rows, and a portalled, JS-positioned popover per row is a
 * lot of machinery for "show a paragraph next to this icon".
 *
 * Usage:
 *   <InfoHint label="View students">
 *     Lets this role open the Students list and read student records.
 *   </InfoHint>
 */
export type InfoHintAlign = "start" | "end";

export interface InfoHintProps {
  /**
   * What the icon explains. Used to build the button's accessible name
   * ("What does <label> mean?"), so pass the row/heading text, not a sentence.
   */
  label: string;
  /** The explanation. A sentence or two of plain text. */
  children: React.ReactNode;
  /**
   * Which edge of the trigger the panel is anchored to. Defaults to "start", so the panel
   * opens rightwards: the common case is an icon sitting just after a label near the left
   * edge of its container, where anchoring to the right would push the panel off-screen.
   */
  align?: InfoHintAlign;
  /** Extra classes on the wrapper. */
  className?: string;
}

const alignClasses: Record<InfoHintAlign, string> = {
  start: "left-0",
  end: "right-0",
};

export function InfoHint({ label, children, align = "start", className }: InfoHintProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const panelId = React.useId();

  // Outside-press + Escape close. Listeners are attached only while open so a table
  // full of these does not install 140 idle document listeners.
  React.useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={`What does ${label} mean?`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full text-fg-subtle",
          "transition-colors hover:bg-surface hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          open && "bg-surface text-fg",
        )}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      {/*
        Kept out of the DOM while closed rather than merely hidden: unlike
        CollapsibleSection there is no form state inside to preserve, and an
        always-mounted panel per row would put ~140 paragraphs of help text into the
        accessibility tree of one dialog.
      */}
      {open ? (
        <span
          id={panelId}
          role="note"
          className={cn(
            "absolute top-full z-50 mt-1.5 w-64 rounded-md border border-border bg-card p-3",
            "text-left text-xs font-normal leading-relaxed text-fg shadow-md",
            "normal-case",
            alignClasses[align],
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
