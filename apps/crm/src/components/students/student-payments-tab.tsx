// Student 360 — Payments tab (Phase 9 Completion T37; lifecycle-redesign P2).
// Top: the student's ORDERS (the program package + amount + paid/pending
// status) with a "Record payment" action on open orders — recording an
// offline payment captures it, marks the order paid, creates the enrollment
// and invoice atomically, advancing the lifecycle payment_pending →
// active_student in one click. Below: the raw payments ledger filtered to
// this student, with per-payment receipt downloads (T27/T40).
import * as React from "react";
import { Button, DataTable, type DataTableColumn, formatPaise, useToast } from "@repo/ui";
import type { MeResponse, OrderSummary, PaymentSummary } from "@repo/types";

import { usePaymentsList, usePaymentReceipt } from "../../hooks/use-payments";
import { useOrdersList, useCreatePaymentLink } from "../../hooks/use-orders";
import { useInvoiceDownload } from "../../hooks/use-invoices";
import { hasPermission } from "../../lib/permissions";
import { PaymentStatusChip } from "../commerce/payment-status-chip";
import { OrderStatusChip } from "../commerce/order-status-chip";
import { ManualPaymentFormDrawer } from "../commerce/manual-payment-form-drawer";

function ReceiptButton({ paymentId }: { paymentId: string }): React.JSX.Element {
  const [requested, setRequested] = React.useState(false);
  const { data, isFetching } = usePaymentReceipt(paymentId, requested);

  React.useEffect(() => {
    if (data?.ready && data.url) {
      window.open(data.url, "_blank", "noopener,noreferrer");
      setRequested(false);
    }
  }, [data]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        setRequested(true);
      }}
      loading={requested && (isFetching || data?.ready === false)}
      data-testid={`student-payment-receipt-${paymentId}`}
    >
      Receipt
    </Button>
  );
}

/** Lazy invoice download button — fetch-on-click; the response's url is null while the PDF is still generating. */
function InvoiceButton({ invoiceId }: { invoiceId: string }): React.JSX.Element {
  const [requested, setRequested] = React.useState(false);
  const { data, isFetching } = useInvoiceDownload(invoiceId, requested);

  React.useEffect(() => {
    if (data?.url) {
      window.open(data.url, "_blank", "noopener,noreferrer");
      setRequested(false);
    }
  }, [data]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        setRequested(true);
      }}
      loading={requested && (isFetching || (data !== undefined && data.url === null))}
      data-testid={`view-invoice-${invoiceId}`}
    >
      Invoice
    </Button>
  );
}

export function StudentPaymentsTab({
  studentId,
  me,
}: {
  studentId: string;
  me: MeResponse | undefined;
}): React.JSX.Element {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = usePaymentsList({ studentId, page: 1, pageSize: 20 });
  const orders = useOrdersList({ studentId, page: 1, pageSize: 20 });
  const canRecordPayment = hasPermission(me?.permissions, "payments.create");
  const [payOrder, setPayOrder] = React.useState<OrderSummary | null>(null);
  const createPaymentLink = useCreatePaymentLink();

  // Mint + copy a public pay URL for the student (secure Razorpay checkout, no login —
  // the signed token in the link is the authorization).
  const sendPaymentLink = async (orderId: string) => {
    try {
      const link = await createPaymentLink.mutateAsync(orderId);
      await navigator.clipboard.writeText(link.url);
      toast({
        title: "Payment link copied",
        description: `Valid until ${new Date(link.expiresAt).toLocaleDateString()} — paste it into an email or WhatsApp to the student.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't create payment link",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const orderColumns: Array<DataTableColumn<OrderSummary>> = [
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "status", header: "Status", cell: (row) => <OrderStatusChip status={row.status} /> },
    {
      id: "action",
      header: "",
      align: "right",
      cell: (row) =>
        row.status === "created" && canRecordPayment ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void sendPaymentLink(row.id);
              }}
              loading={createPaymentLink.isPending}
              data-testid={`send-payment-link-${row.id}`}
            >
              Send payment link
            </Button>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setPayOrder(row);
              }}
              data-testid={`record-payment-${row.id}`}
            >
              Record payment
            </Button>
          </div>
        ) : row.status === "paid" && row.invoiceId ? (
          <InvoiceButton invoiceId={row.invoiceId} />
        ) : null,
    },
  ];

  const columns: Array<DataTableColumn<PaymentSummary>> = [
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise) },
    { id: "status", header: "Status", cell: (row) => <PaymentStatusChip status={row.status} /> },
    { id: "method", header: "Method", cell: (row) => row.method ?? "—" },
    { id: "paidAt", header: "Paid", cell: (row) => (row.paidAt ? new Date(row.paidAt).toLocaleDateString() : "—") },
    {
      id: "receipt",
      header: "Receipt",
      cell: (row) => (row.status === "captured" ? <ReceiptButton paymentId={row.id} /> : "—"),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-danger">Couldn't load payments.</p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="student-orders-section">
        <h4 className="text-sm font-medium text-fg">Orders</h4>
        <DataTable
          columns={orderColumns}
          rows={orders.data?.items ?? []}
          getRowId={(row) => row.id}
          loading={orders.isLoading}
          caption="Student orders"
          emptyState={{ title: "No orders", description: "Program orders for this student will appear here." }}
          data-testid="student-orders-table"
        />
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-fg">Payments ledger</h4>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          caption="Student payments"
          emptyState={{ title: "No payments yet", description: "Payments made by this student will appear here." }}
          data-testid="student-payments-table"
        />
      </div>

      <ManualPaymentFormDrawer
        open={payOrder !== null}
        onOpenChange={(open) => !open && setPayOrder(null)}
        defaultOrderId={payOrder?.id}
        defaultAmountPaise={payOrder?.amountPaise}
      />
    </div>
  );
}
