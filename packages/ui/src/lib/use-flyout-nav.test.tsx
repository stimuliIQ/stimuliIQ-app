// The shared flyout-nav interaction. Two apps depend on it, so the subtle rules live here
// once and are pinned here once.
//
// jsdom's matchMedia stub answers `false` to everything, which makes the DEFAULT render a
// touch device — so "click opens it" is tested against the harder case, and the hover cases
// opt in by overriding the stub.
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { useFlyoutNav } from "./use-flyout-nav";

/** Makes `(hover: hover) and (pointer: fine)` match — i.e. pretend to be a mouse. */
function pretendMousePointer(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("hover: hover"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function Harness({ closeOn }: { closeOn?: unknown }) {
  const nav = useFlyoutNav({ closeOn });
  return (
    <div ref={nav.containerRef as React.RefObject<HTMLDivElement>} data-testid="container">
      {["alpha", "beta"].map((key) => (
        <div key={key} {...nav.hoverProps(key)} data-testid={`row-${key}`}>
          <button type="button" onClick={() => (nav.isOpen(key) ? nav.close() : nav.open(key))}>
            {key}
          </button>
          {nav.isOpen(key) ? (
            <div {...nav.panelHoverProps} data-testid={`panel-${key}`}>
              panel {key}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFlyoutNav — opening", () => {
  it("starts with nothing open", () => {
    render(<Harness />);
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("opens on CLICK on a touch device, where there is no hover to rely on", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();
  });

  it("does NOT open on hover on a touch device", () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByTestId("row-alpha"));
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("opens on hover once the device reports a real hover state, after the intent delay", () => {
    pretendMousePointer();
    render(<Harness />);

    fireEvent.mouseEnter(screen.getByTestId("row-alpha"));
    // Hover intent: dragging the pointer past a row must not fire its panel.
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();
  });

  it("a hover that leaves before the delay elapses opens nothing", () => {
    pretendMousePointer();
    render(<Harness />);
    const row = screen.getByTestId("row-alpha");

    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("switching to a neighbour while one is open is immediate", () => {
    pretendMousePointer();
    render(<Harness />);

    fireEvent.mouseEnter(screen.getByTestId("row-alpha"));
    act(() => void vi.advanceTimersByTime(200));

    fireEvent.mouseEnter(screen.getByTestId("row-beta"));
    expect(screen.getByTestId("panel-beta")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("a click never waits for the hover-intent delay", () => {
    pretendMousePointer();
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();
  });

  it("only one panel is open at a time", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.click(screen.getByText("beta"));
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-beta")).toBeInTheDocument();
  });
});

describe("useFlyoutNav — dismissing", () => {
  it("closes after a grace period once the pointer leaves, not instantly", () => {
    pretendMousePointer();
    render(<Harness />);
    const row = screen.getByTestId("row-alpha");

    fireEvent.mouseEnter(row);
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.mouseLeave(row);
    // Still open inside the grace window — this is what stops the panel vanishing when the
    // pointer clips a neighbouring row on its way in.
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("Escape closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("a pointer press outside the container closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("a pointer press INSIDE the panel leaves it alone", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.pointerDown(screen.getByTestId("panel-alpha"));
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();
  });

  it("a second click on the same section closes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.click(screen.getByText("alpha"));
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });

  it("closes when `closeOn` changes — navigating ends the interaction", () => {
    const { rerender } = render(<Harness closeOn="/leads" />);
    fireEvent.click(screen.getByText("alpha"));
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();

    rerender(<Harness closeOn="/students" />);
    expect(screen.queryByTestId("panel-alpha")).not.toBeInTheDocument();
  });
});
