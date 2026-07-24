import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BarChart } from "./bar-chart";

const data = [
  { source: "Organic", count: 120 },
  { source: "Paid", count: 80 },
];

describe("BarChart", () => {
  it("defaults data-testid to 'bar-chart'", () => {
    render(<BarChart title="Leads by source" data={data} categoryKey="source" series={[{ key: "count", label: "Leads" }]} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("has an accessible name via role=img", () => {
    render(
      <BarChart
        title="Leads by source"
        description="Last 30 days"
        data={data}
        categoryKey="source"
        series={[{ key: "count", label: "Leads" }]}
      />,
    );
    expect(screen.getByRole("img", { name: "Leads by source — Last 30 days" })).toBeInTheDocument();
  });

  it("renders a sr-only data table with categories and values", () => {
    render(<BarChart title="Leads by source" data={data} categoryKey="source" categoryLabel="Source" series={[{ key: "count", label: "Leads" }]} />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
    expect(screen.getByText("Organic")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
  });

  it("renders a visible legend pairing each series color with its label", () => {
    render(
      <BarChart
        title="Attendance"
        data={[{ batch: "B1", present: 20, absent: 3 }]}
        categoryKey="batch"
        series={[
          { key: "present", label: "Present" },
          { key: "absent", label: "Absent" },
        ]}
        stacked
        orientation="horizontal"
      />,
    );
    const legend = screen.getByTestId("chart-legend");
    expect(legend).toHaveTextContent("Present");
    expect(legend).toHaveTextContent("Absent");
  });

  it("renders EmptyState when data is empty", () => {
    render(<BarChart title="Leads by source" data={[]} categoryKey="source" series={[{ key: "count", label: "Leads" }]} emptyMessage="No leads yet." />);
    expect(screen.getByText("No leads yet.")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(<BarChart title="Leads by source" data={data} categoryKey="source" series={[{ key: "count", label: "Leads" }]} loading />);
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with role=alert", () => {
    render(<BarChart title="Leads by source" data={data} categoryKey="source" series={[{ key: "count", label: "Leads" }]} error="Failed to load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
  });
});
