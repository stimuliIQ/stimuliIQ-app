// Assign-mentor dialog — small search-select modal (not a full drawer),
// launched from the batch detail drawer's
// Mentors tab (WS-2, docs/specs/phase-8-mentor.md). Only ACTIVE mentors are
// listed — the server would 422 MENTOR_NOT_ACTIVE for a prospective/
// inactive one (AC-18), so filtering the picker to active mentors makes
// that guard visible by omission ("make clear inactive mentors can't be
// assigned"); the 422 is still handled cleanly below as a defense-in-depth
// fallback for the race where a mentor goes inactive between fetch and
// submit. Re-selecting an already-assigned mentor with a different "Lead"
// value promotes/demotes them (the single POST endpoint's documented
// decision tree, see @repo/types); the exact same (mentor, lead value)
// repeated is a 409 ALREADY_ASSIGNED (AC-19).
import * as React from "react";
import { ApiError } from "@repo/api-client";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Label,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import type { BatchStatus } from "@repo/types";

import { useMentorsList } from "../../hooks/use-mentors";
import { useAssignMentorToBatch } from "../../hooks/use-batch-mentors";
import { surfaceError } from "../../lib/surface-error";

interface AssignMentorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchStatus: BatchStatus;
  alreadyAssignedMentorIds: string[];
}

export function AssignMentorDialog({
  open,
  onOpenChange,
  batchId,
  batchStatus,
  alreadyAssignedMentorIds,
}: AssignMentorDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const [mentorId, setMentorId] = React.useState<string | undefined>(undefined);
  const [isLead, setIsLead] = React.useState(false);

  const { data, isLoading, isError } = useMentorsList({
    page: 1,
    pageSize: 200,
    engagementStatus: "active",
    includeDeleted: false,
  });
  const assignMentor = useAssignMentorToBatch();

  React.useEffect(() => {
    if (!open) {
      setMentorId(undefined);
      setIsLead(false);
    }
  }, [open]);

  const notAssignable = batchStatus === "completed" || batchStatus === "archived";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mentorId) return;
    try {
      await assignMentor.mutateAsync({ batchId, body: { mentorId, isLead } });
      toast({ title: "Mentor assigned", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.problem.code === "MENTOR_NOT_ACTIVE") {
          toast({
            title: "Mentor isn't active",
            description: "Only actively-engaged mentors can be assigned to a batch.",
            variant: "destructive",
          });
          return;
        }
        if (error.problem.code === "ALREADY_ASSIGNED") {
          toast({
            title: "Already assigned",
            description: "This mentor is already assigned to this batch with that lead setting.",
            variant: "destructive",
          });
          return;
        }
        if (error.problem.code === "BATCH_NOT_ASSIGNABLE") {
          toast({
            title: "Batch isn't assignable",
            description: "Mentors can only be (re)assigned while a batch is planned or active.",
            variant: "destructive",
          });
          return;
        }
      }
      surfaceError(toast, error, "Couldn't assign mentor");
    }
  };

  const mentors = data?.items ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Assign a mentor"
        description="Only actively-engaged mentors can be assigned to a batch."
        size="sm"
        data-testid="assign-mentor-dialog"
      >
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            {notAssignable ? (
              <Alert tone="warning" data-testid="assign-mentor-locked-warning">
                This batch is {batchStatus}. The server will reject new assignments.
              </Alert>
            ) : null}
            {isError ? (
              <p role="alert" className="text-sm text-danger" data-testid="assign-mentor-load-error">
                Couldn't load active mentors right now.
              </p>
            ) : (
              <Select
                label="Mentor"
                required
                placeholder={isLoading ? "Loading…" : "Select an active mentor"}
                value={mentorId}
                onValueChange={setMentorId}
                disabled={isLoading || mentors.length === 0}
                helperText={
                  !isLoading && mentors.length === 0
                    ? "No active mentors available — add or activate one first."
                    : undefined
                }
                data-testid="assign-mentor-select"
              >
                {mentors.map((mentor) => (
                  <SelectItem key={mentor.id} value={mentor.id}>
                    {mentor.fullName} ({mentor.externalInstitute})
                    {alreadyAssignedMentorIds.includes(mentor.id) ? " · already assigned" : ""}
                  </SelectItem>
                ))}
              </Select>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="assign-mentor-lead"
                checked={isLead}
                onCheckedChange={(checked) => setIsLead(checked === true)}
                data-testid="assign-mentor-lead-checkbox"
              />
              <Label htmlFor="assign-mentor-lead">Make lead mentor for this batch</Label>
            </div>
            <p className="text-xs text-fg-muted">
              A batch may have several mentors, but at most one lead — marking this mentor as lead clears any
              other mentor&apos;s lead flag on this batch.
            </p>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="assign-mentor-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={assignMentor.isPending} disabled={!mentorId} data-testid="assign-mentor-submit">
              Assign
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
