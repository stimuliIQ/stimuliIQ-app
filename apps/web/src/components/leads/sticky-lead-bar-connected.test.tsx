/**
 * StickyLeadBarConnected tests.
 *
 * These exist because of a specific reported defect: after a visitor successfully submitted
 * their number, the confirmation auto-dismissed and the bar came straight back asking for
 * the number again. The success path used to call `reset()`, returning the capture state to
 * idle, which re-rendered the empty callback form.
 *
 * The contract asserted here is behavioural, not cosmetic: once a number has been given,
 * the bar must not ask for one again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { StickyLeadBarConnected } from "./sticky-lead-bar-connected";
import { useLeadCapture } from "../../hooks/use-lead-capture";

vi.mock("../../hooks/use-lead-capture", () => ({
  useLeadCapture: vi.fn(),
}));

// The captcha widget loads a Cloudflare script; the bar's behaviour does not depend on it.
vi.mock("../captcha/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

const submit = vi.fn();
const reset = vi.fn();

/** Matches the component's SUCCESS_AUTO_DISMISS_MS. */
const AUTO_DISMISS_MS = 3000;

function mockState(state: ReturnType<typeof useLeadCapture>["state"]) {
  vi.mocked(useLeadCapture).mockReturnValue({ state, submit, reset });
}

describe("StickyLeadBarConnected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the callback form before a number has been submitted", () => {
    mockState({ kind: "idle" });

    render(<StickyLeadBarConnected />);

    expect(screen.getByTestId("sticky-lead-bar")).toBeInTheDocument();
  });

  // The reported defect, asserted directly.
  it("does not come back after the success confirmation auto-dismisses", () => {
    mockState({ kind: "success", message: "Thanks! We'll call you shortly." });

    render(<StickyLeadBarConnected />);
    expect(screen.getByText("Thanks! We'll call you shortly.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS);
    });

    // The whole bar is gone — not merely back to its idle form.
    expect(screen.queryByTestId("sticky-lead-bar")).not.toBeInTheDocument();
  });

  // `reset()` is what re-armed the form; calling it on the success path is the bug.
  it("never resets the capture state back to idle after a success", () => {
    mockState({ kind: "success", message: "Thanks!" });

    render(<StickyLeadBarConnected />);
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS);
    });

    expect(reset).not.toHaveBeenCalled();
  });

  it("stays gone on a later render in the same session", () => {
    mockState({ kind: "success", message: "Thanks!" });

    const first = render(<StickyLeadBarConnected />);
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS);
    });
    first.unmount();

    // A fresh mount stands in for a client navigation to another program page.
    mockState({ kind: "idle" });
    render(<StickyLeadBarConnected />);

    expect(screen.queryByTestId("sticky-lead-bar")).not.toBeInTheDocument();
  });

  // Regression guard for the manual path, which had the same defect via onClick={reset}.
  it("retires rather than re-arms when Dismiss is clicked", () => {
    mockState({ kind: "success", message: "Thanks!" });

    render(<StickyLeadBarConnected />);
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });

    expect(screen.queryByTestId("sticky-lead-bar")).not.toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });

  // Storage is a convenience for the cross-navigation case, not a prerequisite for the fix.
  it("still dismisses when sessionStorage is unavailable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    mockState({ kind: "success", message: "Thanks!" });

    render(<StickyLeadBarConnected />);
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS);
    });

    expect(screen.queryByTestId("sticky-lead-bar")).not.toBeInTheDocument();
    setItem.mockRestore();
  });
});
