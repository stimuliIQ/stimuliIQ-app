// Refunds list + approval workflow (docs/03 §7.6 "refunds (approval
// workflow)"). DataTable of refund requests; Approve/Reject actions are
// RBAC-gated to `refunds.approve` (Finance/Owner/Admin only, per
// docs/03 §9 + the RequestRefundRequest/ApproveRefundRequest contracts) —
// hidden here, enforced server-side.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, formatPaise, PageHeader, Select, SelectItem } from "@repo/ui";
import type { ListRefundsQuery, RefundStatus, RefundSummary } from "@repo/types";

import { useRefundsList } from "../../hooks/use-refunds";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { RefundStatusChip } from "./refund-status-chip";
import { RefundDetailDrawer } from "./refund-detail-drawer";
import { RequestRefundFormDrawer } from "./request-refund-form-drawer";
import type { MeResponse } from "@repo/types";
import { queryErrorMessage } from "../../lib/surface-error";

const STATUS_OPTIONS: { value: RefundStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
];

interface RefundListProps {
  me: MeResponse | undefined;
}

export function RefundList({ me }: RefundListProps): React.JSX.Element {
  const canRequest = hasPermission(me?.permissions, "refunds.create");
  const canApprove = hasPermission(me?.permissions, "refunds.approve");

  const [status, setStatus] = React.useState<RefundStatus | undefined>(undefined);
  const [paymentId, setPaymentId] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedRefundId, setSelectedRefundId] = React.useState<string | null>(null);
  const [requestOpen, setRequestOpen] = React.useState(false);

  const debouncedPaymentId = useDebouncedValue(paymentId);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedPaymentId, status]);

  const query: ListRefundsQuery = {
    page,
    pageSize,
    status,
    paymentId: debouncedPaymentId || undefined,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useRefundsList(query);

  const columns: Array<DataTableColumn<RefundSummary>> = [
    { id: "paymentId", header: "Payment", cell: (row) => row.paymentId, sortable: true },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "reason", header: "Reason", cell: (row) => row.reason },
    { id: "status", header: "Status", cell: (row) => <RefundStatusChip status={row.status} /> },
    { id: "requestedByName", header: "Requested by", cell: (row) => row.requestedByName ?? "-" },
    { id: "approvedByName", header: "Approved by", cell: (row) => row.approvedByName ?? "-" },
    {
      id: "createdAt",
      header: "Requested",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="refunds-error"
        title="Couldn't load refunds"
        description={queryErrorMessage(error, "Something went wrong fetching the refund list.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="refunds-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="refunds-list">
      <PageHeader
        title="Refunds"
        description="Request, approve, and track refunds against captured payments."
        actions={
          canRequest ? (
            <Button onClick={() => setRequestOpen(true)} data-testid="refunds-request-button">
              <Plus className="size-4" aria-hidden="true" />
              Request refund
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={paymentId}
        onSearchChange={setPaymentId}
        searchLabel="Payment ID"
        searchPlaceholder="Filter by payment id"
        data-testid="refunds-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as RefundStatus))}
          wrapperClassName="w-44"
          data-testid="refunds-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedRefundId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No refunds yet",
          description: "Requested refunds will appear here for approval.",
        }}
        caption="Refunds"
        data-testid="refunds-table"
      />

      <RefundDetailDrawer
        refundId={selectedRefundId}
        onOpenChange={(open) => !open && setSelectedRefundId(null)}
        canApprove={canApprove}
      />
      <RequestRefundFormDrawer open={requestOpen} onOpenChange={setRequestOpen} />
    </div>
  );
}
