import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles via keyboard (space) and reports state", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox aria-label="Select row" onCheckedChange={onCheckedChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Select row" });
    checkbox.focus();
    await user.keyboard("{ }");

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("supports an indeterminate state for select-all headers", () => {
    render(<Checkbox aria-label="Select all" checked="indeterminate" />);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "data-state",
      "indeterminate",
    );
  });
});
