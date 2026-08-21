// Regression anchor for "the flyout grew a scrollbar".
//
// The reported symptom: opening a section near the BOTTOM of the nav column (Support, with
// Analytics below it) produced a card a few pixels tall with its own scrollbar, instead of
// the eight items it was supposed to show. Cause: the card's height was capped at the space
// remaining below its row, so the lower the row, the shorter the card.
//
// The fix slides the card UP so the whole thing fits. These tests pin that, and pin that the
// last-resort scroll still exists for a list that genuinely cannot fit any screen.
import * as React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { useFlyoutPosition } from "./use-flyout-position";

const MARGIN = 8;

/**
 * jsdom gives every element a zero bounding box, so the two measurements this hook depends
 * on are stubbed per-test: where the row is, and how tall the card wants to be.
 */
function Harness({
  rowTop,
  panelHeight,
  enabled = true,
}: {
  rowTop: number;
  panelHeight: number;
  enabled?: boolean;
}) {
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Applied before the hook's layout effect reads them.
  React.useLayoutEffect(() => {
    if (rowRef.current) {
      rowRef.current.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
    }
    if (panelRef.current) {
      Object.defineProperty(panelRef.current, "offsetHeight", {
        configurable: true,
        value: panelHeight,
      });
    }
  }, [rowTop, panelHeight]);

  const { top, maxHeight } = useFlyoutPosition({ enabled, rowRef, panelRef });

  return (
    <div>
      <div ref={rowRef} data-testid="row" />
      <div ref={panelRef} data-testid="panel" data-top={String(top)} data-max-height={maxHeight} />
    </div>
  );
}

function readTop(): number | null {
  const raw = screen.getByTestId("panel").getAttribute("data-top");
  return raw === "null" ? null : Number(raw);
}

beforeEach(() => {
  // A 900px-tall window, the height the reported screenshot was taken at.
  vi.stubGlobal("innerHeight", 900);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFlyoutPosition", () => {
  it("sits just above its row when there is room below", () => {
    render(<Harness rowTop={200} panelHeight={300} />);
    expect(readTop()).toBe(200 - MARGIN);
  });

  it("SLIDES UP instead of shrinking when the row is near the bottom", () => {
    // The reported case: Support sits low, its card is 340px tall. Anchoring at the row
    // would run 140px past the bottom edge.
    render(<Harness rowTop={700} panelHeight={340} />);

    const top = readTop()!;
    // Fully on screen, bottom margin respected.
    expect(top + 340).toBeLessThanOrEqual(900 - MARGIN);
    // And it really did move up rather than stay pinned to the row.
    expect(top).toBeLessThan(700 - MARGIN);
    expect(top).toBe(900 - 340 - MARGIN);
  });

  it("never lets the card overhang the bottom, at any row position", () => {
    for (const rowTop of [0, 100, 400, 700, 860, 899]) {
      const { unmount } = render(<Harness rowTop={rowTop} panelHeight={300} />);
      const top = readTop()!;
      expect(top).toBeGreaterThanOrEqual(MARGIN);
      expect(top + 300).toBeLessThanOrEqual(900 - MARGIN);
      unmount();
    }
  });

  it("caps maxHeight at the whole usable viewport, NOT at the space below the row", () => {
    // This is the actual bug: a maxHeight derived from `top` is what produced the sliver.
    render(<Harness rowTop={700} panelHeight={340} />);
    const maxHeight = screen.getByTestId("panel").getAttribute("data-max-height");
    expect(maxHeight).toBe(`calc(100vh - ${MARGIN * 2}px)`);
    expect(maxHeight).not.toContain("700");
  });

  it("falls back to the top margin for a card taller than the whole viewport", () => {
    // The one case where scrolling is legitimate: the content cannot fit any screen.
    render(<Harness rowTop={400} panelHeight={2000} />);
    expect(readTop()).toBe(MARGIN);
  });

  it("returns null when disabled, so the caller uses its non-floating layout", () => {
    render(<Harness rowTop={200} panelHeight={300} enabled={false} />);
    expect(readTop()).toBeNull();
  });
});
