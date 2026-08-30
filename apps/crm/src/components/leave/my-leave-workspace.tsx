// My Leave — what any member of staff sees about their own time off.
//
// Balances first, then the history. That order is deliberate: the question somebody opens
// this page with is almost always "how much have I got left", and the list of past requests
// is the supporting detail rather than the headline.
//
// The balance cards show USED, AWAITING and LEFT separately rather than one number, because
// "left" already has pending requests deducted from it and a single figure with no
// explanation reads as an error the first time somebody applies for a week and watches it
// drop by five.
import * as React from "react";
import { CalendarPlus } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { LeaveBalance, LeaveRequestStatus, LeaveRequestSummary, MeResponse } from "@repo/types";
import { formatLeaveDays } from "@repo/types";

import { useCancelLeaveRequest, useLeaveApplyContext, useLeaveRequests } from "../../hooks/use-leave";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { LeaveApplyDrawer } from "./leave-apply-drawer";
import { LeaveRequestDrawer } from "./leave-request-drawer";
import { formatLeaveRange, leaveStatusLabel, leaveStatusTone } from "./leave-status";

const PAGE_SIZE = 25;

const STATUS_FILTERS: Array<{ value: LeaveRequestStatus | "all"; label: string }> = [
  { value: "all", label: "All requests" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Not approved" },
  { value: "cancelled", label: "Withdrawn" },
];

function BalanceCard({ balance }: { balance: LeaveBalance }): React.JSX.Element {
  return (
    <Card data-testid={`leave-balance-${balance.leaveTypeId}`}>
      <CardContent className="space-y-1 p-4">
        <p className="text-sm font-medium text-fg">{balance.leaveTypeName}</p>
        {balance.remainingDays === null ? (
          // Unpaid leave, or a year whose allowance nobody has set yet. Both are "there is no
          // number here", and saying so is better than showing a zero that looks like a refusal.
          <p className="text-sm text-fg-muted">
            {balance.paid ? "No allowance set for this year yet." : "Not counted against an allowance."}
          </p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-fg">{formatLeaveDays(balance.remainingDays)}</p>
            <p className="text-xs text-fg-muted">
              left of {formatLeaveDays(balance.entitledDays ?? 0)}
              {balance.usedDays > 0 ? ` · ${formatLeaveDays(balance.usedDays)} taken` : ""}
              {balance.pendingDays > 0 ? ` · ${formatLeaveDays(balance.pendingDays)} awaiting approval` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MyLeaveWorkspace({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canApply = hasPermission(me?.permissions, "leave.request");

  const [status, setStatus] = React.useState<LeaveRequestStatus | "all">("all");
  const [page, setPage] = React.useState(1);
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<LeaveRequestSummary | null>(null);

  React.useEffect(() => setPage(1), [status]);

  const contextQuery = useLeaveApplyContext();
  const requestsQuery = useLeaveRequests({
    page,
    pageSize: PAGE_SIZE,
    ...(status === "all" ? {} : { status }),
  });
  const cancel = useCancelLeaveRequest();

  const columns: Array<DataTableColumn<LeaveRequestSummary>> = [
    {
      id: "dates",
      header: "Dates",
      cell: (row) => (
        <button
          type="button"
          className="text-left font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setDetailId(row.id)}
        >
          {formatLeaveRange(row.startDate, row.endDate)}
        </button>
      ),
    },
    { id: "type", header: "Type", cell: (row) => row.leaveTypeName },
    { id: "days", header: "Length", cell: (row) => formatLeaveDays(row.days) },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={leaveStatusTone(row.status)} label={leaveStatusLabel(row.status)} />,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (row) =>
        // Withdrawing is only offered where it can actually succeed. A "Withdraw" button on a
        // decided request would be a control whose only outcome is an error message.
        canApply && (row.status === "pending" || row.status === "approved") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCancelTarget(row)}
            data-testid={`leave-withdraw-${row.id}`}
          >
            Withdraw
          </Button>
        ) : null,
    },
  ];

  const balances = contextQuery.data?.balances ?? [];
  const rows = requestsQuery.data?.items ?? [];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="my-leave-workspace">
      <PageHeader
        title="My Leave"
        description="Your leave allowance for the year, and everything you've applied for."
        actions={
          canApply ? (
            <Button onClick={() => setApplyOpen(true)} data-testid="leave-apply-open">
              <CalendarPlus className="mr-1.5 size-4" aria-hidden="true" />
              Apply for leave
            </Button>
          ) : null
        }
      />

      {balances.length > 0 ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="leave-balances"
          aria-label="Leave allowance"
        >
          {balances.map((balance) => (
            <BalanceCard key={balance.leaveTypeId} balance={balance} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onValueChange={(value) => setStatus(value as LeaveRequestStatus | "all")}
          wrapperClassName="w-52"
          data-testid="leave-status-filter"
        >
          {STATUS_FILTERS.map((filter) => (
            <SelectItem key={filter.value} value={filter.value}>
              {filter.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      {requestsQuery.isError ? (
        <Alert tone="danger" data-testid="leave-requests-error">
          Your leave requests couldn&apos;t be loaded. Reload the page to try again.
        </Alert>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={requestsQuery.isLoading}
          caption="Your leave requests"
          emptyState={{
            title: "No leave requests yet",
            description: canApply
              ? "When you apply for leave it'll show up here, along with where it's got to."
              : "You don't have permission to apply for leave. Ask an admin.",
          }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: requestsQuery.data?.meta.total ?? 0,
            onPageChange: setPage,
          }}
          data-testid="leave-requests-table"
        />
      )}

      <LeaveApplyDrawer open={applyOpen} onOpenChange={setApplyOpen} context={contextQuery.data} />

      <LeaveRequestDrawer
        requestId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        canDecide={false}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Withdraw this request?"
        description={
          cancelTarget
            ? `Your ${cancelTarget.leaveTypeName} for ${formatLeaveRange(cancelTarget.startDate, cancelTarget.endDate)} will be withdrawn. You can apply again for the same dates afterwards.`
            : ""
        }
        confirmLabel="Withdraw"
        loading={cancel.isPending}
        onConfirm={async () => {
          if (!cancelTarget) return;
          try {
            await cancel.mutateAsync(cancelTarget.id);
            toast({ title: "Request withdrawn", variant: "success" });
            setCancelTarget(null);
          } catch (err) {
            surfaceError(toast, err, "Couldn't withdraw this request");
          }
        }}
      />
    </div>
  );
}
