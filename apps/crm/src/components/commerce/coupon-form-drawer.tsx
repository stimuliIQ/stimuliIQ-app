// Create/Edit coupon drawer — RHF + zod resolver against
// CreateCouponRequestSchema/UpdateCouponRequestSchema (@repo/types), same
// pattern as batch-form-drawer.tsx. `code` and `type` are immutable after
// creation (the API contract forbids changing them) — the edit form disables
// those two fields and only submits the UpdateCouponRequest shape.
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Input,
  MoneyInput,
  Select,
  SelectItem,
  Skeleton,
  useToast,
} from "@repo/ui";
import {
  CreateCouponRequestSchema,
  UpdateCouponRequestSchema,
  type CouponStatus,
  type CouponType,
  type CreateCouponRequest,
  type UpdateCouponRequest,
} from "@repo/types";

import { useCoupon, useCreateCoupon, useUpdateCoupon } from "../../hooks/use-coupons";
import { queryErrorMessage } from "../../lib/surface-error";

const TYPE_OPTIONS: { value: CouponType; label: string }[] = [
  { value: "pct", label: "Percentage" },
  { value: "flat", label: "Flat (₹)" },
];

const STATUS_OPTIONS: { value: CouponStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
];

interface CouponFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit mode — fetches the coupon and pre-fills the form. */
  couponId?: string;
}

interface CouponFormValues {
  code: string;
  type: CouponType;
  pctValue?: number;
  flatValuePaise: number;
  maxUses?: number;
  validFrom?: string;
  validTo?: string;
  status: CouponStatus;
}

export function CouponFormDrawer({ open, onOpenChange, couponId }: CouponFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(couponId);
  const { toast } = useToast();
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const { data: coupon, isLoading, isError, error, refetch } = useCoupon(couponId);

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<CouponFormValues>({
    defaultValues: { type: "pct", flatValuePaise: 0, status: "active" },
  });
  const errors = formState.errors;

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && coupon) {
      reset({
        code: coupon.code,
        type: coupon.type,
        pctValue: coupon.type === "pct" ? coupon.value : undefined,
        flatValuePaise: coupon.type === "flat" ? coupon.value : 0,
        maxUses: coupon.maxUses ?? undefined,
        validFrom: coupon.validFrom ? coupon.validFrom.slice(0, 10) : undefined,
        validTo: coupon.validTo ? coupon.validTo.slice(0, 10) : undefined,
        status: coupon.status,
      });
    } else if (!isEdit) {
      reset({ type: "pct", flatValuePaise: 0, status: "active" });
    }
  }, [open, isEdit, coupon, reset]);

  const isPending = createCoupon.isPending || updateCoupon.isPending;
  const watchedType = watch("type");

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && couponId) {
        const body: UpdateCouponRequest = UpdateCouponRequestSchema.parse({
          maxUses: values.maxUses || undefined,
          validFrom: values.validFrom ? new Date(values.validFrom).toISOString() : undefined,
          validTo: values.validTo ? new Date(values.validTo).toISOString() : undefined,
          status: values.status,
        });
        await updateCoupon.mutateAsync({ id: couponId, body });
        toast({ title: "Coupon updated", variant: "success" });
      } else {
        const value = values.type === "pct" ? values.pctValue ?? 0 : values.flatValuePaise;
        const body: CreateCouponRequest = CreateCouponRequestSchema.parse({
          code: values.code.toUpperCase(),
          type: values.type,
          value,
          maxUses: values.maxUses || undefined,
          validFrom: values.validFrom ? new Date(values.validFrom).toISOString() : undefined,
          validTo: values.validTo ? new Date(values.validTo).toISOString() : undefined,
          status: values.status,
        });
        await createCoupon.mutateAsync(body);
        toast({ title: "Coupon created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      const description = queryErrorMessage(error);
      toast({ title: isEdit ? "Couldn't update coupon" : "Couldn't create coupon", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? "Edit coupon" : "Add coupon"}
        description={isEdit ? coupon?.code : "Create a percentage or flat discount code."}
        data-testid={isEdit ? "coupon-edit-drawer" : "coupon-create-drawer"}
      >
        {isEdit && isLoading ? (
          <DrawerBody>
            <div className="flex flex-col gap-3" data-testid="coupon-form-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
            </div>
          </DrawerBody>
        ) : isEdit && isError ? (
          <DrawerBody>
            <EmptyState
              data-testid="coupon-form-error"
              title="Couldn't load this coupon"
              description={queryErrorMessage(error, "Something went wrong fetching the coupon details.")}
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="coupon-form-retry">
                  Try again
                </Button>
              }
            />
          </DrawerBody>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input
                label="Code"
                required
                disabled={isEdit}
                placeholder="SUMMER20"
                helperText={isEdit ? "Code cannot be changed after creation." : "Uppercase alphanumeric + _ / -"}
                {...register("code")}
                error={errors.code?.message}
                data-testid="coupon-form-code"
              />
              <Select
                label="Type"
                required
                disabled={isEdit}
                value={watch("type")}
                onValueChange={(value) => setValue("type", value as CouponType)}
                helperText={isEdit ? "Type cannot be changed after creation." : undefined}
                data-testid="coupon-form-type"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
              {watchedType === "pct" ? (
                <Input
                  label="Percentage value"
                  type="number"
                  min={1}
                  max={100}
                  required
                  disabled={isEdit}
                  placeholder="e.g. 20"
                  helperText="Integer percent points, 1-100."
                  {...register("pctValue", { valueAsNumber: true })}
                  error={errors.pctValue?.message}
                  data-testid="coupon-form-pct-value"
                />
              ) : (
                <MoneyInput
                  label="Flat discount amount"
                  required
                  disabled={isEdit}
                  value={watch("flatValuePaise")}
                  onChange={(paise) => setValue("flatValuePaise", paise)}
                  data-testid="coupon-form-flat-value"
                />
              )}
              <Input
                label="Max uses"
                type="number"
                min={1}
                placeholder="e.g. 500"
                helperText="Leave blank for unlimited redemptions."
                {...register("maxUses", { valueAsNumber: true })}
                error={errors.maxUses?.message}
                data-testid="coupon-form-max-uses"
              />
              <Input
                label="Valid from"
                type="date"
                helperText="Leave blank to be valid immediately."
                {...register("validFrom")}
                data-testid="coupon-form-valid-from"
              />
              <Input
                label="Valid to"
                type="date"
                helperText="Leave blank for no expiry."
                {...register("validTo")}
                data-testid="coupon-form-valid-to"
              />
              <Select
                label="Status"
                required
                value={watch("status")}
                onValueChange={(value) => setValue("status", value as CouponStatus)}
                error={errors.status?.message}
                data-testid="coupon-form-status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="coupon-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="coupon-form-submit">
                {isEdit ? "Save changes" : "Create coupon"}
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
