// Add-program dialog (Student 360) — assigns another program to an existing
// student by opening a commerce ORDER for a program + batch (the same path the
// convert-lead flow uses). On payment (Razorpay or manual entry) the order's
// webhook/manual-capture seam creates the enrollment, so the student's derived
// lifecycle stage moves program_assigned → payment_pending → active_student
// without any duplicate student record.
import * as React from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  formatPaise,
  useToast,
} from "@repo/ui";
import { ApiError } from "@repo/api-client";

import { useCreateOrder } from "../../hooks/use-orders";
import { useProgramsList } from "../../hooks/use-courses";
import { useBatchesList } from "../../hooks/use-batches";

interface AddProgramDialogProps {
  studentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProgramDialog({ studentId, open, onOpenChange }: AddProgramDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const createOrder = useCreateOrder();

  const [programId, setProgramId] = React.useState<string>("");
  const [batchId, setBatchId] = React.useState<string>("");
  const [couponCode, setCouponCode] = React.useState<string>("");

  React.useEffect(() => {
    if (open) {
      setProgramId("");
      setBatchId("");
      setCouponCode("");
    }
  }, [open]);

  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: batchesData } = useBatchesList({
    programId: programId || undefined,
    page: 1,
    pageSize: programId ? 100 : 1,
    includeDeleted: false,
    // Server-side: never offer a batch that has finished or been archived. Filtering
    // here rather than over `batches` below also keeps the page of 100 full of usable
    // options instead of padding it with closed ones.
    enrollable: true,
  });
  const programs = programsData?.items ?? [];
  const batches = programId ? (batchesData?.items ?? []) : [];
  const selectedProgram = programs.find((p) => p.id === programId);

  const submit = async () => {
    try {
      await createOrder.mutateAsync({
        studentId,
        programId,
        batchId,
        couponCode: couponCode || undefined,
      });
      toast({
        title: "Program assigned",
        description: "An order was opened. Record the payment to activate the enrollment.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't assign program",
        description: error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Add program"
        description="Opens an order for the chosen program + batch. The enrollment activates when payment is recorded."
        data-testid="add-program-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          <Select
            label="Program"
            placeholder="Select program"
            required
            value={programId}
            onValueChange={(value) => {
              setProgramId(value);
              setBatchId("");
            }}
            data-testid="add-program-program"
          >
            {programs.map((program) => (
              <SelectItem key={program.id} value={program.id}>
                {program.title}
              </SelectItem>
            ))}
          </Select>
          {programId ? (
            <Select
              label="Batch"
              placeholder="Select batch"
              required
              value={batchId}
              onValueChange={setBatchId}
              helperText="Seat availability is shown per batch. The student is enrolled into this batch when payment completes."
              data-testid="add-program-batch"
            >
              {batches.map((batch) => {
                const seatsLeft = Math.max(0, batch.capacity - batch.enrolledCount);
                const availability = seatsLeft > 0 ? `${seatsLeft} of ${batch.capacity} seats left` : "Full";
                return (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.name}, {availability}
                  </SelectItem>
                );
              })}
            </Select>
          ) : null}
          {selectedProgram?.pricePaise != null ? (
            <p className="text-sm text-fg-muted" data-testid="add-program-price">
              Package price: <span className="font-medium text-fg">{formatPaise(selectedProgram.pricePaise)}</span>
              {couponCode ? " (before coupon)" : ""}
            </p>
          ) : null}
          <Input
            label="Coupon code (optional)"
            placeholder="e.g. OFFER6000"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            data-testid="add-program-coupon"
          />
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} data-testid="add-program-cancel">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!programId || !batchId}
            loading={createOrder.isPending}
            data-testid="add-program-submit"
          >
            Assign program
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
