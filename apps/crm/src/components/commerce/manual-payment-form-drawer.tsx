// Manual/offline payment entry — Finance-gated (docs/03 §7.6 "manual/offline
// payment entry"). Records a cash/NEFT/cheque payment against an EXISTING
// order (the order must be in `created` status server-side). RHF + zod
// resolver against ManualPaymentRequestSchema, same pattern as
// batch-form-drawer.tsx: `useForm` typed loosely, `Schema.parse` at submit.
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
import { ManualPaymentRequestSchema, type ManualPaymentRequest } from "@repo/types";

import { useRecordManualPayment } from "../../hooks/use-payments";

interface ManualPaymentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the order id, e.g. when launched from an order detail context. */
  defaultOrderId?: string;
  /** Pre-fill the amount (integer paise), e.g. the order's outstanding total. */
  defaultAmountPaise?: number;
}

type ManualPaymentFormValues = Omit<ManualPaymentRequest, "amountPaise" | "paidAt"> & {
  amountPaise: number;
  paidAt?: string;
};

export function ManualPaymentFormDrawer({
  open,
  onOpenChange,
  defaultOrderId,
  defaultAmountPaise,
}: ManualPaymentFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const recordManual = useRecordManualPayment();

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<ManualPaymentFormValues>({
    defaultValues: { orderId: defaultOrderId ?? "", amountPaise: defaultAmountPaise ?? 0, method: "", reference: "" },
  });
  const errors = formState.errors;

  React.useEffect(() => {
    if (open) {
      reset({ orderId: defaultOrderId ?? "", amountPaise: defaultAmountPaise ?? 0, method: "", reference: "" });
    }
  }, [open, defaultOrderId, defaultAmountPaise, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body: ManualPaymentRequest = ManualPaymentRequestSchema.parse({
        orderId: values.orderId,
        amountPaise: values.amountPaise,
        method: values.method,
        reference: values.reference,
        paidAt: values.paidAt ? new Date(values.paidAt).toISOString() : undefined,
        notes: values.notes || undefined,
      });
      await recordManual.mutateAsync(body);
      toast({ title: "Payment recorded", description: "The manual payment was added to the ledger.", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't record payment", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Record manual payment"
        description="Record an offline payment (cash, NEFT, cheque) against an existing order."
        data-testid="manual-payment-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Order ID"
              required
              placeholder="The order this payment settles"
              {...register("orderId")}
              error={errors.orderId?.message}
              data-testid="manual-payment-order-id"
            />
            <MoneyInput
              label="Amount received"
              required
              value={watch("amountPaise")}
              onChange={(paise) => setValue("amountPaise", paise)}
              error={errors.amountPaise?.message}
              data-testid="manual-payment-amount"
            />
            <Input
              label="Method"
              required
              placeholder="cash / NEFT / cheque"
              {...register("method")}
              error={errors.method?.message}
              data-testid="manual-payment-method"
            />
            <Input
              label="Reference"
              required
              placeholder="Transaction / receipt / cheque number"
              {...register("reference")}
              error={errors.reference?.message}
              data-testid="manual-payment-reference"
            />
            <Input
              label="Paid at"
              type="datetime-local"
              placeholder="e.g. 2026-07-09T10:30"
              helperText="Leave blank to use now."
              {...register("paidAt")}
              data-testid="manual-payment-paid-at"
            />
            <Input
              label="Notes"
              placeholder="Optional staff notes"
              {...register("notes")}
              data-testid="manual-payment-notes"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="manual-payment-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={recordManual.isPending} data-testid="manual-payment-submit">
              Record payment
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
