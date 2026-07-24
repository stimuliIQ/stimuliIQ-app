// Payments ledger — the reconciliation source of truth (docs/03 §20). Dense
// DataTable + filters + the reconciliation widget + manual payment entry
// (Finance-gated). Mirrors components/batches/batch-directory.tsx
// conventions.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, Input, PageHeader, Select, SelectItem, StatusChip } from "@repo/ui";
import type { ListPaymentsQuery, MeResponse, PaymentStatus, PaymentSummary } from "@repo/types";

import { usePaymentsList } from "../../hooks/use-payments";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { formatPaise } from "@repo/ui";
import { PaymentStatusChip } from "./payment-status-chip";
import { PaymentDetailDrawer } from "./payment-detail-drawer";
import { ManualPaymentFormDrawer } from "./manual-payment-form-drawer";
import { ReconciliationWidget } from "./reconciliation-widget";

const STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "authorized", label: "Authorized" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

interface PaymentLedgerProps {
  me: MeResponse | undefined;
}

export function PaymentLedger({ me }: PaymentLedgerProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "payments");

  const [orderId, setOrderId] = React.useState("");
  const [status, setStatus] = React.useState<PaymentStatus | undefined>(undefined);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedPaymentId, setSelectedPaymentId] = React.useState<string | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);

  const debouncedOrderId = useDebouncedValue(orderId);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedOrderId, status, from, to]);

  const query: ListPaymentsQuery = {
    page,
    pageSize,
    orderId: debouncedOrderId || undefined,
    status,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  };

  const { data, isLoading, isError, refetch, isFetching } = usePaymentsList(query);

  const columns: Array<DataTableColumn<PaymentSummary>> = [
    { id: "provider", header: "Provider", cell: (row) => row.provider, sortable: true },
    {
      id: "providerPaymentId",
      header: "Provider payment id",
      cell: (row) => row.providerPaymentId ?? "—",
    },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "status", header: "Status", cell: (row) => <PaymentStatusChip status={row.status} /> },
    { id: "method", header: "Method", cell: (row) => row.method ?? "—" },
    {
      id: "isManual",
      header: "Manual",
      cell: (row) =>
        row.isManual ? (
          <StatusChip tone="info" label="Manual" size="sm" />
        ) : (
          <StatusChip tone="neutral" label="Gateway" size="sm" />
        ),
    },
    {
      id: "paidAt",
      header: "Paid at",
      cell: (row) => (row.paidAt ? new Date(row.paidAt).toLocaleString() : "—"),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="payments-error"
        title="Couldn't load the payments ledger"
        description="Something went wrong fetching payments."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="payments-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="payments-ledger">
      <PageHeader
        title="Payments"
        description="The authoritative payment ledger — Razorpay-captured and manually recorded payments."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setManualOpen(true)} data-testid="payments-manual-entry-button">
              <Plus className="size-4" aria-hidden="true" />
              Record manual payment
            </Button>
          ) : null
        }
      />

      {permissions.canView ? <ReconciliationWidget /> : null}

      <DataFilterBar
        searchValue={orderId}
        onSearchChange={setOrderId}
        searchLabel="Order ID"
        searchPlaceholder="Filter by order id"
        data-testid="payments-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as PaymentStatus))}
          wrapperClassName="w-44"
          data-testid="payments-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          wrapperClassName="w-40"
          data-testid="payments-from-filter"
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          wrapperClassName="w-40"
          data-testid="payments-to-filter"
        />
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedPaymentId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No payments yet",
          description: "Captured Razorpay payments and manual entries will appear here.",
        }}
        caption="Payment ledger"
        data-testid="payments-table"
      />

      <PaymentDetailDrawer paymentId={selectedPaymentId} onOpenChange={(open) => !open && setSelectedPaymentId(null)} />
      <ManualPaymentFormDrawer open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}
