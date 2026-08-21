import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "./input";

describe("Input", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(<Input label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Input label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    await user.type(input, "student@example.com");
    expect(input).toHaveValue("student@example.com");
  });

  it("marks the control invalid and links the error via aria-describedby", () => {
    render(<Input label="Email" name="email" error="Email is required" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Email is required");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("links helper text via aria-describedby when there is no error", () => {
    render(<Input label="Phone" name="phone" helperText="10-digit mobile number" />);
    const input = screen.getByLabelText("Phone");
    const helper = screen.getByText("10-digit mobile number");
    expect(input.getAttribute("aria-describedby")).toContain(helper.id);
  });
});

describe("Input, size variant", () => {
  // `md` is density-driven rather than a fixed height: it resolves to 40px under the
  // default comfortable density and 32px under `data-density="compact"` (the CRM shell),
  // so the assertion is on the token, not on a literal `h-10`. `sm` stays a fixed h-8.
  it("defaults to the density-driven md height when size is omitted, backward compatible", () => {
    render(<Input label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    expect(input.className).toContain("h-[var(--density-control-height)]");
    expect(input.className).not.toContain("h-8");
  });

  it("applies the sm (h-8) height classes when size='sm'", () => {
    render(<Input label="Link label" name="linkLabel" size="sm" />);
    const input = screen.getByLabelText("Link label");
    expect(input.className).toContain("h-8");
    expect(input.className).toContain("px-2.5");
    expect(input.className).not.toContain("h-[var(--density-control-height)]");
  });

  it("applies the density-driven md height classes when size='md' is passed explicitly", () => {
    render(<Input label="Email" name="email" size="md" />);
    const input = screen.getByLabelText("Email");
    expect(input.className).toContain("h-[var(--density-control-height)]");
    expect(input.className).toContain("px-3");
  });

  it("works without a visible label, using aria-label instead (compact row pattern)", async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Link URL" name="linkUrl" size="sm" />);
    const input = screen.getByLabelText("Link URL");
    expect(input.className).toContain("h-8");
    await user.type(input, "https://stimuliiq.com");
    expect(input).toHaveValue("https://stimuliiq.com");
  });
});
