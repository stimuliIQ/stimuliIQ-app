// Repricing an order is the one commerce action with no approval step, and it changes what
// the company records as revenue. What is worth pinning is the guarding: the reason cannot be
// skipped, a price above list cannot be submitted, and the money conversion is exact.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@repo/ui";
import type { OrderSummary } from "@repo/types";

import { RepriceOrderDialog } from "./reprice-order-dialog";

const updateMutate = vi.fn();
vi.mock("../../hooks/use-orders", () => ({
  useUpdateOrderPrice: () => ({ mutate: updateMutate, isPending: false }),
}));

const ORDER: OrderSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  studentName: "Gandi Phanendra",
  programId: "33333333-3333-4333-8333-333333333333",
  programTitle: "Psychology Workshop",
  batchId: "44444444-4444-4444-8444-444444444444",
  batchName: "September Batch",
  amountPaise: 1499900,
  currency: "INR",
  discountPaise: 0,
  listPricePaise: 1499900,
  discountReason: null,
  status: "created",
  couponCode: null,
  invoiceId: null,
  invoiceNumber: null,
  createdAt: "2026-09-05T00:00:00.000Z",
};

function renderDialog(order: OrderSummary = ORDER) {
  return render(
    <ToastProvider>
      <RepriceOrderDialog order={order} open onOpenChange={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => updateMutate.mockReset());

describe("RepriceOrderDialog", () => {
  it("opens on the order's current amount, in rupees", () => {
    renderDialog();
    expect(screen.getByTestId("reprice-amount")).toHaveValue("14999.00");
  });

  // The reason is the only place the INTENT behind a discount is ever recorded — the audit
  // log captures the numbers moving and nothing else.
  it("will not save without a reason", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("reprice-amount"), { target: { value: "10000" } });

    expect(screen.getByTestId("reprice-save")).toBeDisabled();

    fireEvent.change(screen.getByTestId("reprice-reason"), { target: { value: "Agreed college rate" } });
    expect(screen.getByTestId("reprice-save")).toBeEnabled();
  });

  it("shows the discount the change would record", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("reprice-amount"), { target: { value: "10000" } });
    expect(screen.getByTestId("reprice-discount-preview")).toHaveTextContent("₹4,999.00");
  });

  // A price above list would make the discount negative and inflate gross in every report
  // that sums it. Blocked here as well as on the server.
  it("blocks a price above the list price", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("reprice-amount"), { target: { value: "20000" } });
    fireEvent.change(screen.getByTestId("reprice-reason"), { target: { value: "trying an upsell" } });

    expect(screen.getByTestId("reprice-above-list")).toBeInTheDocument();
    expect(screen.getByTestId("reprice-save")).toBeDisabled();
  });

  it("blocks a no-op, which would still notify and audit for no change", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("reprice-reason"), { target: { value: "no change at all" } });
    expect(screen.getByTestId("reprice-unchanged")).toBeInTheDocument();
    expect(screen.getByTestId("reprice-save")).toBeDisabled();
  });

  // Money crosses the wire as integer paise. A rounding slip here is invisible on screen and
  // permanent in the ledger.
  it("submits integer paise, not rupees", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByTestId("reprice-amount"), { target: { value: "9999.50" } });
    fireEvent.change(screen.getByTestId("reprice-reason"), { target: { value: "Scholarship award" } });
    await user.click(screen.getByTestId("reprice-save"));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      id: ORDER.id,
      body: { amountPaise: 999950, reason: "Scholarship award" },
    });
  });

  it("tells the person that super admins are notified and it is audited", () => {
    renderDialog();
    const notice = screen.getByTestId("reprice-notice");
    expect(notice).toHaveTextContent(/super admin/i);
    expect(notice).toHaveTextContent(/audit log/i);
  });

  // An already-discounted order measures further reductions from the ORIGINAL list price,
  // not from what it was last reduced to.
  it("measures against the original list price on an already-discounted order", () => {
    renderDialog({ ...ORDER, amountPaise: 1200000, discountPaise: 299900, listPricePaise: 1499900 });
    fireEvent.change(screen.getByTestId("reprice-amount"), { target: { value: "10000" } });
    expect(screen.getByTestId("reprice-discount-preview")).toHaveTextContent("₹4,999.00");
  });
});
