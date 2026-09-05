// Sell a programme below its list price.
//
// WHAT THIS RECORDS, AND WHY IT MATTERS. The order keeps BOTH numbers: what is charged and
// how far below list that is. So a discounted sale stays distinguishable from a cheap
// programme, and revenue reads as gross / discount / net. If this just overwrote the amount,
// no report could ever recover the difference — which is the opposite of the reason it exists.
//
// The reason box is mandatory and the form says why: the audit log already records the
// numbers moving, and cannot record intent. "Agreed college rate" is not derivable from
// 1499900 becoming 1000000.
import * as React from "react";
import { Alert, Button, Input, Modal, Textarea, useToast } from "@repo/ui";
import type { OrderSummary } from "@repo/types";

import { useUpdateOrderPrice } from "../../hooks/use-orders";
import { surfaceError } from "../../lib/surface-error";

interface RepriceOrderDialogProps {
  order: OrderSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "14999.00" — rupees, for an input a human types into. Paise stay integers on the wire. */
function paiseToRupeeInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

/**
 * Rupees typed by a human → integer paise.
 *
 * `Math.round` and not truncation: 100.005 entered by a fat finger should not silently become
 * ₹100.00 and lose half a paisa off the recorded price. Returns null for anything unparseable
 * so the caller can refuse rather than send NaN.
 */
function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export function RepriceOrderDialog({ order, open, onOpenChange }: RepriceOrderDialogProps): React.JSX.Element {
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const mutation = useUpdateOrderPrice();
  const { toast } = useToast();

  // Re-seed whenever a different order is opened, so the box never shows the last one's
  // price. Depending on `order` itself is what the lint rule wants and is also more correct:
  // the object identity changes exactly when a new order is selected or the list refetches
  // after a save, which is precisely when the form should be reset.
  React.useEffect(() => {
    if (order) {
      setAmount(paiseToRupeeInput(order.amountPaise));
      setReason("");
    }
  }, [order]);

  const listPricePaise = order ? order.listPricePaise : 0;
  const parsedPaise = rupeesToPaise(amount);
  const aboveList = parsedPaise !== null && parsedPaise > listPricePaise;
  const unchanged = parsedPaise !== null && order !== null && parsedPaise === order.amountPaise;
  const canSubmit =
    parsedPaise !== null && !aboveList && !unchanged && reason.trim().length >= 5 && !mutation.isPending;

  function handleSubmit() {
    if (!order || parsedPaise === null) return;
    mutation.mutate(
      { id: order.id, body: { amountPaise: parsedPaise, reason: reason.trim() } },
      {
        onSuccess: () => {
          toast({ title: "Order repriced", variant: "success" });
          onOpenChange(false);
        },
        onError: (err) => surfaceError(toast, err, "Couldn't reprice this order"),
      },
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Change the amount"
      description={order ? `${order.programTitle} — ${order.studentName}` : ""}
      data-testid="reprice-order-dialog"
    >
      <div className="space-y-4">
        <Input
          label="Amount (₹)"
          helperText={`List price ${formatPaise(listPricePaise)}. The difference is recorded as a discount.`}
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          data-testid="reprice-amount"
        />

        {parsedPaise !== null && parsedPaise < listPricePaise ? (
          <p className="text-sm text-fg-muted" data-testid="reprice-discount-preview">
            Discount of <strong>{formatPaise(listPricePaise - parsedPaise)}</strong> off {formatPaise(listPricePaise)}.
          </p>
        ) : null}

        {/* Caught here as well as on the server: a price above list would make the discount
            negative and inflate gross in every report that sums it. */}
        {aboveList ? (
          <Alert tone="danger" data-testid="reprice-above-list">
            The amount can only go below the list price of {formatPaise(listPricePaise)}. Charging more is a separate
            order, not a discount.
          </Alert>
        ) : null}

        {unchanged ? (
          <Alert tone="info" data-testid="reprice-unchanged">
            That is already the amount, so there is nothing to change.
          </Alert>
        ) : null}

        <Textarea
          label="Reason"
          helperText="Required. The audit log records who changed the amount and from what — this is the only place it records why."
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reprice-reason"
        />

        <Alert tone="info" data-testid="reprice-notice">
          Every super admin is notified when an order is repriced, and the change is written to the audit log. The
          amount can only be changed before any payment is recorded.
        </Alert>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} data-testid="reprice-cancel">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={mutation.isPending} data-testid="reprice-save">
            Save amount
          </Button>
        </div>
      </div>
    </Modal>
  );
}
