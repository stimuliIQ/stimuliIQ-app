import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { DonutChart, PieChart } from "./donut-chart";

const data = [
  { key: "organic", label: "Organic", value: 60 },
  { key: "paid", label: "Paid ads", value: 40 },
];

describe("DonutChart", () => {
  it("defaults data-testid to 'donut-chart'", () => {
    render(<DonutChart title="Leads by source" data={data} />);
    expect(screen.getByTestId("donut-chart")).toBeInTheDocument();
  });

  it("has an accessible name via role=img", () => {
    render(<DonutChart title="Leads by source" description="Last 30 days" data={data} />);
    expect(screen.getByRole("img", { name: "Leads by source, Last 30 days" })).toBeInTheDocument();
  });

  it("renders a sr-only data table with segment, value, and share", () => {
    render(<DonutChart title="Leads by source" data={data} />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByText("Organic")).toBeInTheDocument();
    expect(within(table).getByText("Paid ads")).toBeInTheDocument();
    expect(within(table).getByText("60.0%")).toBeInTheDocument();
    expect(within(table).getByText("40.0%")).toBeInTheDocument();
  });

  it("renders a visible legend pairing each segment color with its label and share", () => {
    render(<DonutChart title="Leads by source" data={data} />);
    const legend = screen.getByTestId("chart-legend");
    expect(legend).toHaveTextContent("Organic");
    expect(legend).toHaveTextContent("60.0%");
  });

  it("shows the total and totalLabel in the (aria-hidden) center overlay", () => {
    const { container } = render(<DonutChart title="Leads by source" data={data} totalLabel="Total leads" />);
    expect(screen.getByText("Total leads")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    const overlay = container.querySelector("[aria-hidden='true']");
    expect(overlay).toBeInTheDocument();
  });

  it("renders EmptyState when data is empty", () => {
    render(<DonutChart title="Leads by source" data={[]} emptyMessage="No leads yet." />);
    expect(screen.getByText("No leads yet.")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(<DonutChart title="Leads by source" data={data} loading />);
    expect(screen.getByTestId("donut-chart")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with role=alert", () => {
    render(<DonutChart title="Leads by source" data={data} error="Failed to load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
  });
});

describe("PieChart", () => {
  it("defaults data-testid to 'pie-chart'", () => {
    render(<PieChart title="Payment status" data={data} />);
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
  });

  it("does not render a center total overlay (pie has no punched-out center)", () => {
    render(<PieChart title="Payment status" data={data} totalLabel="Total" />);
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });
});
