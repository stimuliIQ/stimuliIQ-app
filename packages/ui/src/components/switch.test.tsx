import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch } from "./switch";

describe("Switch", () => {
  it("renders with role=switch and aria-checked reflecting the checked prop", () => {
    render(<Switch checked={true} onCheckedChange={vi.fn()} aria-label="Enable feature" />);
    expect(screen.getByRole("switch", { name: "Enable feature" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onCheckedChange with the toggled value on click", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Enable feature" />);
    await user.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles via keyboard (Space) since it is a native <button>", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Enable feature" />);
    screen.getByRole("switch").focus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not call onCheckedChange when disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} disabled aria-label="Enable feature" />);
    await user.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
