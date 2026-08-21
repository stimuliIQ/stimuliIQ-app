// Create an EMI plan against an order — server computes the installment
// schedule (CLAUDE.md §3.6: money is integer paise). Phase 9 Completion
// T24/T39.
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, MoneyInput, Select, SelectItem, useToast } from "@repo/ui";
import { CreateEmiPlanRequestSchema, type CreateEmiPlanRequest } from "@repo/types";
import type { z } from "zod";

import { useCreateEmiPlan } from "../../hooks/use-emi-plans";
import { useOrdersList } from "../../hooks/use-orders";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { surfaceError } from "../../lib/surface-error";

interface EmiPlanFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Use the zod input type so zodResolver doesn't cause a resolver mismatch —
// `currency` has `.default("INR")`, making it optional in the input shape
// (mirrors issue-certificate-dialog.tsx's `overrideEligibility` pattern).
type EmiPlanFormValues = z.input<typeof CreateEmiPlanRequestSchema>;

export function EmiPlanFormDrawer({ open, onOpenChange }: EmiPlanFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createEmiPlan = useCreateEmiPlan();
  const [orderSearch, setOrderSearch] = React.useState("");
  const debouncedOrderSearch = useDebouncedValue(orderSearch);
  const { data: orders } = useOrdersList({ page: 1, pageSize: 20, search: debouncedOrderSearch || undefined, status: "paid" });

  const {
    handleSubmit,
    reset,
    register,
    control,
    formState: { errors },
  } = useForm<EmiPlanFormValues>({
    resolver: zodResolver(CreateEmiPlanRequestSchema),
    defaultValues: { orderId: "", totalAmountPaise: 0, currency: "INR", numInstallments: 3, startDate: "" },
  });

  React.useEffect(() => {
    if (open) reset({ orderId: "", totalAmountPaise: 0, currency: "INR", numInstallments: 3, startDate: "" });
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createEmiPlan.mutateAsync(values as unknown as CreateEmiPlanRequest);
      toast({ title: "EMI plan created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create this EMI plan");
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title="Create EMI plan" size="md" data-testid="emi-plan-form-drawer">
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Search order"
              placeholder="Student name / email / order id"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              data-testid="emi-plan-order-search"
            />
            <Controller
              control={control}
              name="orderId"
              render={({ field }) => (
                <Select
                  label="Order"
                  required
                  placeholder="Select a paid order"
                  value={field.value}
                  onValueChange={field.onChange}
                  error={errors.orderId?.message}
                  data-testid="emi-plan-order-select"
                >
                  {(orders?.items ?? []).map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.studentName}, {order.programTitle}
                    </SelectItem>
                  ))}
                </Select>
              )}
            />

            <Controller
              control={control}
              name="totalAmountPaise"
              render={({ field }) => (
                <MoneyInput
                  label="Total amount"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.totalAmountPaise?.message}
                  data-testid="emi-plan-amount-input"
                />
              )}
            />

            <Input
              label="Number of installments"
              type="number"
              min={2}
              max={24}
              required
              placeholder="e.g. 6"
              {...register("numInstallments", { valueAsNumber: true })}
              error={errors.numInstallments?.message}
              data-testid="emi-plan-installments-input"
            />

            <Input
              label="Start date"
              type="date"
              required
              {...register("startDate")}
              error={errors.startDate?.message}
              data-testid="emi-plan-start-date-input"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={createEmiPlan.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createEmiPlan.isPending} data-testid="emi-plan-form-submit">
              Create plan
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
