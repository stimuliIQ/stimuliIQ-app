import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChartFrame, ChartLegend } from "./chart-frame";

describe("ChartFrame, accessible shell", () => {
  it("renders a figure with role=img and an accessible name from title", () => {
    render(
      <ChartFrame title="Revenue trend" table={<tbody><tr><td>1</td></tr></tbody>}>
        <div>chart</div>
      </ChartFrame>,
    );
    expect(screen.getByRole("img", { name: "Revenue trend" })).toBeInTheDocument();
  });

  it("folds description into the accessible name", () => {
    render(
      <ChartFrame
        title="Revenue trend"
        description="Last 30 days"
        table={<tbody><tr><td>1</td></tr></tbody>}
      >
        <div>chart</div>
      </ChartFrame>,
    );
    expect(screen.getByRole("img", { name: "Revenue trend, Last 30 days" })).toBeInTheDocument();
  });

  it("renders a visually-hidden data table fallback with the same data", () => {
    render(
      <ChartFrame
        title="Revenue trend"
        table={
          <tbody>
            <tr>
              <th scope="row">Jul 1</th>
              <td>1000</td>
            </tr>
          </tbody>
        }
      >
        <div>chart</div>
      </ChartFrame>,
    );
    const table = screen.getByRole("table", { name: "Revenue trend" });
    expect(table).toHaveClass("sr-only");
    expect(screen.getByText("Jul 1")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("renders a caption matching the accessible name", () => {
    render(
      <ChartFrame title="Revenue trend" table={<tbody><tr><td>1</td></tr></tbody>}>
        <div>chart</div>
      </ChartFrame>,
    );
    expect(screen.getByText("Revenue trend", { selector: "caption" })).toBeInTheDocument();
  });

  it("exposes data-testid, defaulting to 'chart-frame'", () => {
    render(
      <ChartFrame title="X" table={<tbody />}>
        <div />
      </ChartFrame>,
    );
    expect(screen.getByTestId("chart-frame")).toBeInTheDocument();
  });

  it("renders loading state with aria-busy", () => {
    render(
      <ChartFrame title="Revenue trend" loading table={<tbody />}>
        <div />
      </ChartFrame>,
    );
    expect(screen.getByTestId("chart-frame")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders error state with role=alert", () => {
    render(
      <ChartFrame title="Revenue trend" error="Failed to load." table={<tbody />}>
        <div />
      </ChartFrame>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
  });

  it("renders EmptyState when empty=true", () => {
    render(
      <ChartFrame title="Revenue trend" empty emptyMessage="No revenue yet." table={<tbody />}>
        <div />
      </ChartFrame>,
    );
    expect(screen.getByText("No revenue yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("ChartLegend", () => {
  it("renders one item per entry, pairing a color swatch with a visible label", () => {
    render(
      <ChartLegend
        items={[
          { key: "a", label: "Organic", color: "rgb(1,2,3)", value: "60%" },
          { key: "b", label: "Paid", color: "rgb(4,5,6)", value: "40%" },
        ]}
      />,
    );
    expect(screen.getByText("Organic")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("marks the color swatch as aria-hidden (decorative)", () => {
    const { container } = render(
      <ChartLegend items={[{ key: "a", label: "Organic", color: "rgb(1,2,3)" }]} />,
    );
    const swatch = container.querySelector("span[aria-hidden='true']");
    expect(swatch).toBeInTheDocument();
  });

  it("defaults data-testid to 'chart-legend'", () => {
    render(<ChartLegend items={[{ key: "a", label: "A", color: "red" }]} />);
    expect(screen.getByTestId("chart-legend")).toBeInTheDocument();
  });
});
