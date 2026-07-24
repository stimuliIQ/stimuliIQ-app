import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeatureFlagRow } from "./feature-flag-row";

describe("FeatureFlagRow", () => {
  it("renders the label, key, and description", () => {
    render(
      <FeatureFlagRow
        name="flags.new_dashboard"
        label="New dashboard"
        description="Rolls out the redesigned overview dashboard."
        enabled={false}
        onEnabledChange={vi.fn()}
      />,
    );
    expect(screen.getByText("New dashboard")).toBeInTheDocument();
    expect(screen.getByText("flags.new_dashboard")).toBeInTheDocument();
    expect(screen.getByText("Rolls out the redesigned overview dashboard.")).toBeInTheDocument();
  });

  it("renders a switch labelled by the flag name", () => {
    render(<FeatureFlagRow name="flags.x" label="Flag X" enabled={true} onEnabledChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Flag X" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onEnabledChange when toggled", async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    render(<FeatureFlagRow name="flags.x" label="Flag X" enabled={false} onEnabledChange={onEnabledChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("renders an optional rollout badge", () => {
    render(
      <FeatureFlagRow
        name="flags.x"
        label="Flag X"
        enabled
        onEnabledChange={vi.fn()}
        rolloutBadge={<span>50% rollout</span>}
      />,
    );
    expect(screen.getByText("50% rollout")).toBeInTheDocument();
  });
});
