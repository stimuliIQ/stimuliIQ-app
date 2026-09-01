// The approval queue — super admin only.
//
// Defaults to the PENDING filter rather than "all", because this screen exists to answer one
// question ("what is waiting on me?") and opening it on a list of already-decided requests
// buries the two rows that need action.
//
// The decision itself lives in the shared request drawer, not here: the reviewer needs the
// reason and the dates in front of them before deciding, and an approve button on a table
// row invites deciding from a summary.
import * as React from "react";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
} from "@repo/ui";
import type { LeaveRequestStatus, LeaveRequestSummary, MeResponse } from "@repo/types";
import { formatLeaveDays } from "@repo/types";

import { useLeaveRequests, useLeaveTypes } from "../../hooks/use-leave";
import { hasPermission } from "../../lib/permissions";
import { LeaveRequestDrawer } from "./leave-request-drawer";
import { formatLeaveRange, leaveStatusLabel, leaveStatusTone } from "./leave-status";

const PAGE_SIZE = 25;

const STATUS_FILTERS: Array<{ value: LeaveRequestStatus | "all"; label: string }> = [
  { value: "pending", label: "Awaiting the team lead" },
  // The middle of the two-step chain: the lead has approved and it is on the manager's desk.
  // Its own filter rather than being folded into "pending", because these are two different
  // people's to-do lists and merging them makes both harder to work.
  { value: "lead_approved", label: "Awaiting the manager" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Not approved" },
  { value: "cancelled", label: "Withdrawn" },
  { value: "all", label: "All requests" },
];

export function LeaveApprovalsWorkspace({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canDecide = hasPermission(me?.permissions, "leave.approve");

  const [status, setStatus] = React.useState<LeaveRequestStatus | "all">("pending");
  const [leaveTypeId, setLeaveTypeId] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  React.useEffect(() => setPage(1), [status, leaveTypeId]);

  const typesQuery = useLeaveTypes(false);
  const requestsQuery = useLeaveRequests({
    page,
    pageSize: PAGE_SIZE,
    ...(status === "all" ? {} : { status }),
    ...(leaveTypeId === "all" ? {} : { leaveTypeId }),
  });

  const columns: Array<DataTableColumn<LeaveRequestSummary>> = [
    { id: "who", header: "Who", cell: (row) => <span className="font-medium text-fg">{row.userName}</span> },
    { id: "type", header: "Type", cell: (row) => row.leaveTypeName },
    { id: "dates", header: "Dates", cell: (row) => formatLeaveRange(row.startDate, row.endDate) },
    { id: "days", header: "Length", cell: (row) => formatLeaveDays(row.days), align: "right" },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={leaveStatusTone(row.status)} label={leaveStatusLabel(row.status)} />,
    },
  ];

  const rows = requestsQuery.data?.items ?? [];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="leave-approvals-workspace">
      <PageHeader
        title="Leave approvals"
        description="Every leave request from the team. Open one to see the reason and decide."
      />

      {!canDecide ? (
        <Alert tone="warning" data-testid="leave-approvals-readonly">
          You can see these requests but not decide on them. Only a super admin approves leave.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onValueChange={(value) => setStatus(value as LeaveRequestStatus | "all")}
          wrapperClassName="w-52"
          data-testid="leave-approvals-status-filter"
        >
          {STATUS_FILTERS.map((filter) => (
            <SelectItem key={filter.value} value={filter.value}>
              {filter.label}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Leave type"
          value={leaveTypeId}
          onValueChange={setLeaveTypeId}
          wrapperClassName="w-52"
          data-testid="leave-approvals-type-filter"
        >
          <SelectItem value="all">All types</SelectItem>
          {(typesQuery.data ?? []).map((type) => (
            <SelectItem key={type.id} value={type.id}>
              {type.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {requestsQuery.isError ? (
        <Alert tone="danger" data-testid="leave-approvals-error">
          The leave queue couldn&apos;t be loaded. Reload the page to try again.
        </Alert>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={requestsQuery.isLoading}
          caption="Leave requests from the team"
          onRowClick={(row) => setDetailId(row.id)}
          emptyState={{
            title: status === "pending" ? "Nothing waiting on you" : "No requests here",
            description:
              status === "pending"
                ? "Every leave request has been decided. New ones land here and email you."
                : "Try a different status or leave type.",
          }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: requestsQuery.data?.meta.total ?? 0,
            onPageChange: setPage,
          }}
          data-testid="leave-approvals-table"
        />
      )}

      <LeaveRequestDrawer
        requestId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        canDecide={canDecide}
      />
    </div>
  );
}
