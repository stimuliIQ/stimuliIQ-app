"use client";

import * as React from "react";

/**
 * Where a flyout card's top edge goes, in viewport pixels.
 *
 * Shared by the CRM sidebar and the LMS side nav. It exists because the obvious approach is
 * subtly wrong and was wrong in both of them:
 *
 *   BROKEN: pin the card's top to its row, then cap its height at the space remaining below
 *           (`maxHeight: 100vh - top`). A section near the bottom of the column then gets a
 *           sliver of height and grows an internal scrollbar — the one thing a menu of eight
 *           items must never do, because the whole point is seeing them all at once.
 *
 *   RIGHT:  pin the card's top to its row, then SLIDE IT UP as far as needed so the whole
 *           card fits on screen. Height is whatever the content needs.
 *
 * Scrolling is therefore only ever a last resort: `maxHeight` is the full usable viewport,
 * so a card scrolls only when its content genuinely cannot fit the screen at all, not merely
 * because it happens to hang off a row near the bottom.
 *
 * The panel must be measured at its NATURAL height, so the caller has to render it in its
 * floating form (not stretched to the viewport) on the pass this hook measures. Returning
 * `null` means "not floating" — the caller should use its non-floating layout.
 */
export interface UseFlyoutPositionOptions {
  /** False while the panel is closed, or on layouts where it does not float (phones). */
  enabled: boolean;
  /** The row the card belongs beside. */
  rowRef: React.RefObject<HTMLElement | null>;
  /** The card itself. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** Gap kept from the viewport edges, and how far above the row the card starts. */
  margin?: number;
}

export interface FlyoutPosition {
  /** `top` in viewport pixels, or null when not floating. */
  top: number | null;
  /** The most the card may ever be, so a genuinely oversized list still scrolls. */
  maxHeight: string;
}

export function useFlyoutPosition({
  enabled,
  rowRef,
  panelRef,
  margin = 8,
}: UseFlyoutPositionOptions): FlyoutPosition {
  const [top, setTop] = React.useState<number | null>(null);

  // useLayoutEffect, not useEffect: this runs after the DOM is written but BEFORE the
  // browser paints, so the corrected position is the first thing anybody sees. With
  // useEffect the card would visibly jump.
  React.useLayoutEffect(() => {
    if (!enabled) {
      setTop(null);
      return;
    }
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!row || !panel) return;

    const rowTop = row.getBoundingClientRect().top;
    const panelHeight = panel.offsetHeight;
    const viewport = window.innerHeight;

    // Ideal: a touch above the row, so the first ITEM lines up with the row that opened it
    // rather than the card's border doing so.
    const ideal = rowTop - margin;
    // The lowest top that still leaves the whole card on screen.
    const lowest = viewport - panelHeight - margin;

    // `Math.min` slides the card up when it would overhang the bottom; `Math.max` stops it
    // being pushed off the TOP when the card is taller than the viewport — in that one case
    // it starts at the margin and `maxHeight` below lets it scroll.
    setTop(Math.max(margin, Math.min(ideal, lowest)));
  }, [enabled, rowRef, panelRef, margin]);

  return {
    top: enabled ? top : null,
    maxHeight: `calc(100vh - ${margin * 2}px)`,
  };
}
