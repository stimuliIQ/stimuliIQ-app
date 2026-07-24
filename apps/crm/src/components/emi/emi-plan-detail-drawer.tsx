// EMI plan detail — installment schedule, mark-paid, dunning trigger.
// Phase 9 Completion T24/T39.
import * as React from "react";
import { Button, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, EmptyState, Skeleton, StatusChip, formatPaise, useToast } from "@repo/ui";
import type { EmiInstallment, EmiInstallmentStatus } from "@repo/types";

import { useEmiPlan, useMarkEmiInstallmentPaid, useTriggerEmiDunning } from "../../hooks/use-emi-plans";
import { surfaceError } from "../../lib/surface-error";

const STATUS_TONE: Record<EmiInstallmentStatus, "neutral" | "success" | "danger" | "warning"> = {
  pending: "neutral",
  paid: "success",
  overdue: "danger",
  waived: "warning",
  failed: "danger",
};

interface EmiPlanDetailDrawerProps {
  planId: string | null;
  onOpenChange: (open: boolean) => void;
  /** `emi.charge` — permission for marking an installment paid. */
  canCharge: boolean;
  /** `emi.edit` — permission for triggering a manual dunning reminder. */
  canEdit: boolean;
}

export function EmiPlanDetailDrawer({ planId, onOpenChange, canCharge, canEdit }: EmiPlanDetailDrawerProps): React.JSX.Element {
  const open = Boolean(planId);
  const { data: plan, isLoading, isError, refetch } = useEmiPlan(planId ?? undefined);
  const markPaid = useMarkEmiInstallmentPaid();
  const triggerDunning = useTriggerEmiDunning();
  const { toast } = useToast();

  async function handleMarkPaid(installmentId: string) {
    if (!planId) return;
    try {
      await markPaid.mutateAsync({ id: planId, installmentId });
      toast({ title: "Installment marked paid", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't mark this installment paid");
    }
  }

  async function handleDunning(installmentId: string) {
    if (!planId) return;
    try {
      await triggerDunning.mutateAsync({ id: planId, installmentId });
      toast({ title: "Dunning reminder queued", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't trigger a dunning reminder");
    }
  }

  const columns: Array<DataTableColumn<EmiInstallment>> = [
    { id: "installmentNo", header: "#", cell: (row) => row.installmentNo },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise) },
    { id: "dueDate", header: "Due", cell: (row) => new Date(row.dueDate).toLocaleDateString() },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    { id: "dunningAttempts", header: "Dunning", cell: (row) => row.dunningAttempts, align: "right" },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        row.status !== "paid" ? (
          <div className="flex justify-end gap-1">
            {canCharge ? (
              <Button size="sm" onClick={() => handleMarkPaid(row.id)} loading={markPaid.isPending} data-testid={`emi-mark-paid-${row.id}`}>
                Mark paid
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => handleDunning(row.id)} loading={triggerDunning.isPending} data-testid={`emi-dunning-${row.id}`}>
                Remind
              </Button>
            ) : null}
          </div>
        ) : null,
      align: "right",
    },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={plan ? `EMI plan — ${plan.studentName}` : "EMI plan"} size="lg" data-testid="emi-plan-detail-drawer">
        <DrawerBody>
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <EmptyState
              title="Couldn't load this plan"
              action={
                <Button variant="secondary" onClick={() => refetch()}>
                  Try again
                </Button>
              }
            />
          ) : !plan ? (
            <EmptyState title="No data" />
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-fg-muted">Total amount</dt>
                  <dd className="mt-1 text-fg">{formatPaise(plan.totalAmountPaise)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <StatusChip tone={plan.status === "active" ? "info" : plan.status === "completed" ? "success" : "danger"} label={plan.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Installments</dt>
                  <dd className="mt-1 text-fg">{plan.numInstallments}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Start date</dt>
                  <dd className="mt-1 text-fg">{new Date(plan.startDate).toLocaleDateString()}</dd>
                </div>
              </dl>

              <DataTable
                columns={columns}
                rows={plan.installments}
                getRowId={(row) => row.id}
                caption="Installment schedule"
                emptyState={{ title: "No installments" }}
                data-testid="emi-installments-table"
              />
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
