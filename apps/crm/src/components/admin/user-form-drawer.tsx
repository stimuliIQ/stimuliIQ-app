// Create/Edit staff-user drawer — RHF + zod resolver against
// CreateStaffUserRequestSchema/UpdateStaffUserRequestSchema (@repo/types), same
// pattern as branch-form-drawer.tsx. Roles are a checkbox list sourced from the
// live roles list (student role is filtered out — student accounts are owned by
// the enrollment flow and rejected server-side anyway).
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Label,
  PasswordInput,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import {
  CreateStaffUserRequestSchema,
  UpdateStaffUserRequestSchema,
  type StaffUser,
  type StaffUserStatus,
} from "@repo/types";

import { useRolesList } from "../../hooks/use-roles";
import { useCreateStaffUser, useUpdateStaffUser } from "../../hooks/use-staff-users";
import { surfaceError } from "../../lib/surface-error";
import {
  optionalE164Phone,
  phoneFieldProps,
  requireLocalPhones,
  toLocalPhoneDigits,
} from "../../lib/phone-field";

const PHONE_FIELDS = ["phone"] as const;

type CreateFormValues = z.input<typeof CreateStaffUserRequestSchema>;
type UpdateFormValues = z.input<typeof UpdateStaffUserRequestSchema>;

const STATUSES: { value: StaffUserStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended (login blocked)" },
  { value: "deactivated", label: "Deactivated (login blocked)" },
];

function RolesChecklist({
  selected,
  onToggle,
  error,
}: {
  selected: string[];
  onToggle: (roleId: string, checked: boolean) => void;
  error?: string;
}): React.JSX.Element {
  const { data, isLoading } = useRolesList({ page: 1, pageSize: 100 });
  const roles = (data?.items ?? []).filter((role) => role.key !== "student");
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Roles<span aria-hidden="true" className="text-danger"> *</span>
      </Label>
      <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="user-form-roles">
        {isLoading ? <p className="text-sm text-fg-muted">Loading roles…</p> : null}
        {roles.map((role) => (
          <label key={role.id} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
            <Checkbox
              checked={selected.includes(role.id)}
              onCheckedChange={(checked) => onToggle(role.id, checked === true)}
              data-testid={`user-form-role-${role.key}`}
            />
            {role.name}
          </label>
        ))}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

interface UserFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present the drawer edits this user; otherwise it creates one. */
  user?: StaffUser;
}

export function UserFormDrawer({ open, onOpenChange, user }: UserFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(user);
  const { toast } = useToast();
  const createUser = useCreateStaffUser();
  const updateUser = useUpdateStaffUser();

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(requireLocalPhones(CreateStaffUserRequestSchema, PHONE_FIELDS)),
    defaultValues: { roleIds: [] },
  });
  const updateForm = useForm<UpdateFormValues>({
    resolver: zodResolver(requireLocalPhones(UpdateStaffUserRequestSchema, PHONE_FIELDS)),
  });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && user) {
      updateForm.reset({
        name: user.name,
        phone: toLocalPhoneDigits(user.phone) || undefined,
        status: user.status,
        roleIds: user.roles.map((role) => role.id),
        password: undefined,
      });
    } else {
      createForm.reset({ name: "", email: "", password: "", roleIds: [] });
    }
    // Reset only on open/identity change, not every render.
  }, [open, isEdit, user]);

  const isPending = createUser.isPending || updateUser.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    try {
      const body = CreateStaffUserRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
      });
      await createUser.mutateAsync(body);
      toast({ title: "User created", description: "Share the email and password with them securely.", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create this user");
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!user) return;
    try {
      const body = UpdateStaffUserRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        // Empty password field = "don't change the password".
        password: values.password || undefined,
      });
      await updateUser.mutateAsync({ id: user.id, body });
      toast({ title: "User updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this user");
    }
  });

  if (isEdit && user) {
    const { register, formState, watch, setValue } = updateForm;
    const errors = formState.errors;
    const selectedRoles = (watch("roleIds") ?? []) as string[];
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit user" description={user.email} data-testid="user-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input label="Name" required {...register("name")} error={errors.name?.message} data-testid="user-form-name" />
              <Input label="Email" value={user.email} disabled helperText="Email is the login identity and cannot be changed." data-testid="user-form-email" />
              <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="user-form-phone" />
              <Select
                label="Status"
                required
                value={watch("status")}
                onValueChange={(value) => setValue("status", value as StaffUserStatus, { shouldValidate: true })}
                error={errors.status?.message}
                data-testid="user-form-status"
              >
                {STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
              <RolesChecklist
                selected={selectedRoles}
                onToggle={(roleId, checked) =>
                  setValue(
                    "roleIds",
                    checked ? [...selectedRoles, roleId] : selectedRoles.filter((id) => id !== roleId),
                    { shouldValidate: true },
                  )
                }
                error={errors.roleIds?.message as string | undefined}
              />
              <PasswordInput
                label="Set new password"
                placeholder="Leave empty to keep the current password"
                autoComplete="new-password"
                helperText="Min 10 characters. Setting a new password signs the user out everywhere."
                {...register("password")}
                error={errors.password?.message}
                data-testid="user-form-password"
              />
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="user-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="user-form-submit">
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
  const selectedRoles = (watch("roleIds") ?? []) as string[];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title="Add user"
        description="Creates a staff login for the CRM. Share the credentials with them securely."
        data-testid="user-create-drawer"
      >
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required placeholder="e.g. Priya Sharma" {...register("name")} error={errors.name?.message} data-testid="user-form-name" />
            <Input label="Email" required type="email" placeholder="e.g. priya@stimuliiq.com" {...register("email")} error={errors.email?.message} data-testid="user-form-email" />
            <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="user-form-phone" />
            <PasswordInput
              label="Password"
              required
              autoComplete="new-password"
              helperText="Min 10 characters — they can change it later from their account menu."
              {...register("password")}
              error={errors.password?.message}
              data-testid="user-form-password"
            />
            <RolesChecklist
              selected={selectedRoles}
              onToggle={(roleId, checked) =>
                setValue(
                  "roleIds",
                  checked ? [...selectedRoles, roleId] : selectedRoles.filter((id) => id !== roleId),
                  { shouldValidate: true },
                )
              }
              error={errors.roleIds?.message as string | undefined}
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="user-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="user-form-submit">
              Create user
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
