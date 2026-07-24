// Refund detail drawer — detail fields + Approve/Reject actions. Approve/
// reject are gated by `canApprove` (passed from the parent's
// `refunds.approve` check — Finance/Owner/Admin only per docs/03 §9). This
// is presentation-only hiding; the server is the real enforcement and
// returns 403 + logs on an out-of-scope attempt (CLAUDE.md §3.5).
import * as React from "react";
import { Check, X } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  formatPaise,
  Input,
  Skeleton,
  useToast,
} from "@repo/ui";

import { useApproveRefund, useRefund, useRejectRefund } from "../../hooks/use-refunds";
import { RefundStatusChip } from "./refund-status-chip";

interface RefundDetailDrawerProps {
  refundId: string | null;
  onOpenChange: (open: boolean) => void;
  canApprove: boolean;
}

export function RefundDetailDrawer({ refundId, onOpenChange, canApprove }: RefundDetailDrawerProps): React.JSX.Element {
  const open = Boolean(refundId);
  const { data: refund, isLoading, isError, refetch } = useRefund(refundId ?? undefined);
  const approveRefund = useApproveRefund();
  const rejectRefund = useRejectRefund();
  const { toast } = useToast();

  const [approveConfirmOpen, setApproveConfirmOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  const isPending = refund?.status === "requested";

  function surfaceError(error: unknown, title: string) {
    const description =
      error && typeof error === "object" && "problem" in error
        ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
          (error as { problem: { detail?: string; title?: string } }).problem.title)
        : error instanceof Error
          ? error.message
          : undefined;
    toast({ title, description, variant: "destructive" });
  }

  const handleApprove = async () => {
    if (!refund) return;
    try {
      await approveRefund.mutateAsync({ id: refund.id, body: {} });
      toast({ title: "Refund approved", description: "The provider refund call has been triggered.", variant: "success" });
      setApproveConfirmOpen(false);
    } catch (error) {
      surfaceError(error, "Couldn't approve refund");
    }
  };

  const handleReject = async () => {
    if (!refund || !rejectReason.trim()) return;
    try {
      await rejectRefund.mutateAsync({ id: refund.id, body: { reason: rejectReason.trim() } });
      toast({ title: "Refund rejected", variant: "success" });
      setRejectOpen(false);
      setRejectReason("");
    } catch (error) {
      surfaceError(error, "Couldn't reject refund");
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title={refund ? `Refund — ${formatPaise(refund.amountPaise)}` : "Refund"}
          description={refund?.studentName}
          size="lg"
          data-testid="refund-detail-drawer"
        >
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="refund-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="refund-detail-error"
                title="Couldn't load this refund"
                description="Something went wrong fetching the refund details."
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="refund-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !refund ? (
              <EmptyState data-testid="refund-detail-empty" title="No data" description="This refund has no details to show." />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <RefundStatusChip status={refund.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Amount</dt>
                  <dd className="mt-1 text-fg">{formatPaise(refund.amountPaise)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-fg-muted">Reason</dt>
                  <dd className="mt-1 text-fg">{refund.reason}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Student</dt>
                  <dd className="mt-1 text-fg">{refund.studentName}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Program</dt>
                  <dd className="mt-1 text-fg">{refund.programTitle}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Payment</dt>
                  <dd className="mt-1 text-fg">{refund.paymentId}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Order</dt>
                  <dd className="mt-1 text-fg">{refund.orderId}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Requested by</dt>
                  <dd className="mt-1 text-fg">{refund.requestedByName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Approved by</dt>
                  <dd className="mt-1 text-fg">{refund.approvedByName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Provider refund id</dt>
                  <dd className="mt-1 text-fg">{refund.providerRefundId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Processed at</dt>
                  <dd className="mt-1 text-fg">{refund.processedAt ? new Date(refund.processedAt).toLocaleString() : "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Requested</dt>
                  <dd className="mt-1 text-fg">{new Date(refund.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
            )}
          </DrawerBody>
          {refund && canApprove && isPending ? (
            <DrawerFooter>
              <Button
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                data-testid="refund-reject-button"
              >
                <X className="size-4" aria-hidden="true" />
                Reject
              </Button>
              <Button onClick={() => setApproveConfirmOpen(true)} data-testid="refund-approve-button">
                <Check className="size-4" aria-hidden="true" />
                Approve
              </Button>
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        title="Approve this refund?"
        description={refund ? `${formatPaise(refund.amountPaise)} will be refunded via the provider.` : undefined}
        confirmLabel="Approve"
        loading={approveRefund.isPending}
        onConfirm={handleApprove}
        data-testid="refund-approve-confirm"
      />

      <Drawer open={rejectOpen} onOpenChange={(next) => { setRejectOpen(next); if (!next) setRejectReason(""); }}>
        <DrawerContent title="Reject this refund?" description="This is terminal — no provider call will be issued." size="sm" data-testid="refund-reject-drawer">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Reason"
              required
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Required for the audit trail"
              data-testid="refund-reject-reason"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} data-testid="refund-reject-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              loading={rejectRefund.isPending}
              disabled={!rejectReason.trim()}
              data-testid="refund-reject-submit"
            >
              Reject refund
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
