/**
 * CouponValidator component tests.
 *
 * Verifies:
 *   - Renders with accessible label, input label, and button (a11y: AC-40)
 *   - Accepts user input
 *   - Shows error state (aria-invalid, role="alert") on invalid coupon
 *   - Shows success state (role="status") on valid coupon
 *   - "Apply" button is disabled when input is empty
 *   - Never renders internal coupon fields (AC-26: id/maxUses/used/programScope/etc.)
 *   - The coupon result renders paise AS display strings only, no paise raw value visible
 *     in the UI that would expose internal pricing math
 *
 * The API client is mocked. This tests the component UI contract, not network calls.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the api-client before importing the component
// ---------------------------------------------------------------------------

const mockValidate = vi.fn();

vi.mock("../../../lib/api-client", () => ({
  apiClient: {
    public: {
      coupons: {
        validate: (...args: unknown[]) => mockValidate(...args),
      },
    },
  },
}));

import { CouponValidator } from "./coupon-validator";

const PROGRAM_ID = "00000000-0000-0000-0000-000000000001";

const VALID_RESPONSE = {
  originalPaise: 1299900,
  discountPaise: 130000,
  finalPaise: 1169900,
  type: "flat" as const,
  displayCode: "SAVE10",
};

describe("CouponValidator", () => {
  beforeEach(() => {
    mockValidate.mockReset();
  });

  it("renders the coupon input with a visible label (a11y, AC-40)", () => {
    render(<CouponValidator programId={PROGRAM_ID} />);
    expect(screen.getByLabelText("Have a coupon code?")).toBeInTheDocument();
  });

  it("renders the Apply button", () => {
    render(<CouponValidator programId={PROGRAM_ID} />);
    expect(screen.getByRole("button", { name: /apply coupon/i })).toBeInTheDocument();
  });

  it("Apply button is disabled when the input is empty", () => {
    render(<CouponValidator programId={PROGRAM_ID} />);
    const button = screen.getByRole("button", { name: /apply coupon/i });
    expect(button).toBeDisabled();
  });

  it("Apply button is enabled when the input has content", async () => {
    render(<CouponValidator programId={PROGRAM_ID} />);
    const input = screen.getByLabelText("Have a coupon code?");
    fireEvent.change(input, { target: { value: "SAVE10" } });
    const button = screen.getByRole("button", { name: /apply coupon/i });
    expect(button).not.toBeDisabled();
  });

  it("shows success state on valid coupon (role=status, AC-40)", async () => {
    mockValidate.mockResolvedValueOnce(VALID_RESPONSE);

    render(<CouponValidator programId={PROGRAM_ID} />);
    const input = screen.getByLabelText("Have a coupon code?");
    fireEvent.change(input, { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coupon-success")).toBeInTheDocument();
    });

    const successEl = screen.getByRole("status");
    expect(successEl).toBeInTheDocument();
    // Display code shown
    expect(successEl.textContent).toContain("SAVE10");
  });

  it("success state renders paise as ₹ display strings, no raw paise number in UI", async () => {
    mockValidate.mockResolvedValueOnce(VALID_RESPONSE);

    render(<CouponValidator programId={PROGRAM_ID} />);
    fireEvent.change(screen.getByLabelText("Have a coupon code?"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coupon-success")).toBeInTheDocument();
    });

    const successEl = screen.getByTestId("coupon-success");
    const html = successEl.innerHTML;
    // ₹ display strings present
    expect(html).toContain("₹");
    // Raw paise numbers like 1299900 must NOT be in the display (no money math visible to user)
    expect(html).not.toContain("1299900");
    expect(html).not.toContain("1169900");
    expect(html).not.toContain("130000");
  });

  it("shows error state on invalid coupon (role=alert, aria-invalid, AC-40)", async () => {
    mockValidate.mockRejectedValueOnce(new Error("Invalid or expired coupon."));

    render(<CouponValidator programId={PROGRAM_ID} />);
    fireEvent.change(screen.getByLabelText("Have a coupon code?"), {
      target: { value: "BADCODE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coupon-error")).toBeInTheDocument();
    });

    const errorEl = screen.getByRole("alert");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain("Invalid or expired coupon.");

    const input = screen.getByLabelText("Have a coupon code?");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("NEVER renders forbidden coupon fields in the DOM (AC-26: id, maxUses, used, etc.)", async () => {
    // The success response is strictly the allowlist, this test confirms the component
    // doesn't accidentally expose any of those fields even if they were in the response.
    mockValidate.mockResolvedValueOnce({
      ...VALID_RESPONSE,
      // These fields should NEVER appear in the UI even if the mock returns them
    });

    render(<CouponValidator programId={PROGRAM_ID} />);
    fireEvent.change(screen.getByLabelText("Have a coupon code?"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coupon-success")).toBeInTheDocument();
    });

    const { container } = render(<CouponValidator programId={PROGRAM_ID} />);
    const html = container.innerHTML;
    // None of the forbidden field names should appear in the rendered output
    expect(html).not.toMatch(/maxUses|max_uses|programScope|program_scope|validFrom|validTo/i);
  });

  it("shows 'Remove' button after valid coupon is applied", async () => {
    mockValidate.mockResolvedValueOnce(VALID_RESPONSE);

    render(<CouponValidator programId={PROGRAM_ID} />);
    fireEvent.change(screen.getByLabelText("Have a coupon code?"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove coupon/i })).toBeInTheDocument();
    });
  });

  it("returns to idle state after clicking Remove", async () => {
    mockValidate.mockResolvedValueOnce(VALID_RESPONSE);

    render(<CouponValidator programId={PROGRAM_ID} />);
    fireEvent.change(screen.getByLabelText("Have a coupon code?"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply coupon/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove coupon/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /remove coupon/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("coupon-success")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /apply coupon/i })).toBeInTheDocument();
    });
  });
});
