import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { FunnelChart } from "./funnel-chart";

const stages = [
  { key: "leads", label: "Leads", value: 1000 },
  { key: "qualified", label: "Qualified", value: 400 },
  { key: "enrolled", label: "Enrolled", value: 100 },
];

describe("FunnelChart", () => {
  it("defaults data-testid to 'funnel-chart'", () => {
    render(<FunnelChart title="Lead funnel" stages={stages} />);
    expect(screen.getByTestId("funnel-chart")).toBeInTheDocument();
  });

  it("has an accessible name via role=img", () => {
    render(<FunnelChart title="Lead funnel" description="Last 30 days" stages={stages} />);
    expect(screen.getByRole("img", { name: "Lead funnel, Last 30 days" })).toBeInTheDocument();
  });

  it("renders a sr-only data table with stage, count, and both conversion percentages", () => {
    render(<FunnelChart title="Lead funnel" stages={stages} />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByText("% of first stage")).toBeInTheDocument();
    expect(within(table).getByText("% of previous stage")).toBeInTheDocument();
    // Enrolled: 100/1000 = 10.0% of first stage; 100/400 = 25.0% of previous stage
    expect(within(table).getByText("10.0%")).toBeInTheDocument();
    expect(within(table).getByText("25.0%")).toBeInTheDocument();
  });

  it("renders a visible stage list pairing color + label + conversion percentages", () => {
    render(<FunnelChart title="Lead funnel" stages={stages} />);
    const legend = screen.getByTestId("chart-legend");
    expect(legend).toHaveTextContent("Leads");
    expect(legend).toHaveTextContent("Qualified");
    expect(legend).toHaveTextContent("Enrolled");
    expect(legend).toHaveTextContent("40.0%");
  });

  it("renders EmptyState when there are no stages", () => {
    render(<FunnelChart title="Lead funnel" stages={[]} emptyMessage="No leads yet." />);
    expect(screen.getByText("No leads yet.")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(<FunnelChart title="Lead funnel" stages={stages} loading />);
    expect(screen.getByTestId("funnel-chart")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error state with role=alert", () => {
    render(<FunnelChart title="Lead funnel" stages={stages} error="Failed to load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
  });
});
