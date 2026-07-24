import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Select, SelectItem } from "./select";

describe("Select", () => {
  it("associates the label with the trigger", () => {
    render(
      <Select label="Status" placeholder="All statuses">
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="lead">Lead</SelectItem>
      </Select>,
    );
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("opens and selects an option via the onValueChange callback", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select label="Status" placeholder="All statuses" onValueChange={onValueChange}>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="lead">Lead</SelectItem>
      </Select>,
    );

    await user.click(screen.getByLabelText("Status"));
    const option = await screen.findByRole("option", { name: "Active" });
    await user.click(option);

    expect(onValueChange).toHaveBeenCalledWith("active");
  });

  it("marks the trigger invalid and links the error message", () => {
    render(
      <Select label="Branch" error="Branch is required">
        <SelectItem value="b1">Branch 1</SelectItem>
      </Select>,
    );
    const trigger = screen.getByLabelText("Branch");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Branch is required");
  });
});
