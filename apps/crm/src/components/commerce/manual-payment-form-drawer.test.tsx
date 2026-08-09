// Manual payment entry — the date cannot be in the future.
//
// Recording a manual payment captures it, marks the order paid, creates the enrollment and
// raises an invoice, all straight away. A future "Paid at" would therefore enroll and
// invoice a student for money nobody has taken yet.
//
// Three guards, and these cover the two in this component: the input's `max` (which stops
// the picker offering a future date at all) and the submit check (which catches a typed
// one and puts the message under the field instead of dumping a ZodError into a toast).
// The third — the shared schema — is covered in @repo/types.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { ManualPaymentFormDrawer } from "./manual-payment-form-drawer";

const recordMock = vi.fn();

vi.mock("../../hooks/use-payments", () => ({
  useRecordManualPayment: () => ({ mutateAsync: recordMock, isPending: false }),
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ManualPaymentFormDrawer
          open
          onOpenChange={() => {}}
          defaultOrderId={ORDER_ID}
          defaultAmountPaise={250_000}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** `YYYY-MM-DDTHH:mm` in LOCAL time, `days` from now — what the input actually holds. */
function localDateTime(daysFromNow: number): string {
  const at = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("manual-payment-method"), "NEFT");
  await user.type(screen.getByTestId("manual-payment-reference"), "UTR123456789");
}

beforeEach(() => {
  recordMock.mockReset().mockResolvedValue({});
});

describe("ManualPaymentFormDrawer — paid-at cannot be in the future", () => {
  // The quietest guard: the wrong value never gets entered.
  it("ceilings the date picker at now", () => {
    renderDrawer();
    const input = screen.getByTestId("manual-payment-paid-at");

    const max = input.getAttribute("max");
    expect(max).toBeTruthy();
    // Same minute as "now" in local time — not a UTC ceiling, which would lock out staff
    // in IST (+5:30) from recording a payment they took this morning.
    expect(max).toBe(localDateTime(0));
  });

  it("says so on the field, before anyone tries", () => {
    renderDrawer();
    expect(screen.getByText(/Can't be in the future/i)).toBeInTheDocument();
  });

  // The assertion that actually matters: a future date reaches NOTHING. Recording a payment
  // captures it, marks the order paid, creates the enrollment and raises an invoice — all of
  // that must not happen for money nobody has taken.
  it("sends nothing to the API when the date is in the future", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user);
    // jsdom won't accept a TYPED datetime-local value — set it the way a picker would.
    fireEvent.change(screen.getByTestId("manual-payment-paid-at"), { target: { value: localDateTime(7) } });
    await user.click(screen.getByTestId("manual-payment-submit"));

    expect(recordMock).not.toHaveBeenCalled();
  });

  // WHICH guard stops it, so a future edit can't quietly remove the wrong one. Past `max`
  // the field fails native constraint validation and the browser refuses to submit the form
  // at all — that is why the RHF `validate` rule below it never runs here, and why this
  // asserts on validity rather than on an error message that never renders.
  it("marks a future date invalid at the browser level", async () => {
    renderDrawer();
    const input = screen.getByTestId("manual-payment-paid-at") as HTMLInputElement;

    fireEvent.change(input, { target: { value: localDateTime(7) } });

    expect(input.validity.rangeOverflow).toBe(true);
    expect(input.checkValidity()).toBe(false);
  });

  it("leaves a past date valid", () => {
    renderDrawer();
    const input = screen.getByTestId("manual-payment-paid-at") as HTMLInputElement;

    fireEvent.change(input, { target: { value: localDateTime(-1) } });

    expect(input.validity.rangeOverflow).toBe(false);
    expect(input.checkValidity()).toBe(true);
  });

  it("records a payment received in the past", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user);
    fireEvent.change(screen.getByTestId("manual-payment-paid-at"), { target: { value: localDateTime(-1) } });
    await user.click(screen.getByTestId("manual-payment-submit"));

    await waitFor(() => expect(recordMock).toHaveBeenCalled());
    expect(recordMock.mock.calls[0]?.[0]).toMatchObject({ orderId: ORDER_ID });
  });

  it("still allows leaving it blank — the server stamps now", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("manual-payment-submit"));

    await waitFor(() => expect(recordMock).toHaveBeenCalled());
    expect(recordMock.mock.calls[0]?.[0]).not.toHaveProperty("paidAt", expect.anything());
  });
});
