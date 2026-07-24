import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("renders a masked password field by default", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("reveals and re-masks the value when the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps the toggle out of the tab order", () => {
    render(<PasswordInput aria-label="Password" />);
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("tabindex", "-1");
  });

  it("forwards props and typed input to the underlying control", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" placeholder="Enter your password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("placeholder", "Enter your password");
    await user.type(input, "secret123");
    expect(input).toHaveValue("secret123");
  });
});
