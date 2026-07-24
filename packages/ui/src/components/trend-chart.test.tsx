import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AreaChart, LineChart } from "./trend-chart";

const data = [
  { date: "Jul 1", revenue: 1000, refunds: 50 },
  { date: "Jul 2", revenue: 1200, refunds: 20 },
];

const series = [
  { key: "revenue", label: "Revenue" },
  { key: "refunds", label: "Refunds" },
];

describe("LineChart", () => {
  it("defaults data-testid to 'line-chart'", () => {
    render(<LineChart title="Revenue trend" data={data} xKey="date" series={series} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("has an accessible name via role=img", () => {
    render(<LineChart title="Revenue trend" description="Last 2 days" data={data} xKey="date" series={series} />);
    expect(screen.getByRole("img", { name: "Revenue trend — Last 2 days" })).toBeInTheDocument();
  });

  it("renders a sr-only data table with every row and series", () => {
    render(<LineChart title="Revenue trend" data={data} xKey="date" series={series} />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
    expect(screen.getByText("Jul 1")).toBeInTheDocument();
    expect(screen.getByText("Jul 2")).toBeInTheDocument();
    expect(screen.getAllByText("1000")).not.toHaveLength(0);
    expect(screen.getAllByText("50")).not.toHaveLength(0);
  });

  it("renders a visible legend pairing each series color with its label", () => {
    render(<LineChart title="Revenue trend" data={data} xKey="date" series={series} />);
    const legend = screen.getByTestId("chart-legend");
    expect(legend).toHaveTextContent("Revenue");
    expect(legend).toHaveTextContent("Refunds");
  });

  it("applies valueFormatter to table values", () => {
    render(
      <LineChart
        title="Revenue trend"
        data={data}
        xKey="date"
        series={[{ key: "revenue", label: "Revenue" }]}
        valueFormatter={(v) => `₹${v}`}
      />,
    );
    expect(screen.getByText("₹1000")).toBeInTheDocument();
  });

  it("renders EmptyState when data is empty", () => {
    render(<LineChart title="Revenue trend" data={[]} xKey="date" series={series} emptyMessage="No revenue yet." />);
    expect(screen.getByText("No revenue yet.")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(<LineChart title="Revenue trend" data={data} xKey="date" series={series} loading />);
    expect(screen.getByTestId("line-chart")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with role=alert", () => {
    render(<LineChart title="Revenue trend" data={data} xKey="date" series={series} error="Failed to load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
  });
});

describe("AreaChart", () => {
  it("defaults data-testid to 'area-chart'", () => {
    render(<AreaChart title="Enrollments" data={data} xKey="date" series={series} />);
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });

  it("has an accessible name via role=img", () => {
    render(<AreaChart title="Enrollments" data={data} xKey="date" series={series} />);
    expect(screen.getByRole("img", { name: "Enrollments" })).toBeInTheDocument();
  });
});
