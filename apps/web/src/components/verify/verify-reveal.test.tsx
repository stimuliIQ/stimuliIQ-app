// VerifyReveal tests — the scan-then-reveal sequence on /verify/<id>.
//
// The sequence is decorative, so what these tests actually guard is that it can never cost
// a visitor the verdict:
//   - the result is rendered from the very first pass, before any beat has run;
//   - the overlay never leaks into the accessibility tree;
//   - the seal is not shown before the verified beat (it would give the answer away);
//   - prefers-reduced-motion skips the whole thing rather than making someone sit it out;
//   - the machine always terminates at "settled" and drops the overlay.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { VerifyReveal } from "./verify-reveal";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Total run time of the three beats, with room to spare. */
const FULL_SEQUENCE_MS = 3000;

function renderReveal(props: Partial<React.ComponentProps<typeof VerifyReveal>> = {}) {
  return render(
    <VerifyReveal
      tone="success"
      idText="STMQ-2026-7F3K-9QX2"
      seal={<p data-testid="the-seal">Certificate Verified</p>}
      layout="split"
      {...props}
    >
      <p data-testid="the-result">Aditi Sharma</p>
    </VerifyReveal>,
  );
}

function stubReducedMotion(reduce: boolean) {
  // jsdom has no matchMedia; the component guards on that, so a test that wants a
  // specific answer has to supply one.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function stage(container: HTMLElement): string | null {
  return container.querySelector(".verify-reveal")?.getAttribute("data-verify-stage") ?? null;
}

/**
 * Step the machine on until it reaches `target`. Stepped rather than one long advance:
 * each transition schedules the NEXT timer from an effect that only runs once the current
 * one has been flushed, so a single advance moves the machine exactly one beat however
 * long it is. Bounded so a machine that never reaches the target fails the assertion
 * rather than hanging the suite.
 */
function advanceTo(container: HTMLElement, target: string) {
  for (let step = 0; step < 8 && stage(container) !== target; step += 1) {
    act(() => void vi.advanceTimersByTime(FULL_SEQUENCE_MS));
  }
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

// ─────────────────────────────────────────────────────────────────────────────
// The result is never the animation's to withhold
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyReveal, the result", () => {
  it("renders the result on the very first pass, before any beat has run", () => {
    const { container } = renderReveal();
    expect(stage(container)).toBe("scan");
    // Present in the DOM (and so in the accessibility tree) while the scan is still going.
    expect(screen.getByTestId("the-result")).toBeInTheDocument();
  });

  it("keeps the overlay out of the accessibility tree entirely", () => {
    const { container } = renderReveal();
    const overlay = container.querySelector(".verify-reveal__overlay");
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
  });

  it("carries a noscript fallback that shows the result and drops the overlay without JS", () => {
    // Asserted against the SERVER markup on purpose. React's client renderer skips
    // <noscript> children (a browser running React would ignore them anyway), so the
    // only place this fallback exists is the HTML a no-JS visitor is served — which is
    // exactly the visitor it is for.
    const html = renderToStaticMarkup(
      <VerifyReveal tone="success" idText="STMQ-2026-7F3K-9QX2" seal={null} layout="split">
        <p>result</p>
      </VerifyReveal>,
    );
    expect(html).toContain("<noscript>");
    expect(html).toContain(".verify-reveal__result{opacity:1;animation:none}");
    expect(html).toContain(".verify-reveal__overlay{display:none}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The beats
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyReveal, the sequence", () => {
  it("walks scan → id → verified → settled and then drops the overlay", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = renderReveal();

    expect(stage(container)).toBe("scan");
    act(() => void vi.advanceTimersByTime(1200));
    expect(stage(container)).toBe("id");
    act(() => void vi.advanceTimersByTime(900));
    expect(stage(container)).toBe("verified");
    act(() => void vi.advanceTimersByTime(800));
    expect(stage(container)).toBe("settled");

    // Once settled the overlay is gone, not merely transparent.
    expect(container.querySelector(".verify-reveal__overlay")).toBeNull();
  });

  it("does not show the seal before the verified beat: the scan must not give the answer away", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = renderReveal();

    // Nothing anywhere on the page is showing the verdict yet.
    expect(screen.queryByTestId("the-seal")).toBeNull();

    advanceTo(container, "verified");
    expect(stage(container)).toBe("verified");
    // Now the seal is also in the overlay, ready to hand over to the settled result.
    expect(container.querySelector(".verify-reveal__overlay [data-testid='the-seal']")).not.toBeNull();
  });

  it("reads the certificate ID off the card during the scan", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = renderReveal();
    const overlay = container.querySelector(".verify-reveal__overlay");
    expect(overlay?.textContent).toContain("STMQ-2026-7F3K-9QX2");
  });

  it("always terminates: no timer is left pending once it has settled", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = renderReveal();
    advanceTo(container, "settled");
    expect(stage(container)).toBe("settled");
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reduced motion
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyReveal, prefers-reduced-motion", () => {
  it("skips the sequence outright rather than making the visitor sit through it", () => {
    stubReducedMotion(true);
    const { container } = renderReveal();
    expect(stage(container)).toBe("settled");
    expect(container.querySelector(".verify-reveal__overlay")).toBeNull();
    expect(screen.getByTestId("the-result")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout variants
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyReveal, layout", () => {
  it("sizes the scan card to one grid column when the result is a split", () => {
    const { container } = renderReveal({ layout: "split" });
    expect(container.querySelector(".verify-scan-frame")?.className).toContain(
      "verify-scan-column",
    );
  });

  it("centres a narrow scan card when there are no details to reveal beside it", () => {
    const { container } = renderReveal({ layout: "solo" });
    const frame = container.querySelector(".verify-scan-frame")?.className ?? "";
    expect(frame).not.toContain("verify-scan-column");
    expect(frame).toContain("max-w-sm");
  });
});
