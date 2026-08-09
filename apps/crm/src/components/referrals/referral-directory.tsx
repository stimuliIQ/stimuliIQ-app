// Marketing > Referrals — staff oversight list + approve/reward transitions.
// Phase 9 Completion T25/T39. Permission keys per
// apps/api/src/modules/referrals/referrals.controller.ts: referrals.view
// (list) / referrals.approve (status transition — the "approve/reward" verb
// covers every manual status change here, not just the "approved" value).
import * as React from "react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem, StatusChip, useToast } from "@repo/ui";
import type { MeResponse, Referral, ReferralStatus } from "@repo/types";

import { useReferralsList, useUpdateReferralStatus } from "../../hooks/use-referrals";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: ReferralStatus[] = ["pending", "converted", "rewarded", "expired", "rejected"];

const STATUS_TONE: Record<ReferralStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  converted: "info",
  rewarded: "success",
  expired: "warning",
  rejected: "danger",
};

function RowActions({ referral, canApprove }: { referral: Referral; canApprove: boolean }): React.JSX.Element | null {
  const updateStatus = useUpdateReferralStatus();
  const { toast } = useToast();

  if (!canApprove) return null;

  async function transition(status: ReferralStatus) {
    try {
      await updateStatus.mutateAsync({ id: referral.id, body: { status } });
      toast({ title: `Referral marked ${status}`, variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this referral");
    }
  }

  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {referral.status === "converted" ? (
        <Button size="sm" onClick={() => transition("rewarded")} loading={updateStatus.isPending} data-testid={`referral-reward-${referral.id}`}>
          Reward
        </Button>
      ) : null}
      {referral.status === "pending" ? (
        <Button size="sm" variant="ghost" onClick={() => transition("rejected")} loading={updateStatus.isPending} data-testid={`referral-reject-${referral.id}`}>
          Reject
        </Button>
      ) : null}
    </div>
  );
}

export function ReferralDirectory({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canApprove = hasPermission(me?.permissions, "referrals.approve");
  const [status, setStatus] = React.useState<ReferralStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const pageSize = 20;

  React.useEffect(() => setPage(1), [status]);

  const { data, isLoading, isFetching, isError, refetch } = useReferralsList({ page, pageSize, status });

  const columns: Array<DataTableColumn<Referral>> = [
    { id: "referrerName", header: "Referrer", cell: (row) => row.referrerName },
    { id: "code", header: "Code", cell: (row) => row.code },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    {
      id: "reward",
      header: "Reward",
      cell: (row) => (row.reward ? (row.reward.type === "cash" ? `₹${(row.reward.amountPaise / 100).toFixed(2)}` : "Coupon") : "—"),
    },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
    { id: "actions", header: "", cell: (row) => <RowActions referral={row} canApprove={canApprove} />, align: "right" },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load referrals"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="referrals-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="referral-directory">
      <PageHeader
        title="Referrals"
        description="Affiliate/referral program oversight — approve conversions and rewards."
      />

      <DataFilterBar data-testid="referral-filter-bar">
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(v) => setStatus(v === "__all__" ? undefined : (v as ReferralStatus))}
          wrapperClassName="w-44"
          data-testid="referral-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No referrals yet", description: "Referral activity will appear here." }}
        caption="Referrals"
        data-testid="referral-table"
      />
    </div>
  );
}
