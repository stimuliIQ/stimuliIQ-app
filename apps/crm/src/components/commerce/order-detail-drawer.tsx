// Order detail drawer — shows the full order: student/program/batch, amount/
// discount/coupon, status, linked enrollment + invoice, and the payment
// records against it (docs/03 §7.6). Read-only — orders are not edited
// directly from the CRM in P2 (created via checkout/admissions or the
// manual-payment path which creates a payment, not the order).
import * as React from "react";
import {
  Button,
  DataTable,
  type DataTableColumn,
  Drawer,
  DrawerContent,
  DrawerBody,
  EmptyState,
  formatPaise,
  Skeleton,
} from "@repo/ui";
import type { PaymentSummary } from "@repo/types";

import { useOrder } from "../../hooks/use-orders";
import { usePaymentsList } from "../../hooks/use-payments";
import { OrderStatusChip } from "./order-status-chip";
import { PaymentStatusChip } from "./payment-status-chip";
import { queryErrorMessage } from "../../lib/surface-error";

interface OrderDetailDrawerProps {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function OrderDetailDrawer({ orderId, onOpenChange }: OrderDetailDrawerProps): React.JSX.Element {
  const open = Boolean(orderId);
  const { data: order, isLoading, isError, error, refetch } = useOrder(orderId ?? undefined);
  const {
    data: paymentsData,
    isLoading: paymentsLoading,
    isError: paymentsError,
    error: paymentsFetchError,
    refetch: refetchPayments,
  } =
    usePaymentsList({ orderId: orderId ?? undefined, page: 1, pageSize: 20 });

  const paymentColumns: Array<DataTableColumn<PaymentSummary>> = [
    { id: "provider", header: "Provider", cell: (row) => row.provider },
    {
      id: "providerPaymentId",
      header: "Provider payment id",
      cell: (row) => row.providerPaymentId ?? "-",
    },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "status", header: "Status", cell: (row) => <PaymentStatusChip status={row.status} /> },
    { id: "method", header: "Method", cell: (row) => row.method ?? "-" },
    { id: "isManual", header: "Manual", cell: (row) => (row.isManual ? "Yes" : "No") },
    {
      id: "paidAt",
      header: "Paid at",
      cell: (row) => (row.paidAt ? new Date(row.paidAt).toLocaleString() : "-"),
      align: "right",
    },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={order ? `Order · ${order.studentName}` : "Order"}
        description={order?.programTitle}
        size="xl"
        data-testid="order-detail-drawer"
      >
        <DrawerBody>
          {isLoading ? (
            <div className="flex flex-col gap-3" data-testid="order-detail-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <EmptyState
              data-testid="order-detail-error"
              title="Couldn't load this order"
              description={queryErrorMessage(error, "Something went wrong fetching the order details.")}
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="order-detail-retry">
                  Try again
                </Button>
              }
            />
          ) : !order ? (
            <EmptyState data-testid="order-detail-empty" title="No data" description="This order has no details to show." />
          ) : (
            <div className="flex flex-col gap-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <OrderStatusChip status={order.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Batch</dt>
                  <dd className="mt-1 text-fg">{order.batchName}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Amount charged</dt>
                  <dd className="mt-1 text-fg" data-testid="order-amount">
                    {formatPaise(order.amountPaise)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Discount</dt>
                  <dd className="mt-1 text-fg">
                    {order.discountPaise > 0 ? formatPaise(order.discountPaise) : "None"}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Coupon</dt>
                  <dd className="mt-1 text-fg">{order.couponCode ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Currency</dt>
                  <dd className="mt-1 text-fg">{order.currency}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Enrollment</dt>
                  <dd className="mt-1 text-fg">
                    {order.enrollmentId
                      ? `Linked (${order.enrollmentSource ?? "order"})`
                      : "Not yet enrolled"}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Invoice</dt>
                  <dd className="mt-1 text-fg">{order.invoiceNumber ?? "Not yet generated"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Created</dt>
                  <dd className="mt-1 text-fg">{new Date(order.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Last updated</dt>
                  <dd className="mt-1 text-fg">{new Date(order.updatedAt).toLocaleString()}</dd>
                </div>
                {order.notes ? (
                  <div className="col-span-2">
                    <dt className="text-fg-muted">Notes</dt>
                    <dd className="mt-1 text-fg">{order.notes}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-fg">Payments ({order.paymentCount})</h2>
                {paymentsError ? (
                  <EmptyState
                    data-testid="order-payments-error"
                    title="Couldn't load payments"
                    description={queryErrorMessage(paymentsFetchError, "Something went wrong fetching payments for this order.")}
                    action={
                      <Button variant="secondary" onClick={() => refetchPayments()} data-testid="order-payments-retry">
                        Try again
                      </Button>
                    }
                  />
                ) : (
                  <DataTable
                    columns={paymentColumns}
                    rows={paymentsData?.items ?? []}
                    getRowId={(row) => row.id}
                    loading={paymentsLoading}
                    caption="Order payment records"
                    data-testid="order-payments-table"
                    emptyState={{
                      title: "No payment records yet",
                      description: "Once a payment is captured or manually recorded, it appears here.",
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
