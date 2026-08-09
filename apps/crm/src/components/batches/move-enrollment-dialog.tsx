// Move-enrollment dialog — pick a destination batch and move a roster
// entry there (docs/03 §7.5). Destination batch list excludes the current
// batch; uses use-batches.ts list query directly (read-only picker data).
import * as React from "react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Select, SelectItem, useToast } from "@repo/ui";

import { useBatchesList } from "../../hooks/use-batches";
import { useMoveEnrollment } from "../../hooks/use-enrollments";

interface MoveEnrollmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentId: string | null;
  fromBatchId: string;
  studentName?: string;
}

export function MoveEnrollmentDialog({
  open,
  onOpenChange,
  enrollmentId,
  fromBatchId,
  studentName,
}: MoveEnrollmentDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const [toBatchId, setToBatchId] = React.useState<string | undefined>(undefined);
  const moveEnrollment = useMoveEnrollment();

  // `enrollable` — moving a student INTO a finished batch is the same mistake as
  // enrolling them into one, so the destination list excludes closed/expired batches
  // (the batch being moved OUT of is filtered separately, below).
  const { data, isLoading } = useBatchesList({ page: 1, pageSize: 200, includeDeleted: false, enrollable: true });

  React.useEffect(() => {
    if (!open) setToBatchId(undefined);
  }, [open]);

  const destinations = (data?.items ?? []).filter((batch) => batch.id !== fromBatchId);

  const handleMove = async () => {
    if (!enrollmentId || !toBatchId) return;
    try {
      await moveEnrollment.mutateAsync({ id: enrollmentId, body: { toBatchId }, fromBatchId });
      toast({ title: "Enrollment moved", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't move enrollment", description, variant: "destructive" });
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Move enrollment"
        description={studentName ? `Move ${studentName} to a different batch.` : "Move this enrollment to a different batch."}
        size="sm"
        data-testid="move-enrollment-dialog"
      >
        <DrawerBody className="flex flex-col gap-4">
          <Select
            label="Destination batch"
            required
            placeholder={isLoading ? "Loading batches…" : "Select a batch"}
            value={toBatchId}
            onValueChange={setToBatchId}
            disabled={isLoading}
            data-testid="move-enrollment-destination"
          >
            {destinations.map((batch) => (
              <SelectItem key={batch.id} value={batch.id}>
                {batch.name} — {batch.programTitle}
              </SelectItem>
            ))}
          </Select>
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="move-enrollment-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleMove}
            disabled={!toBatchId}
            loading={moveEnrollment.isPending}
            data-testid="move-enrollment-confirm"
          >
            Move
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
