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
import { useTeamsList } from "../../hooks/use-org";
import { useAllBranches } from "../../hooks/use-branches";
import { surfaceError } from "../../lib/surface-error";
import { useMe } from "../../hooks/use-me";
import { hasPermission } from "../../lib/permissions";
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

/**
 * Where this person sits: their team, and the branch their role assignments are posted to.
 *
 * One component used by BOTH the create and edit forms, because the two drifting apart is
 * how you get a field that can be set on creation and never changed again.
 *
 * BRANCH IS NOT COSMETIC. `user_roles.branch_id` has existed since Phase 0 and nothing ever
 * wrote it, so a branch_manager created through this form had no branches and every
 * branch-scoped query returned zero rows — the role was unusable without a hand-edit in the
 * database. This picker is what finally writes it.
 */
function PlacementFields({
  teamId,
  branchId,
  onTeamChange,
  onBranchChange,
}: {
  teamId: string;
  branchId: string;
  onTeamChange: (value: string) => void;
  onBranchChange: (value: string) => void;
}): React.JSX.Element {
  const { data: teams } = useTeamsList({ page: 1, pageSize: 100, active: true });
  const { data: branches } = useAllBranches();

  return (
    <>
      <Select
        label="Team"
        value={teamId}
        onValueChange={onTeamChange}
        helperText="Decides who approves their leave: their team lead, then their manager."
        data-testid="user-form-team"
      >
        {/* A real option rather than a blank, so "not on the org chart yet" is a choice
            somebody made instead of a field they skipped. Their leave goes to HR. */}
        <SelectItem value={NO_PLACEMENT}>No team yet</SelectItem>
        {(teams?.items ?? []).map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </Select>
      <Select
        label="Branch"
        value={branchId}
        onValueChange={onBranchChange}
        helperText="The centre their role applies to. Branch-scoped roles see only their own branch."
        data-testid="user-form-branch"
      >
        <SelectItem value={NO_PLACEMENT}>All branches</SelectItem>
        {(branches?.items ?? []).map((branch) => (
          <SelectItem key={branch.id} value={branch.id}>
            {branch.name}
          </SelectItem>
        ))}
      </Select>
    </>
  );
}

/** The picker's "none" value. A real string, because a Select cannot hold null. */
const NO_PLACEMENT = "__none__";
export function UserFormDrawer({ open, onOpenChange, user }: UserFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(user);
  const { toast } = useToast();
  const createUser = useCreateStaffUser();
  const updateUser = useUpdateStaffUser();
  const { me } = useMe();
  const canSetPassword = hasPermission(me?.permissions, "users.reset_password");

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
        teamId: user.teamId ?? null,
        branchId: user.branchId ?? null,
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
              <PlacementFields
                teamId={(watch("teamId") as string | null | undefined) ?? NO_PLACEMENT}
                branchId={(watch("branchId") as string | null | undefined) ?? NO_PLACEMENT}
                onTeamChange={(value) =>
                  setValue("teamId", value === NO_PLACEMENT ? null : value, { shouldValidate: true })
                }
                onBranchChange={(value) =>
                  setValue("branchId", value === NO_PLACEMENT ? null : value, { shouldValidate: true })
                }
              />
              {/* Only rendered for whoever holds `users.reset_password`. Setting a
                  colleague's credential is the same authority as the dedicated reset
                  route, which is seeded for super_admin alone — the API refuses a
                  `password` on this PATCH without that key, so showing the field to an
                  admin would be an affordance that can only 403. */}
              {canSetPassword ? (
                <PasswordInput
                  label="Set new password"
                  placeholder="Leave empty to keep the current password"
                  autoComplete="new-password"
                  helperText="Min 10 characters. Setting a new password signs the user out everywhere."
                  {...register("password")}
                  error={errors.password?.message}
                  data-testid="user-form-password"
                />
              ) : null}
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
              helperText="Min 10 characters. They can change it later from their account menu."
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
            <PlacementFields
              teamId={(watch("teamId") as string | null | undefined) ?? NO_PLACEMENT}
              branchId={(watch("branchId") as string | null | undefined) ?? NO_PLACEMENT}
              onTeamChange={(value) =>
                setValue("teamId", value === NO_PLACEMENT ? null : value, { shouldValidate: true })
              }
              onBranchChange={(value) =>
                setValue("branchId", value === NO_PLACEMENT ? null : value, { shouldValidate: true })
              }
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
