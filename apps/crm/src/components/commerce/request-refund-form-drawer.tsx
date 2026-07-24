// Request refund form — RHF + zod resolver against RequestRefundRequestSchema
// (@repo/types), same pattern as batch-form-drawer.tsx: useForm typed
// loosely, Schema.parse at submit. The picked payment determines the max
// refundable amount server-side (≤ original captured amount) — the client
// does not duplicate that validation beyond requiring amount > 0; the API
// surfaces an over-amount 422 if exceeded (handled via the error toast).
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  MoneyInput,
  useToast,
} from "@repo/ui";
import { RequestRefundRequestSchema, type RequestRefundRequest } from "@repo/types";

import { useRequestRefund } from "../../hooks/use-refunds";

interface RequestRefundFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPaymentId?: string;
}

type RequestRefundFormValues = Omit<RequestRefundRequest, "amountPaise"> & { amountPaise: number };

export function RequestRefundFormDrawer({
  open,
  onOpenChange,
  defaultPaymentId,
}: RequestRefundFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const requestRefund = useRequestRefund();

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<RequestRefundFormValues>({
    defaultValues: { paymentId: defaultPaymentId ?? "", amountPaise: 0, reason: "" },
  });
  const errors = formState.errors;

  React.useEffect(() => {
    if (open) {
      reset({ paymentId: defaultPaymentId ?? "", amountPaise: 0, reason: "" });
    }
  }, [open, defaultPaymentId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body: RequestRefundRequest = RequestRefundRequestSchema.parse({
        paymentId: values.paymentId,
        amountPaise: values.amountPaise,
        reason: values.reason,
      });
      await requestRefund.mutateAsync(body);
      toast({ title: "Refund requested", description: "Pending approval by Finance/Owner/Admin.", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't request refund", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Request refund"
        description="Request a refund against a captured payment. Requires Finance/Owner/Admin approval."
        data-testid="request-refund-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Payment ID"
              required
              placeholder="The captured payment to refund"
              {...register("paymentId")}
              error={errors.paymentId?.message}
              data-testid="request-refund-payment-id"
            />
            <MoneyInput
              label="Refund amount"
              required
              value={watch("amountPaise")}
              onChange={(paise) => setValue("amountPaise", paise)}
              error={errors.amountPaise?.message}
              helperText="Must be greater than zero and no more than the original captured amount."
              data-testid="request-refund-amount"
            />
            <Input
              label="Reason"
              required
              placeholder="Why is this being refunded?"
              {...register("reason")}
              error={errors.reason?.message}
              data-testid="request-refund-reason"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="request-refund-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={requestRefund.isPending} data-testid="request-refund-submit">
              Request refund
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
