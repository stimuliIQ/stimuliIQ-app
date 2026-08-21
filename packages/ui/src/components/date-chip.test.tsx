import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DateChip, formatRelativeDate, formatAbsoluteDate } from "./date-chip";

// ---------------------------------------------------------------------------
// formatRelativeDate helper
// ---------------------------------------------------------------------------

describe("formatRelativeDate", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  it("returns 'Just now' for < 1 minute diff", () => {
    const date = new Date(now.getTime() + 20_000); // 20s ahead, rounds to 0 minutes
    expect(formatRelativeDate(date, now)).toBe("Just now");
  });

  it("returns 'in Xm' for future minutes", () => {
    const date = new Date(now.getTime() + 30 * 60_000); // 30 min ahead
    expect(formatRelativeDate(date, now)).toBe("in 30m");
  });

  it("returns 'Xm ago' for past minutes", () => {
    const date = new Date(now.getTime() - 20 * 60_000);
    expect(formatRelativeDate(date, now)).toBe("20m ago");
  });

  it("returns 'in Xh' for future hours", () => {
    const date = new Date(now.getTime() + 3 * 3_600_000);
    expect(formatRelativeDate(date, now)).toBe("in 3h");
  });

  it("returns 'Xh ago' for past hours", () => {
    const date = new Date(now.getTime() - 5 * 3_600_000);
    expect(formatRelativeDate(date, now)).toBe("5h ago");
  });

  it("returns 'Tomorrow' for 1 day ahead", () => {
    const date = new Date(now.getTime() + 86_400_000);
    expect(formatRelativeDate(date, now)).toBe("Tomorrow");
  });

  it("returns 'Yesterday' for 1 day past", () => {
    const date = new Date(now.getTime() - 86_400_000);
    expect(formatRelativeDate(date, now)).toBe("Yesterday");
  });

  it("returns 'in Xd' for future days within a week", () => {
    const date = new Date(now.getTime() + 3 * 86_400_000);
    expect(formatRelativeDate(date, now)).toBe("in 3d");
  });

  it("returns 'Xd ago' for past days within a week", () => {
    const date = new Date(now.getTime() - 4 * 86_400_000);
    expect(formatRelativeDate(date, now)).toBe("4d ago");
  });

  it("returns absolute date for > 4 weeks", () => {
    const date = new Date("2026-01-01T12:00:00Z");
    // Should fall back to formatAbsoluteDate
    const result = formatRelativeDate(date, now);
    expect(result).toContain("2026");
  });
});

describe("formatAbsoluteDate", () => {
  it("formats a date as 'D Mon YYYY' style", () => {
    const date = new Date("2026-07-01T00:00:00Z");
    const result = formatAbsoluteDate(date);
    // en-IN locale short: "1 Jul 2026" or locale-variant
    expect(result).toMatch(/1.+Jul.+2026|Jul.+1.+2026/i);
  });
});

// ---------------------------------------------------------------------------
// DateChip component
// ---------------------------------------------------------------------------

describe("DateChip", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  it("renders a visible label (never silent / color-only)", () => {
    const date = new Date(now.getTime() + 2 * 86_400_000); // 2 days ahead
    render(<DateChip date={date} />);
    // Should have some text
    const chip = screen.getByTestId("date-chip");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders an icon (calendar icon present)", () => {
    const date = new Date(now.getTime() + 2 * 86_400_000);
    const { container } = render(<DateChip date={date} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders in 'absolute' format when specified", () => {
    const date = new Date("2026-07-01T00:00:00Z");
    render(<DateChip date={date} format="absolute" />);
    // Absolute should contain year
    const chip = screen.getByTestId("date-chip");
    expect(chip.textContent).toMatch(/2026/);
  });

  it("renders in 'both' format showing both relative and absolute", () => {
    const date = new Date(now.getTime() + 3 * 86_400_000);
    render(<DateChip date={date} format="both" />);
    const chip = screen.getByTestId("date-chip");
    // Both should have · separator
    expect(chip.textContent).toContain("·");
  });

  it("applies tone classes for non-neutral tone", () => {
    const date = new Date(now.getTime() + 86_400_000);
    const { container } = render(<DateChip date={date} tone="warning" />);
    // Warning tone uses amber/warning color class
    expect(container.firstChild).toHaveClass("text-warning");
  });

  it("applies a data-testid", () => {
    const date = new Date();
    render(<DateChip date={date} data-testid="my-date-chip" />);
    expect(screen.getByTestId("my-date-chip")).toBeInTheDocument();
  });
});
