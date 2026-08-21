import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { KpiCard } from "./kpi-card";

describe("KpiCard, rendering", () => {
  it("renders with default data-testid='kpi-card'", () => {
    render(<KpiCard label="Revenue (MTD)" value="₹48,200.00" />);
    expect(screen.getByTestId("kpi-card")).toBeInTheDocument();
  });

  it("renders the pre-formatted value verbatim (no arithmetic)", () => {
    render(<KpiCard label="Revenue (MTD)" value="₹48,200.00" />);
    expect(screen.getByText("₹48,200.00")).toBeInTheDocument();
  });

  it("renders a numeric value verbatim when passed a number", () => {
    render(<KpiCard label="Active students" value={1284} />);
    expect(screen.getByText("1284")).toBeInTheDocument();
  });

  it("renders the delta text when provided", () => {
    render(<KpiCard label="Revenue (MTD)" value="₹48,200.00" delta="+12.4%" trendDirection="up" />);
    expect(screen.getByText("+12.4%")).toBeInTheDocument();
  });
});

describe("KpiCard, a11y", () => {
  it("has an accessible group name combining label, value, and trend direction+delta", () => {
    render(
      <KpiCard label="Revenue (MTD)" value="₹48,200.00" delta="+12.4%" trendDirection="up" />,
    );
    expect(
      screen.getByRole("group", { name: "Revenue (MTD): ₹48,200.00, up +12.4%" }),
    ).toBeInTheDocument();
  });

  it("omits the trend clause from the accessible name when there is no delta", () => {
    render(<KpiCard label="Active students" value="1,284" />);
    expect(screen.getByRole("group", { name: "Active students: 1,284" })).toBeInTheDocument();
  });

  it("never conveys trend by color alone, an icon + text delta are both present", () => {
    const { container } = render(
      <KpiCard label="Refund rate" value="1.2%" delta="-0.4pp" trendDirection="down" trendTone="success" />,
    );
    expect(screen.getByText("-0.4pp")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(<KpiCard label="Revenue (MTD)" value="—" loading />);
    expect(screen.getByTestId("kpi-card")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with role=alert", () => {
    render(<KpiCard label="Revenue (MTD)" value="—" error="Failed to load metric." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load metric.");
  });
});

describe("KpiCard, sparkline", () => {
  it("renders a decorative (aria-hidden) sparkline container when 2+ points are given", () => {
    render(
      <KpiCard
        label="Revenue (MTD)"
        value="₹48,200.00"
        sparkline={[{ value: 10 }, { value: 14 }, { value: 12 }]}
      />,
    );
    const { container } = render(
      <KpiCard
        label="Revenue (MTD)"
        value="₹48,200.00"
        sparkline={[{ value: 10 }, { value: 14 }, { value: 12 }]}
      />,
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
  });

  it("does not render a sparkline container with fewer than 2 points", () => {
    const { container } = render(
      <KpiCard label="Revenue (MTD)" value="₹48,200.00" sparkline={[{ value: 10 }]} />,
    );
    expect(container.querySelector(".recharts-responsive-container")).not.toBeInTheDocument();
  });
});
