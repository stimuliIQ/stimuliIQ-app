import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { CountdownTimer } from "./countdown-timer";

// ---------------------------------------------------------------------------
// Timer helpers, vitest fake timers
// ---------------------------------------------------------------------------

function futureIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

describe("CountdownTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Unit tests
  // ---------------------------------------------------------------------------

  it("renders without crashing and exposes a data-testid", () => {
    render(<CountdownTimer expiresAt={futureIso(300)} />);
    expect(screen.getByTestId("countdown-timer")).toBeInTheDocument();
  });

  it("displays the formatted mm:ss countdown", () => {
    render(<CountdownTimer expiresAt={futureIso(125)} />);
    // Should show "02:05" (125s = 2 min 5 sec)
    // The visible span is aria-hidden but the sr-only span is text-accessible
    const liveRegion = document.querySelector('[aria-hidden="false"]');
    // Time display is in the aria-hidden visual span; the sr-only span has the label.
    const srOnly = document.querySelector(".sr-only:not([aria-live])");
    expect(srOnly?.textContent).toMatch(/02:05/);
  });

  it("shows H:MM:SS once an hour or more remains (e.g. the retry cooldown)", () => {
    // 141 min 12 s = 2 h 21 min 12 s, must read "2:21:12", not the overflowed "141:12".
    render(<CountdownTimer expiresAt={futureIso(2 * 3600 + 21 * 60 + 12)} />);
    const srOnly = document.querySelector(".sr-only:not([aria-live])");
    expect(srOnly?.textContent).toMatch(/2:21:12/);
  });

  it("ticks down over time", () => {
    render(<CountdownTimer expiresAt={futureIso(10)} />);
    const getLabel = () => {
      const srOnly = document.querySelector(".sr-only:not([aria-live])");
      return srOnly?.textContent ?? "";
    };
    expect(getLabel()).toMatch(/Time remaining: 00:10/);
    act(() => vi.advanceTimersByTime(3000));
    expect(getLabel()).toMatch(/Time remaining: 00:07/);
  });

  it("calls onExpire exactly once when time reaches 0", () => {
    const onExpire = vi.fn();
    render(<CountdownTimer expiresAt={futureIso(2)} onExpire={onExpire} />);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("does not call onExpire multiple times (idempotent expiry)", () => {
    const onExpire = vi.fn();
    render(<CountdownTimer expiresAt={futureIso(1)} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("shows expired state when time is 0", () => {
    render(<CountdownTimer expiresAt={futureIso(1)} />);
    act(() => vi.advanceTimersByTime(2000));
    const srOnly = document.querySelector(".sr-only:not([aria-live])");
    expect(srOnly?.textContent).toMatch(/Time is up/);
  });

  // ---------------------------------------------------------------------------
  // a11y tests
  // ---------------------------------------------------------------------------

  it("has an aria-live='polite' region for screen reader announcements", () => {
    render(<CountdownTimer expiresAt={futureIso(300)} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it("does NOT announce every second (liveText stays empty between intervals)", () => {
    render(
      <CountdownTimer
        expiresAt={futureIso(20)}
        announceAtSeconds={[10]}
      />,
    );
    const liveRegion = document.querySelector('[aria-live="polite"]');
    // At t=0 (20s remaining), not in announceAtSeconds → empty
    expect(liveRegion?.textContent).toBe("");
    // Advance to 10s remaining, should announce
    act(() => vi.advanceTimersByTime(10000));
    expect(liveRegion?.textContent).toMatch(/10 second/);
    // Advance another 5s (5s remaining), not in announceAtSeconds → no update
    act(() => vi.advanceTimersByTime(5000));
    expect(liveRegion?.textContent).toMatch(/10 second/); // unchanged
  });

  it("announces 'Time is up' when the timer expires", () => {
    render(<CountdownTimer expiresAt={futureIso(1)} announceAtSeconds={[]} />);
    act(() => vi.advanceTimersByTime(2000));
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("Time is up.");
  });

  it("has no color-only low-time state, shows AlertTriangle icon on expiry", () => {
    render(<CountdownTimer expiresAt={futureIso(1)} />);
    act(() => vi.advanceTimersByTime(2000));
    // AlertTriangle SVG must appear in the DOM (non-color signal for expiry)
    const icons = document.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
  });

  it("exposes a static sr-only label not via aria-live (so focus reads it without waiting)", () => {
    render(<CountdownTimer expiresAt={futureIso(65)} />);
    const nonLiveSrOnly = Array.from(document.querySelectorAll(".sr-only")).filter(
      (el) => !el.hasAttribute("aria-live"),
    );
    // Should be at least one static label
    expect(nonLiveSrOnly.some((el) => el.textContent?.includes("Time remaining"))).toBe(true);
  });

  it("respects data-testid override", () => {
    render(
      <CountdownTimer
        expiresAt={futureIso(60)}
        data-testid="my-timer"
      />,
    );
    expect(screen.getByTestId("my-timer")).toBeInTheDocument();
  });
});
