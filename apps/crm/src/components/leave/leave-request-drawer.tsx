// One leave request in full, and — for a super admin — the decision.
//
// TWO VERBS, NOT A STATUS PICKER, the same shape the onboarding queue settled on. A request
// is awaiting a decision until somebody approves or turns it down, so the drawer offers
// exactly those two buttons. A status dropdown would imply a set of interchangeable states,
// hide that only two are reachable, and let a reviewer set "approved" without the balance
// check and the email that approving actually entails.
//
// REJECTING ASKS FOR A REASON AND WILL NOT PROCEED WITHOUT ONE. It is emailed to the
// applicant verbatim, and the reviewer is the only person who knows why — a rejection with
// no explanation is what makes somebody apply for the same dates again next week. Approving
// takes an optional note, because "yes" needs no justification.
import * as React from "react";
import { Check, X } from "lucide-react";
import {
  Alert,
  Button,
  DetailGrid,
  DetailRow,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Skeleton,
  StatusChip,
  Textarea,
  useToast,
} from "@repo/ui";
import { formatLeaveDays } from "@repo/types";

import { useApproveLeaveRequest, useLeaveRequest, useRejectLeaveRequest } from "../../hooks/use-leave";
import { surfaceError } from "../../lib/surface-error";
import { dayPartLabel, formatLeaveRange, leaveStatusLabel, leaveStatusTone } from "./leave-status";

interface LeaveRequestDrawerProps {
  requestId: string | null;
  onOpenChange: (open: boolean) => void;
  /** True only where the viewer holds `leave.approve`. The API is the real gate. */
  canDecide: boolean;
}

export function LeaveRequestDrawer({
  requestId,
  onOpenChange,
  canDecide,
}: LeaveRequestDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const query = useLeaveRequest(requestId);
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();

  const [mode, setMode] = React.useState<"view" | "approve" | "reject">("view");
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string | null>(null);

  // Reopening on a different request must not inherit the half-typed reason from the last one.
  React.useEffect(() => {
    setMode("view");
    setNote("");
    setNoteError(null);
  }, [requestId]);

  const request = query.data;
  const isPending = request?.status === "pending";
  const busy = approve.isPending || reject.isPending;

  async function onApprove(): Promise<void> {
    if (!request) return;
    try {
      await approve.mutateAsync({ id: request.id, body: { note: note.trim() || null } });
      toast({ title: "Leave approved", description: `${request.userName} has been told.`, variant: "success" });
      onOpenChange(false);
    } catch (err) {
      surfaceError(toast, err, "Something went wrong");
    }
  }

  async function onReject(): Promise<void> {
    if (!request) return;
    // Checked here as well as by the schema so the applicant-facing reason can never be
    // sent empty by a form that only validates on the server's terms.
    if (note.trim().length < 3) {
      setNoteError("Tell them why, they'll see this.");
      return;
    }
    try {
      await reject.mutateAsync({ id: request.id, body: { reason: note.trim() } });
      toast({ title: "Leave turned down", description: `${request.userName} has been told.`, variant: "success" });
      onOpenChange(false);
    } catch (err) {
      surfaceError(toast, err, "Something went wrong");
    }
  }

  return (
    <Drawer open={requestId !== null} onOpenChange={onOpenChange}>
      <DrawerContent
        title={request ? `${request.userName} · ${request.leaveTypeName}` : "Leave request"}
        description={request ? formatLeaveRange(request.startDate, request.endDate) : undefined}
        data-testid="leave-request-drawer"
      >
        <DrawerBody>
          {query.isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading request">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : query.isError || !request ? (
            <Alert tone="danger">This leave request couldn&apos;t be loaded.</Alert>
          ) : (
            <div className="space-y-4">
              <DetailGrid>
                <DetailRow label="Status">
                  <StatusChip
                    tone={leaveStatusTone(request.status)}
                    label={leaveStatusLabel(request.status)}
                  />
                </DetailRow>
                <DetailRow label="Applicant">{request.userName}</DetailRow>
                <DetailRow label="Type">{request.leaveTypeName}</DetailRow>
                <DetailRow label="Dates">{formatLeaveRange(request.startDate, request.endDate)}</DetailRow>
                <DetailRow label="Length">{formatLeaveDays(request.days)}</DetailRow>
                {request.startDayPart !== "full" || request.endDayPart !== "full" ? (
                  <DetailRow label="Half days">
                    {request.startDate === request.endDate
                      ? dayPartLabel(request.startDayPart)
                      : `${dayPartLabel(request.startDayPart)} on the first day, ${dayPartLabel(
                          request.endDayPart,
                        ).toLowerCase()} on the last`}
                  </DetailRow>
                ) : null}
                <DetailRow label="Reason">{request.reason}</DetailRow>
                {request.reviewedByName ? (
                  <DetailRow label="Decided by">{request.reviewedByName}</DetailRow>
                ) : null}
                {request.reviewNote ? (
                  <DetailRow label={request.status === "rejected" ? "Reason given" : "Note"}>
                    {request.reviewNote}
                  </DetailRow>
                ) : null}
              </DetailGrid>

              {mode !== "view" ? (
                <Textarea
                  label={mode === "reject" ? "Why is this being turned down?" : "Note (optional)"}
                  rows={3}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setNoteError(null);
                  }}
                  error={noteError ?? undefined}
                  helperText={
                    mode === "reject"
                      ? `${request.userName} sees this in the email, word for word.`
                      : "Only shown to the applicant if you write one."
                  }
                  data-testid="leave-decision-note"
                />
              ) : null}
            </div>
          )}
        </DrawerBody>

        <DrawerFooter>
          {canDecide && isPending && mode === "view" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setMode("reject")}
                data-testid="leave-reject-start"
              >
                <X className="mr-1.5 size-4" aria-hidden="true" />
                Turn down
              </Button>
              <Button onClick={() => setMode("approve")} data-testid="leave-approve-start">
                <Check className="mr-1.5 size-4" aria-hidden="true" />
                Approve
              </Button>
            </>
          ) : null}

          {mode !== "view" ? (
            <>
              <Button variant="secondary" onClick={() => setMode("view")} disabled={busy}>
                Back
              </Button>
              <Button
                variant={mode === "reject" ? "destructive" : "primary"}
                loading={busy}
                onClick={mode === "reject" ? onReject : onApprove}
                data-testid={mode === "reject" ? "leave-reject-confirm" : "leave-approve-confirm"}
              >
                {mode === "reject" ? "Turn down" : "Approve"}
              </Button>
            </>
          ) : null}

          {mode === "view" && (!canDecide || !isPending) ? (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
