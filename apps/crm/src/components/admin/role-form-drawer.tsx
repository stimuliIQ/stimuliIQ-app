// Create/Edit role drawer — RHF + zod resolver against
// CreateRoleRequestSchema/UpdateRoleRequestSchema (@repo/types). `key` is
// immutable once created (only set at creation time) and `isSystem` roles
// cannot be renamed — the server enforces this; here we just disable the
// name field as a UX guide (CLAUDE.md §3.5 — never relied on for security).
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, useToast } from "@repo/ui";
import { CreateRoleRequestSchema, UpdateRoleRequestSchema, type Role } from "@repo/types";

type CreateRoleFormValues = z.input<typeof CreateRoleRequestSchema>;
type UpdateRoleFormValues = z.input<typeof UpdateRoleRequestSchema>;

import { useCreateRole, useUpdateRole } from "../../hooks/use-roles";
import { surfaceError } from "../../lib/surface-error";

interface RoleFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  /**
   * Called with the freshly-created role after a successful create. The parent
   * uses this to immediately open the new role's permission matrix — a brand-new
   * role has zero grants, so "create" is only step one of "set up a role".
   */
  onCreated?: (role: Role) => void;
}

export function RoleFormDrawer({ open, onOpenChange, role, onCreated }: RoleFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(role);
  const { toast } = useToast();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const createForm = useForm<CreateRoleFormValues>({ resolver: zodResolver(CreateRoleRequestSchema) });
  const updateForm = useForm<UpdateRoleFormValues>({ resolver: zodResolver(UpdateRoleRequestSchema) });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && role) {
      updateForm.reset({ name: role.name });
    } else {
      createForm.reset({ key: "", name: "" });
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, role]);

  const isPending = createRole.isPending || updateRole.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    try {
      const body = CreateRoleRequestSchema.parse(values);
      const created = await createRole.mutateAsync(body);
      toast({ title: "Role created", description: "Now grant its permissions below.", variant: "success" });
      onOpenChange(false);
      onCreated?.(created);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create role");
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!role) return;
    try {
      const body = UpdateRoleRequestSchema.parse(values);
      await updateRole.mutateAsync({ id: role.id, body });
      toast({ title: "Role updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update role");
    }
  });

  if (isEdit) {
    const { register, formState } = updateForm;
    const errors = formState.errors;
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit role" description={role?.key} data-testid="role-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input
                label="Name"
                required
                placeholder="e.g. Senior Counsellor"
                disabled={role?.isSystem}
                helperText={role?.isSystem ? "System role names can't be changed." : undefined}
                {...register("name")}
                error={errors.name?.message}
                data-testid="role-form-name"
              />
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="role-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} disabled={role?.isSystem} data-testid="role-form-submit">
                Save changes
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    );
  }

  const { register, formState } = createForm;
  const errors = formState.errors;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title="Add role" description="Creates a new custom role with no permissions granted yet." data-testid="role-create-drawer">
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Key"
              required
              placeholder="e.g. senior_counsellor"
              helperText="Lowercase snake_case, e.g. branch_manager. Cannot be changed later."
              {...register("key")}
              error={errors.key?.message}
              data-testid="role-form-key"
            />
            <Input label="Name" required placeholder="e.g. Senior Counsellor" {...register("name")} error={errors.name?.message} data-testid="role-form-name" />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="role-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="role-form-submit">
              Create role
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
