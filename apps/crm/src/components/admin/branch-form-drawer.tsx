// Create/Edit branch drawer — RHF + zod resolver against
// CreateBranchRequestSchema/UpdateBranchRequestSchema (@repo/types), same
// pattern as student-form-drawer.tsx.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, Select, SelectItem, useToast } from "@repo/ui";
import {
  CreateBranchRequestSchema,
  UpdateBranchRequestSchema,
  type BranchDetail,
  type BranchStatus,
} from "@repo/types";

type CreateBranchFormValues = z.input<typeof CreateBranchRequestSchema>;
type UpdateBranchFormValues = z.input<typeof UpdateBranchRequestSchema>;

import { useCreateBranch, useUpdateBranch } from "../../hooks/use-branches";
import { surfaceError } from "../../lib/surface-error";

const STATUSES: { value: BranchStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface BranchFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch?: BranchDetail;
}

export function BranchFormDrawer({ open, onOpenChange, branch }: BranchFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(branch);
  const { toast } = useToast();
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();

  const createForm = useForm<CreateBranchFormValues>({
    resolver: zodResolver(CreateBranchRequestSchema),
    defaultValues: { status: "active" },
  });
  const updateForm = useForm<UpdateBranchFormValues>({
    resolver: zodResolver(UpdateBranchRequestSchema),
  });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && branch) {
      updateForm.reset({
        name: branch.name,
        city: branch.city,
        address: branch.address ?? undefined,
        status: branch.status,
      });
    } else {
      createForm.reset({ status: "active" });
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, branch]);

  const isPending = createBranch.isPending || updateBranch.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    try {
      const body = CreateBranchRequestSchema.parse(values);
      await createBranch.mutateAsync(body);
      toast({ title: "Branch created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create branch");
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!branch) return;
    try {
      const body = UpdateBranchRequestSchema.parse(values);
      await updateBranch.mutateAsync({ id: branch.id, body });
      toast({ title: "Branch updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update branch");
    }
  });

  if (isEdit) {
    const { register, formState, watch, setValue } = updateForm;
    const errors = formState.errors;
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit branch" description={branch?.city} data-testid="branch-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input label="Name" required placeholder="e.g. Hyderabad Central" {...register("name")} error={errors.name?.message} data-testid="branch-form-name" />
              <Input label="City" required placeholder="e.g. Hyderabad" {...register("city")} error={errors.city?.message} data-testid="branch-form-city" />
              <Input label="Address" placeholder="e.g. Plot 12, Road No. 3, Banjara Hills" {...register("address")} error={errors.address?.message} data-testid="branch-form-address" />
              <Select
                label="Status"
                required
                placeholder="Select status"
                value={watch("status")}
                onValueChange={(value) => setValue("status", value as BranchStatus, { shouldValidate: true })}
                error={errors.status?.message}
                data-testid="branch-form-status"
              >
                {STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="branch-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="branch-form-submit">
                Save changes
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    );
  }

  const { register, formState, watch, setValue } = createForm;
  const errors = formState.errors;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title="Add branch" description="Creates a new branch location." data-testid="branch-create-drawer">
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required placeholder="e.g. Hyderabad Central" {...register("name")} error={errors.name?.message} data-testid="branch-form-name" />
            <Input label="City" required placeholder="e.g. Hyderabad" {...register("city")} error={errors.city?.message} data-testid="branch-form-city" />
            <Input label="Address" placeholder="e.g. Plot 12, Road No. 3, Banjara Hills" {...register("address")} error={errors.address?.message} data-testid="branch-form-address" />
            <Select
              label="Status"
              required
              placeholder="Select status"
              value={watch("status")}
              onValueChange={(value) => setValue("status", value as BranchStatus, { shouldValidate: true })}
              error={errors.status?.message}
              data-testid="branch-form-status"
            >
              {STATUSES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="branch-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="branch-form-submit">
              Create branch
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
