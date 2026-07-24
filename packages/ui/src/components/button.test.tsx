import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";

describe("Button", () => {
  it("renders as a button with its label", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("is keyboard operable and fires onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Submit</Button>);

    const button = screen.getByRole("button", { name: "Submit" });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables and marks aria-busy while loading, blocking activation", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick} aria-label="Saving">
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("respects disabled state", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("supports asChild to render onto a custom element", () => {
    render(
      <Button asChild>
        <a href="/programs">Programs</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Programs" });
    expect(link).toHaveAttribute("href", "/programs");
  });
});
