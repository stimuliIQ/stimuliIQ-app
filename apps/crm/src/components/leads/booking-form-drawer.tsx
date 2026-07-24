// Create-booking drawer — RHF + zod resolver against
// CreateBookingRequestSchema (@repo/types). Mirrors lead-form-drawer.tsx.
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, useToast } from "@repo/ui";
import { CreateBookingRequestSchema, type CreateBookingRequest } from "@repo/types";

import { useCreateBooking } from "../../hooks/use-bookings";
import { useProgramsList } from "../../hooks/use-courses";
import { surfaceError } from "../../lib/surface-error";

interface BookingFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BookingFormValues {
  leadId?: string;
  programId?: string;
  slotAt: string;
  source: string;
  notes?: string;
}

export function BookingFormDrawer({ open, onOpenChange }: BookingFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createBooking = useCreateBooking();
  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<BookingFormValues>({
    defaultValues: { source: "crm" },
  });
  const errors = formState.errors;

  React.useEffect(() => {
    if (open) reset({ source: "crm" });
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body: CreateBookingRequest = CreateBookingRequestSchema.parse({
        leadId: values.leadId || undefined,
        programId: values.programId || undefined,
        slotAt: new Date(values.slotAt).toISOString(),
        source: values.source,
        notes: values.notes || undefined,
      });
      await createBooking.mutateAsync(body);
      toast({ title: "Booking created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create booking");
    }
  });

  const programs = programsData?.items ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title="Add booking" description="Schedule a demo/slot booking." data-testid="booking-create-drawer">
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Lead id (optional)"
              placeholder="Paste the lead ID"
              helperText="Paste a lead id to link this booking, or leave blank."
              {...register("leadId")}
              data-testid="booking-form-lead-id"
            />
            <Select
              label="Program (optional)"
              placeholder="Not specified"
              value={watch("programId")}
              onValueChange={(value) => setValue("programId", value === "__none__" ? undefined : value)}
              data-testid="booking-form-program"
            >
              <SelectItem value="__none__">Not specified</SelectItem>
              {programs.map((program) => (
                <SelectItem key={program.id} value={program.id}>
                  {program.title}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Slot"
              type="datetime-local"
              required
              {...register("slotAt", { required: true })}
              error={errors.slotAt ? "Required" : undefined}
              data-testid="booking-form-slot"
            />
            <Input
              label="Source"
              required
              placeholder="crm, walk-in, referral…"
              {...register("source", { required: true })}
              error={errors.source ? "Required" : undefined}
              data-testid="booking-form-source"
            />
            <Input
              label="Notes"
              placeholder="Add any notes about this booking…"
              {...register("notes")}
              data-testid="booking-form-notes"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="booking-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={createBooking.isPending} data-testid="booking-form-submit">
              Create booking
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
