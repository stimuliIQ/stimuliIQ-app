// Payment detail drawer — read-only record view: provider/order/student
// context, signature-verified chip, amount, method, manual flag, plus a
// receipt PDF download (T27/T40).
import * as React from "react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, formatPaise, Skeleton, StatusChip } from "@repo/ui";
import { Download } from "lucide-react";

import { usePayment, usePaymentReceipt } from "../../hooks/use-payments";
import { PaymentStatusChip } from "./payment-status-chip";

interface PaymentDetailDrawerProps {
  paymentId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PaymentDetailDrawer({ paymentId, onOpenChange }: PaymentDetailDrawerProps): React.JSX.Element {
  const open = Boolean(paymentId);
  const { data: payment, isLoading, isError, refetch } = usePayment(paymentId ?? undefined);
  const [receiptRequested, setReceiptRequested] = React.useState(false);
  const { data: receipt, isFetching: receiptFetching } = usePaymentReceipt(paymentId ?? undefined, receiptRequested);

  React.useEffect(() => {
    setReceiptRequested(false);
  }, [paymentId]);

  React.useEffect(() => {
    if (receipt?.ready && receipt.url) {
      window.open(receipt.url, "_blank", "noopener,noreferrer");
      setReceiptRequested(false);
    }
  }, [receipt]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={payment ? `Payment · ${payment.studentName}` : "Payment"}
        description={payment?.programTitle}
        size="lg"
        data-testid="payment-detail-drawer"
      >
        <DrawerBody>
          {isLoading ? (
            <div className="flex flex-col gap-3" data-testid="payment-detail-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <EmptyState
              data-testid="payment-detail-error"
              title="Couldn't load this payment"
              description="Something went wrong fetching the payment details."
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="payment-detail-retry">
                  Try again
                </Button>
              }
            />
          ) : !payment ? (
            <EmptyState data-testid="payment-detail-empty" title="No data" description="This payment has no details to show." />
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-fg-muted">Status</dt>
                <dd className="mt-1">
                  <PaymentStatusChip status={payment.status} />
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Signature verified</dt>
                <dd className="mt-1">
                  {payment.signatureVerified ? (
                    <StatusChip tone="success" label="Verified" size="sm" />
                  ) : (
                    <StatusChip tone="neutral" label="Not verified (manual)" size="sm" />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Amount</dt>
                <dd className="mt-1 text-fg" data-testid="payment-amount">
                  {formatPaise(payment.amountPaise)}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Method</dt>
                <dd className="mt-1 text-fg">{payment.method ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Provider</dt>
                <dd className="mt-1 text-fg">{payment.provider}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Manual entry</dt>
                <dd className="mt-1 text-fg">{payment.isManual ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Provider payment id</dt>
                <dd className="mt-1 text-fg">{payment.providerPaymentId ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Provider order id</dt>
                <dd className="mt-1 text-fg">{payment.providerOrderId ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Order</dt>
                <dd className="mt-1 text-fg">{payment.orderId}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Student</dt>
                <dd className="mt-1 text-fg">{payment.studentName}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Program</dt>
                <dd className="mt-1 text-fg">{payment.programTitle}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Paid at</dt>
                <dd className="mt-1 text-fg">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "-"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Created</dt>
                <dd className="mt-1 text-fg">{new Date(payment.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Last updated</dt>
                <dd className="mt-1 text-fg">{new Date(payment.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </DrawerBody>
        {payment && payment.status === "captured" ? (
          <DrawerFooter>
            <Button
              variant="secondary"
              onClick={() => setReceiptRequested(true)}
              loading={receiptRequested && (receiptFetching || receipt?.ready === false)}
              data-testid="payment-receipt-download-button"
            >
              <Download className="size-4" aria-hidden="true" />
              Download receipt
            </Button>
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
