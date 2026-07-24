// Batch → assigned mentors panel (WS-2, docs/specs/phase-8-mentor.md). Shows
// the batch's active mentor assignments with a lead badge; assign/remove
// gated on `mentors.assign` (distinct from `mentors.edit`/`batches.edit` —
// AC-29). The API is the real enforcement point for every guard below
// (active-mentor-only, no-duplicate, batch-status) — this panel only
// surfaces the resulting errors cleanly (CLAUDE.md §3.5). Renders inside
// batch-detail-drawer.tsx's "Mentors" tab, alongside the existing Overview/
// Roster tabs.
import * as React from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Skeleton, StatusChip, useToast } from "@repo/ui";
import type { BatchStatus, MentorBatchAssignment, MeResponse } from "@repo/types";

import { useBatchMentors, useRemoveMentorFromBatch } from "../../hooks/use-batch-mentors";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";
import { MentorEngagementStatusChip } from "../shared/mentor-engagement-status-chip";
import { AssignMentorDialog } from "./assign-mentor-dialog";

interface BatchMentorsPanelProps {
  batchId: string;
  batchStatus: BatchStatus;
  me: MeResponse | undefined;
}

export function BatchMentorsPanel({ batchId, batchStatus, me }: BatchMentorsPanelProps): React.JSX.Element {
  const canAssign = hasPermission(me?.permissions, "mentors.assign");
  const { data, isLoading, isError, error, refetch } = useBatchMentors(batchId);
  const removeMentor = useRemoveMentorFromBatch();
  const { toast } = useToast();

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<MentorBatchAssignment | null>(null);

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeMentor.mutateAsync({ batchId, mentorId: removeTarget.mentorId });
      toast({ title: "Mentor removed from batch", variant: "success" });
      setRemoveTarget(null);
    } catch (err) {
      surfaceError(toast, err, "Couldn't remove mentor from batch");
    }
  };

  if (isError) {
    return (
      <EmptyState
        data-testid="batch-mentors-error"
        title="Couldn't load assigned mentors"
        description={queryErrorMessage(error, "Something went wrong fetching this batch's mentors.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="batch-mentors-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const assignments = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Mentors leading this batch to completion.</p>
        {canAssign ? (
          <Button size="sm" onClick={() => setAssignOpen(true)} data-testid="batch-mentors-assign-button">
            <UserPlus className="size-4" aria-hidden="true" />
            Assign mentor
          </Button>
        ) : null}
      </div>

      {(batchStatus === "completed" || batchStatus === "archived") && (
        <p className="text-xs text-fg-muted" data-testid="batch-mentors-locked-note">
          This batch is {batchStatus}; mentors can no longer be (re)assigned. Existing assignments are still
          shown below for history.
        </p>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2" data-testid="batch-mentors-loading">
          <Skeleton shape="line" />
          <Skeleton shape="line" />
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          data-testid="batch-mentors-empty"
          title="No mentors assigned"
          description="This batch has no mentor assigned yet."
          action={
            canAssign ? (
              <Button size="sm" onClick={() => setAssignOpen(true)} data-testid="batch-mentors-empty-assign-button">
                Assign mentor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="batch-mentors-list">
          {assignments.map((assignment) => (
            <li
              key={assignment.batchMentorId}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-fg">
                  {assignment.mentorFullName}
                  {assignment.isLead ? <StatusChip tone="info" label="Lead" className="ml-2 align-middle" /> : null}
                </p>
                <p className="text-fg-muted">{assignment.mentorExternalInstitute}</p>
              </div>
              <div className="flex items-center gap-2">
                <MentorEngagementStatusChip status={assignment.mentorEngagementStatus} />
                {canAssign ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${assignment.mentorFullName} from this batch`}
                    onClick={() => setRemoveTarget(assignment)}
                    data-testid="batch-mentors-remove-button"
                  >
                    <UserMinus className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canAssign ? (
        <AssignMentorDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          batchId={batchId}
          batchStatus={batchStatus}
          alreadyAssignedMentorIds={assignments.map((a) => a.mentorId)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title="Remove this mentor from the batch?"
        description={
          removeTarget
            ? `${removeTarget.mentorFullName} will no longer be listed as running this batch. This preserves assignment history for audit.`
            : undefined
        }
        confirmLabel="Remove"
        tone="danger"
        loading={removeMentor.isPending}
        onConfirm={handleRemove}
        data-testid="batch-mentors-remove-confirm"
      />
    </div>
  );
}
