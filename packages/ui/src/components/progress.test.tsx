import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProgressRing, ProgressBar } from "./progress";

// ---------------------------------------------------------------------------
// ProgressRing
// ---------------------------------------------------------------------------

describe("ProgressRing", () => {
  it("renders with role='progressbar'", () => {
    render(<ProgressRing value={50} label="Course completion" />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("sets aria-valuenow to the clamped value", () => {
    render(<ProgressRing value={72} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
  });

  it("clamps values above 100 to 100", () => {
    render(<ProgressRing value={150} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps negative values to 0", () => {
    render(<ProgressRing value={-10} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("sets aria-valuemin=0 and aria-valuemax=100", () => {
    render(<ProgressRing value={50} label="Progress" />);
    const el = screen.getByRole("progressbar");
    expect(el).toHaveAttribute("aria-valuemin", "0");
    expect(el).toHaveAttribute("aria-valuemax", "100");
  });

  it("uses the label prop as aria-label", () => {
    render(<ProgressRing value={50} label="Python completion" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "Python completion");
  });

  it("falls back to a generated aria-label when no label provided", () => {
    render(<ProgressRing value={42} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "42% complete");
  });

  it("renders the percentage label text by default (showLabel=true)", () => {
    render(<ProgressRing value={65} label="Progress" />);
    // The <text> element renders the percentage; it is inside the SVG
    const svgEl = screen.getByRole("progressbar");
    expect(svgEl.textContent).toContain("65%");
  });

  it("does not render percentage text when showLabel=false", () => {
    render(<ProgressRing value={65} label="Progress" showLabel={false} />);
    const svgEl = screen.getByRole("progressbar");
    expect(svgEl.textContent).not.toContain("65%");
  });

  it("exposes data-testid", () => {
    render(<ProgressRing value={50} label="P" data-testid="my-ring" />);
    expect(screen.getByTestId("my-ring")).toBeInTheDocument();
  });

  it("defaults data-testid to 'progress-ring'", () => {
    render(<ProgressRing value={50} label="P" />);
    expect(screen.getByTestId("progress-ring")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

describe("ProgressBar", () => {
  it("renders with role='progressbar'", () => {
    render(<ProgressBar value={40} label="Module progress" />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("sets aria-valuenow to the clamped value", () => {
    render(<ProgressBar value={80} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
  });

  it("clamps values above 100 to 100", () => {
    render(<ProgressBar value={200} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps negative values to 0", () => {
    render(<ProgressBar value={-5} label="Progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("sets aria-valuemin=0 and aria-valuemax=100", () => {
    render(<ProgressBar value={50} label="Progress" />);
    const el = screen.getByRole("progressbar");
    expect(el).toHaveAttribute("aria-valuemin", "0");
    expect(el).toHaveAttribute("aria-valuemax", "100");
  });

  it("uses the label prop as aria-label", () => {
    render(<ProgressBar value={50} label="Module 2 completion" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Module 2 completion",
    );
  });

  it("falls back to a generated aria-label when no label provided", () => {
    render(<ProgressBar value={33} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "33% complete");
  });

  it("shows a percentage label when showLabel=true", () => {
    render(<ProgressBar value={55} label="Progress" showLabel />);
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("does not show a text label by default (showLabel=false)", () => {
    render(<ProgressBar value={55} label="Progress" />);
    expect(screen.queryByText("55%")).not.toBeInTheDocument();
  });

  it("exposes data-testid", () => {
    render(<ProgressBar value={50} label="P" data-testid="my-bar" />);
    expect(screen.getByTestId("my-bar")).toBeInTheDocument();
  });

  it("defaults data-testid to 'progress-bar'", () => {
    render(<ProgressBar value={50} label="P" />);
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
  });
});
