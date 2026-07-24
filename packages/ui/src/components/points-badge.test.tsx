import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PointsBadge, StreakFlame } from "./points-badge";

// ---------------------------------------------------------------------------
// PointsBadge
// ---------------------------------------------------------------------------

describe("PointsBadge — rendering", () => {
  it("renders with default data-testid='points-badge'", () => {
    render(<PointsBadge points={1000} />);
    expect(screen.getByTestId("points-badge")).toBeInTheDocument();
  });

  it("has aria-label with points and unit", () => {
    render(<PointsBadge points={4250} label="XP" />);
    expect(screen.getByLabelText("4,250 XP")).toBeInTheDocument();
  });

  it("renders a custom label unit", () => {
    render(<PointsBadge points={100} label="pts" />);
    expect(screen.getByLabelText("100 pts")).toBeInTheDocument();
  });

  it("defaults label to 'XP'", () => {
    render(<PointsBadge points={0} />);
    expect(screen.getByLabelText("0 XP")).toBeInTheDocument();
  });
});

describe("PointsBadge — a11y", () => {
  it("icon is aria-hidden", () => {
    const { container } = render(<PointsBadge points={100} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// StreakFlame
// ---------------------------------------------------------------------------

describe("StreakFlame — rendering", () => {
  it("renders with default data-testid='streak-flame'", () => {
    render(<StreakFlame days={7} />);
    expect(screen.getByTestId("streak-flame")).toBeInTheDocument();
  });

  it("announces active streak correctly", () => {
    render(<StreakFlame days={14} />);
    expect(screen.getByLabelText("14-day streak")).toBeInTheDocument();
  });

  it("announces no-streak state with helpful description", () => {
    render(<StreakFlame days={0} />);
    expect(screen.getByLabelText(/no active streak/i)).toBeInTheDocument();
  });

  it("flame icon is aria-hidden", () => {
    const { container } = render(<StreakFlame days={5} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StreakFlame — reduced-motion awareness", () => {
  it("has motion-safe:animate-pulse class in the flame SVG class list only when days > 0", () => {
    const { container } = render(<StreakFlame days={10} />);
    // Lucide renders Flame as an <svg>; the className prop is applied as the SVG class attribute.
    // In jsdom, SVGElement.getAttribute("class") returns the raw class string.
    // Tailwind's `motion-safe:animate-pulse` appears as the literal class name in the DOM
    // (the motion-safe: prefix is a CSS @media gate, not a JS runtime toggle).
    const svg = container.querySelector("svg");
    const classStr = svg?.getAttribute("class") ?? "";
    // The class string should contain either "animate-pulse" (if Tailwind compiled it) or
    // "motion-safe:animate-pulse" (the raw class name before Tailwind processes it in jsdom).
    expect(classStr).toMatch(/animate-pulse/);
  });

  it("does not apply animation class when streak is 0", () => {
    const { container } = render(<StreakFlame days={0} />);
    const svg = container.querySelector("svg");
    const classStr = svg?.getAttribute("class") ?? "";
    expect(classStr).not.toMatch(/animate-pulse/);
  });
});
