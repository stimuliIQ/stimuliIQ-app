import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusChip } from "./status-chip";

describe("StatusChip", () => {
  it("always renders a visible text label (never color-only)", () => {
    render(<StatusChip tone="success" label="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders icon-free by default (flat soft-badge look)", () => {
    const { container } = render(<StatusChip tone="danger" label="Revoked" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders an explicit icon when one is passed", () => {
    const { container } = render(
      <StatusChip tone="neutral" label="Lead" icon={<svg data-testid="custom-icon" aria-hidden="true" />} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
  });
});
