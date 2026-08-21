import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MoneyInput, formatPaise } from "./money-input";

// ---------------------------------------------------------------------------
// formatPaise helper
// ---------------------------------------------------------------------------

describe("formatPaise", () => {
  it("formats zero paise as ₹0.00", () => {
    // Intl may format as "₹0.00" or "₹ 0.00" (narrow no-break space), normalise
    expect(formatPaise(0).replace(/\s/g, "")).toContain("0.00");
  });

  it("formats 100 paise as ₹1.00", () => {
    expect(formatPaise(100).replace(/\s/g, "")).toContain("1.00");
  });

  it("formats 249900 paise as ₹2,499.00", () => {
    const result = formatPaise(249900).replace(/\s/g, "");
    expect(result).toMatch(/2[,.]?499\.00/);
  });

  it("formats 1 paise as ₹0.01 (smallest unit)", () => {
    expect(formatPaise(1).replace(/\s/g, "")).toContain("0.01");
  });
});

// ---------------------------------------------------------------------------
// MoneyInput component
// ---------------------------------------------------------------------------

describe("MoneyInput", () => {
  it("renders the label and associates it with the input", () => {
    render(<MoneyInput label="Course fee" value={0} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Course fee")).toBeInTheDocument();
  });

  it("displays the value in rupees (paise ÷ 100)", () => {
    render(<MoneyInput label="Fee" value={249900} onChange={vi.fn()} />);
    const input = screen.getByLabelText("Fee");
    expect(input).toHaveValue("2499.00");
  });

  it("displays 0 paise as empty-ish or 0.00", () => {
    render(<MoneyInput label="Fee" value={0} onChange={vi.fn()} />);
    const input = screen.getByLabelText("Fee");
    // 0 paise → "0.00" rupee display
    expect(input).toHaveValue("0.00");
  });

  it("calls onChange with integer paise when user types a rupee amount", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyInput label="Fee" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Fee");

    await user.clear(input);
    await user.type(input, "25");

    // "25" rupees → 2500 paise
    expect(onChange).toHaveBeenCalledWith(2500);
  });

  it("converts rupee input with paise to exact integer paise (no float drift)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyInput label="Fee" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Fee");

    await user.clear(input);
    // Type 1.07, the classic float precision edge case (1.07 * 100 = 106.99999…)
    await user.type(input, "1.07");

    // Should call with exactly 107 (integer), not 106.999... or 107.00000001
    const lastCall = onChange.mock.calls.at(-1);
    if (!lastCall) throw new Error("onChange was never called");
    expect(lastCall[0]).toBe(107);
    expect(Number.isInteger(lastCall[0])).toBe(true);
  });

  it("does not allow more than 2 decimal places", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyInput label="Fee" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Fee");

    await user.clear(input);
    await user.type(input, "1.234");

    // "1.23" is the max allowed, the "4" should be rejected
    expect((input as HTMLInputElement).value).toBe("1.23");
  });

  it("shows an error message and marks the field aria-invalid", () => {
    render(
      <MoneyInput
        label="Fee"
        value={0}
        onChange={vi.fn()}
        error="Amount must be greater than zero"
      />,
    );
    const input = screen.getByLabelText("Fee");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Amount must be greater than zero");
  });

  it("renders a currency prefix symbol", () => {
    render(<MoneyInput label="Fee" value={0} onChange={vi.fn()} />);
    // The ₹ prefix is in an aria-hidden span
    expect(screen.getByText("₹")).toBeInTheDocument();
  });

  it("normalises display to 2 decimal places on blur", async () => {
    const user = userEvent.setup();
    render(<MoneyInput label="Fee" value={0} onChange={vi.fn()} />);
    const input = screen.getByLabelText("Fee");

    await user.clear(input);
    await user.type(input, "5");
    await user.tab(); // blur

    // After blur, "5" should become "5.00"
    expect(input).toHaveValue("5.00");
  });
});
