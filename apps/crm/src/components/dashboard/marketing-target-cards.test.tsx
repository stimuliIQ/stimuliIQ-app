// Component + a11y tests for the marketing person's "My target" dashboard cards.
// Spec: docs/specs/marketing-targets.md, ADR-0067. The data hook is mocked directly.
//
// The behaviours worth pinning are the ones where being subtly wrong would MISLEAD the
// person being measured, which is worse than an outright broken card:
//   - a metric with no target must be HIDDEN, not shown as a complete-looking 0/0
//   - no target at all must still show what they have closed, not an empty card
//   - beating a target must read as done, never as a negative backlog
//   - a person given only ONE metric must be able to earn "Target met" on it alone
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MyMarketingTargetDto } from "@repo/types";
import { summariseTargetMetric } from "@repo/types";

const useMyMarketingTargetMock = vi.fn();
vi.mock("../../hooks/use-marketing-targets", () => ({
  useMyMarketingTarget: (...args: unknown[]) => useMyMarketingTargetMock(...args),
}));

import { MarketingTargetCards, formatTargetMonth } from "./marketing-target-cards";

function dto(overrides: {
  hasTarget?: boolean;
  conversionsTarget?: number;
  conversionsDone?: number;
  revenueTarget?: number;
  revenueDone?: number;
  note?: string | null;
}): MyMarketingTargetDto {
  const {
    hasTarget = true,
    conversionsTarget = 40,
    conversionsDone = 23,
    revenueTarget = 500_000_00,
    revenueDone = 287_500_00,
    note = null,
  } = overrides;
  return {
    month: "2026-03",
    hasTarget,
    progress: {
      targetId: hasTarget ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" : null,
      userId: "22222222-2222-2222-2222-222222222222",
      userName: "Rahul",
      userEmail: "rahul@stimuliiq.test",
      roleKeys: ["marketing"],
      month: "2026-03",
      conversions: summariseTargetMetric(conversionsTarget, conversionsDone),
      revenuePaise: summariseTargetMetric(revenueTarget, revenueDone),
      note,
      setByName: hasTarget ? "Owner" : null,
      updatedAt: hasTarget ? "2026-03-01T00:00:00.000Z" : null,
    },
  };
}

function mockState(data: MyMarketingTargetDto | undefined, extra: Record<string, unknown> = {}) {
  useMyMarketingTargetMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarketingTargetCards", () => {
  it("shows target, completed and pending for each metric", () => {
    mockState(dto({}));
    render(<MarketingTargetCards />);

    expect(screen.getByTestId("marketing-target-conversions-target")).toHaveTextContent("40");
    expect(screen.getByTestId("marketing-target-conversions-completed")).toHaveTextContent("23");
    // 40 - 23. This is the number that changes what somebody does today.
    expect(screen.getByTestId("marketing-target-conversions-pending")).toHaveTextContent("17");
    expect(screen.getByTestId("marketing-target-revenue-target")).toBeInTheDocument();
  });

  it("names the month it is talking about", () => {
    mockState(dto({}));
    render(<MarketingTargetCards />);
    expect(screen.getByText(/March 2026/)).toBeInTheDocument();
  });

  it("HIDES a metric with no target instead of rendering a complete-looking 0/0", () => {
    mockState(dto({ revenueTarget: 0, revenueDone: 90_000_00 }));
    render(<MarketingTargetCards />);

    expect(screen.getByTestId("marketing-target-conversions")).toBeInTheDocument();
    expect(screen.queryByTestId("marketing-target-revenue")).not.toBeInTheDocument();
  });

  it("reads a beaten target as done, never as a negative backlog", () => {
    mockState(dto({ conversionsTarget: 40, conversionsDone: 55 }));
    render(<MarketingTargetCards />);

    const pending = screen.getByTestId("marketing-target-conversions-pending");
    expect(pending).toHaveTextContent("Done");
    expect(pending.textContent).not.toContain("-");
  });

  it("awards 'Target met' only when every MEASURED metric is met", () => {
    // Revenue-only target, smashed, zero conversions. The conversions card was never set,
    // so it must not block the verdict.
    mockState(dto({ conversionsTarget: 0, conversionsDone: 0, revenueTarget: 100_00, revenueDone: 250_00 }));
    render(<MarketingTargetCards />);
    expect(screen.getByTestId("marketing-target-verdict")).toHaveTextContent("Target met");
  });

  it("does NOT award 'Target met' when one measured metric is short", () => {
    mockState(dto({ conversionsTarget: 40, conversionsDone: 40, revenueTarget: 100_00, revenueDone: 10_00 }));
    render(<MarketingTargetCards />);
    expect(screen.getByTestId("marketing-target-verdict")).not.toHaveTextContent("Target met");
  });

  it("with NO target set, still shows what the person has closed", () => {
    // An empty card here would read as "you have done nothing" to someone who has been
    // working all month.
    mockState(
      dto({ hasTarget: false, conversionsTarget: 0, conversionsDone: 6, revenueTarget: 0, revenueDone: 90_000_00 }),
    );
    render(<MarketingTargetCards />);

    const empty = screen.getByTestId("marketing-target-none");
    expect(empty).toHaveTextContent("No target set for this month yet.");
    expect(empty).toHaveTextContent("6");
    expect(screen.queryByTestId("marketing-target-verdict")).not.toBeInTheDocument();
  });

  it("shows the admin's note when there is one", () => {
    mockState(dto({ note: "Pro-rated, joined on the 12th." }));
    render(<MarketingTargetCards />);
    expect(screen.getByTestId("marketing-target-note")).toHaveTextContent("Pro-rated, joined on the 12th.");
  });

  it("renders a busy skeleton while loading, not an empty card", () => {
    mockState(undefined, { isLoading: true });
    render(<MarketingTargetCards />);
    expect(screen.getByTestId("marketing-target-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("renders a retryable error state", () => {
    mockState(undefined, { isError: true });
    render(<MarketingTargetCards />);
    expect(screen.getByTestId("marketing-target-error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    mockState(dto({}));
    const { container } = render(<MarketingTargetCards />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe("formatTargetMonth", () => {
  it("renders a month key as a readable month and year", () => {
    expect(formatTargetMonth("2026-03")).toBe("March 2026");
    expect(formatTargetMonth("2026-12")).toBe("December 2026");
    // January must not roll back to the previous December through a timezone offset,
    // the helper pins UTC precisely so a browser west of UTC does not see "December 2025".
    expect(formatTargetMonth("2026-01")).toBe("January 2026");
  });
});
