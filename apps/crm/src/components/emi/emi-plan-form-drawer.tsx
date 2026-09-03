// Create an EMI plan against an order — server computes the installment
// schedule (CLAUDE.md §3.6: money is integer paise). Phase 9 Completion
// T24/T39.
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, formatPaise, useToast } from "@repo/ui";
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
    watch,
    formState: { errors },
  } = useForm<EmiPlanFormValues>({
    resolver: zodResolver(CreateEmiPlanRequestSchema),
    defaultValues: { orderId: "", numInstallments: 3, startDate: "" },
  });

  React.useEffect(() => {
    if (open) reset({ orderId: "", numInstallments: 3, startDate: "" });
  }, [open, reset]);

  const selectedOrderId = watch("orderId");
  const selectedOrder = (orders?.items ?? []).find((order) => order.id === selectedOrderId);

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

            {/* The total is the ORDER's, shown rather than asked for. This was a
                free-text MoneyInput a staff member typed, and whatever they typed became
                the schedule the payment provider actually charges — a slip of the
                keyboard collected the wrong amount while the order row still read
                correctly. The API no longer accepts the field at all. */}
            <div data-testid="emi-plan-amount">
              <span className="block text-sm font-medium text-fg">Total to split</span>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg">
                {selectedOrder ? formatPaise(selectedOrder.amountPaise) : "—"}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {selectedOrder
                  ? "Taken from the order. An EMI plan splits what is owed, it cannot change it."
                  : "Select an order to see the amount."}
              </p>
            </div>

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
