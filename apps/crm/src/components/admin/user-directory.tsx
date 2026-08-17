// Admin ▸ Users — staff-account credential management directory.
// Server-paginated DataTable over hooks/use-staff-users.ts, mirroring
// branch-directory.tsx. RBAC-aware: Create/Edit/Deactivate gated on
// users.create/users.edit/users.delete (super_admin + admin only).
import * as React from "react";
// LockKeyhole (reset password) is deliberately NOT KeyRound (clear 2FA) — two credential
// actions sharing one glyph in the same row is how "the key icon" got read as a password
// reset when it clears the second factor.
import { KeyRound, KeySquare, LockKeyhole, Pencil, Plus, Send, Trash2, UserX } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  ActionMenu,
  type ActionMenuItem,
  useToast,
} from "@repo/ui";
import type { ListStaffUsersQuery, MeResponse, StaffUser, StaffUserStatus } from "@repo/types";

import {
  useStaffUsersList,
  useDeactivateStaffUser,
  useRemoveStaffUser,
  useResetStaffUserPassword,
} from "../../hooks/use-staff-users";
import { useRolesList } from "../../hooks/use-roles";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { UserFormDrawer } from "./user-form-drawer";
import { ClearTwoFactorDrawer } from "./clear-two-factor-drawer";
import { SetPasswordDrawer } from "./set-password-drawer";

const STATUS_OPTIONS: { value: StaffUserStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "deactivated", label: "Deactivated" },
];

const STATUS_TONE: Record<StaffUserStatus, "success" | "info" | "warning" | "danger"> = {
  active: "success",
  invited: "info",
  suspended: "warning",
  deactivated: "danger",
};

interface UserDirectoryProps {
  me: MeResponse | undefined;
}

export function UserDirectory({ me }: UserDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "users");
  const { toast } = useToast();

  const [search, setSearch] = React.useState("");
  const [roleId, setRoleId] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<StaffUserStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<StaffUser | null>(null);
  const [deactivatingUser, setDeactivatingUser] = React.useState<StaffUser | null>(null);
  const [clearingTwoFactorUser, setClearingTwoFactorUser] = React.useState<StaffUser | null>(null);
  const [removingUser, setRemovingUser] = React.useState<StaffUser | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = React.useState<StaffUser | null>(null);
  const [settingPasswordUser, setSettingPasswordUser] = React.useState<StaffUser | null>(null);
  // Separate module from `users.*` — see ClearTwoFactorDrawer's header for why this is
  // its own permission rather than part of users.edit.
  const canResetTwoFactor = hasPermission(me?.permissions, "twofa.reset");
  // `users.remove`, seeded for super_admin ALONE — deliberately not `permissions.canDelete`
  // (`users.delete`), which admin also holds and which only DEACTIVATES. Presentation only:
  // the API enforces the same split (CLAUDE.md §3.5).
  const canRemove = hasPermission(me?.permissions, "users.remove");
  // `users.reset_password`, seeded for super_admin ALONE — deliberately not
  // `permissions.canEdit` (`users.edit`), which admin also holds. An admin able to mint a
  // super admin's credentials could take over that account via its inbox. Presentation
  // only: the API enforces the same split (CLAUDE.md §3.5).
  const canResetPassword = hasPermission(me?.permissions, "users.reset_password");

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleId, status]);

  const query: ListStaffUsersQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    roleId,
    status,
  };

  const { data, isLoading, isError, refetch, isFetching } = useStaffUsersList(query);
  const { data: rolesData } = useRolesList({ page: 1, pageSize: 100 });
  const deactivate = useDeactivateStaffUser();
  const remove = useRemoveStaffUser();
  const resetPassword = useResetStaffUserPassword();
  const roleOptions = (rolesData?.items ?? []).filter((role) => role.key !== "student");

  const columns: Array<DataTableColumn<StaffUser>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    { id: "email", header: "Email", cell: (row) => row.email },
    {
      id: "roles",
      header: "Roles",
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roles.map((role) => (
            <StatusChip key={role.id} tone="neutral" size="sm" label={role.name} />
          ))}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} size="sm" label={row.status} />,
    },
    {
      id: "lastLoginAt",
      header: "Last login",
      cell: (row) => (row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : "Never"),
    },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString() },
  ];

  async function handleRemove() {
    if (!removingUser) return;
    try {
      await remove.mutateAsync(removingUser.id);
      toast({
        title: "User deleted",
        description: `${removingUser.name} has been removed from the CRM.`,
        variant: "success",
      });
      setRemovingUser(null);
    } catch (error) {
      // Leave the dialog open on failure: the two server-side refusals (yourself, the last
      // super admin) are things the user needs to read, not dismiss.
      surfaceError(toast, error, "Couldn't delete this user");
    }
  }

  /**
   * The row's action list, in a fixed order: routine edits first, credential actions in the
   * middle, destructive actions fenced off at the bottom behind a separator.
   *
   * Permission filtering happens by OMISSION — an action the viewer cannot perform is not
   * in the array, so it never renders. That is presentation only; the API enforces each key
   * independently (CLAUDE.md §3.5).
   *
   * `row.id !== me?.user.id` guards mirror the server's self-action refusals. Offering a
   * button whose only possible outcome is a 403 is worse than not offering it.
   */
  function rowActions(row: StaffUser): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    const isSelf = row.id === me?.user.id;

    if (permissions.canEdit) {
      items.push({
        id: "edit",
        label: "Edit",
        icon: <Pencil className="size-4" />,
        onSelect: () => setEditingUser(row),
      });
    }

    // ONE action, named for what it does to THIS row. An account still `invited` has never
    // had a working password, so there is nothing to "reset" — it is being invited. Both
    // labels hit the same endpoint and mint a fresh one-time password; the alternative was
    // two menu entries with identical consequences, which is how the key icon became
    // ambiguous in the first place.
    if (canResetPassword && !isSelf) {
      const neverSignedIn = row.status === "invited";
      items.push({
        id: "reset-password",
        label: neverSignedIn ? "Resend invitation" : "Reset password",
        description: neverSignedIn
          ? "Emails them a new sign-in password"
          : "Emails a new password and signs them out",
        icon: neverSignedIn ? <Send className="size-4" /> : <LockKeyhole className="size-4" />,
        onSelect: () => setResettingPasswordUser(row),
      });
    }

    // Set new password — the operator CHOOSES the value, so they end up knowing it. Rides
    // `users.edit`, which is what PATCH /crm/admin/users/:id already enforces for a
    // `password` field; gating the menu item more tightly than the endpoint would only be
    // decoration, since the Edit drawer exposes the same field.
    //
    // Hidden on your own row: update() revokes every session for the target, so setting your
    // own password here signs you out mid-action. Your own password belongs in account
    // settings, which asks for the current one first.
    if (permissions.canEdit && !isSelf) {
      items.push({
        id: "set-password",
        label: "Set new password",
        description: "You choose it, and you will know it",
        icon: <KeySquare className="size-4" />,
        onSelect: () => setSettingPasswordUser(row),
      });
    }

    // `twofa.reset` (super_admin/admin only), never the own-scope `twofa.manage` every role
    // holds. Hidden for yourself: the API forbids self-clearing, so an admin who lost their
    // own device uses the sign-in recovery link.
    if (canResetTwoFactor && !isSelf) {
      items.push({
        id: "clear-2fa",
        label: "Clear two-factor",
        description: "For someone locked out of their authenticator",
        icon: <KeyRound className="size-4 text-warning" />,
        onSelect: () => setClearingTwoFactorUser(row),
      });
    }

    if (permissions.canDelete && row.status !== "deactivated" && !isSelf) {
      items.push({
        id: "deactivate",
        label: "Deactivate",
        description: "Blocks their login, keeps the record",
        icon: <UserX className="size-4" />,
        tone: "danger",
        separatorBefore: true,
        onSelect: () => setDeactivatingUser(row),
      });
    }

    // Delete — super_admin only (`users.remove`). Hidden for yourself: the API refuses
    // self-removal, so offering it would only ever produce a 403.
    if (canRemove && !isSelf) {
      items.push({
        id: "delete",
        label: "Delete",
        description: "Removes them from the CRM",
        icon: <Trash2 className="size-4" />,
        tone: "danger",
        // Only fence here if Deactivate did not already open the destructive group.
        separatorBefore: !items.some((item) => item.id === "deactivate"),
        onSelect: () => setRemovingUser(row),
      });
    }

    return items;
  }

  async function handleResetPassword() {
    if (!resettingPasswordUser) return;
    try {
      const result = await resetPassword.mutateAsync(resettingPasswordUser.id);
      toast({
        // Names the destination rather than showing the password: the temporary credential
        // only ever exists in that inbox, and an operator who could read it off this screen
        // would be able to sign in as the target.
        title: resettingPasswordUser.status === "invited" ? "Invitation sent" : "Password reset",
        description: `A temporary password was emailed to ${result.email}. They'll be asked to change it on first sign-in.`,
        variant: "success",
      });
      setResettingPasswordUser(null);
    } catch (error) {
      // Left open on failure: the server's refusals (yourself, a deactivated account) are
      // things the operator needs to read.
      surfaceError(toast, error, "Couldn't reset this password");
    }
  }

  async function handleDeactivate() {
    if (!deactivatingUser) return;
    try {
      await deactivate.mutateAsync(deactivatingUser.id);
      toast({ title: "User deactivated", description: `${deactivatingUser.name} can no longer sign in.`, variant: "success" });
      setDeactivatingUser(null);
    } catch (error) {
      surfaceError(toast, error, "Couldn't deactivate this user");
    }
  }

  if (isError) {
    return (
      <EmptyState
        data-testid="users-error"
        title="Couldn't load users"
        description="Something went wrong fetching the user list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="users-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="users-directory">
      <PageHeader
        title="Users"
        description="Create and manage staff logins for the CRM — counsellors, managers, and admins. Students are managed on the Students screen."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="users-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add user
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name or email"
        data-testid="users-filter-bar"
      >
        <Select
          label="Role"
          placeholder="All roles"
          value={roleId ?? "__all__"}
          onValueChange={(value) => setRoleId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-48"
          data-testid="users-role-filter"
        >
          <SelectItem value="__all__">All roles</SelectItem>
          {roleOptions.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Status"
          placeholder="All statuses"
          value={status ?? "__all__"}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as StaffUserStatus))}
          wrapperClassName="w-44"
          data-testid="users-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No staff users found",
          description: "Add the first staff login, or loosen the filters.",
        }}
        caption="Staff user directory"
        data-testid="users-table"
        rowActions={(row) => (
          <ActionMenu triggerLabel={`Actions for ${row.name}`} data-testid="user-row-actions" items={rowActions(row)} />
        )}
      />

      <SetPasswordDrawer
        user={settingPasswordUser}
        onOpenChange={(open) => {
          if (!open) setSettingPasswordUser(null);
        }}
      />

      <ClearTwoFactorDrawer
        user={clearingTwoFactorUser}
        onOpenChange={(open) => {
          if (!open) setClearingTwoFactorUser(null);
        }}
      />

      <UserFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <UserFormDrawer
        open={Boolean(editingUser)}
        onOpenChange={(open) => !open && setEditingUser(null)}
        user={editingUser ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(deactivatingUser)}
        onOpenChange={(open) => {
          if (!open) setDeactivatingUser(null);
        }}
        title={`Deactivate ${deactivatingUser?.name ?? "this user"}?`}
        description="They will be signed out everywhere and can no longer log in. Their history (leads, audit trail) is kept. You can reactivate them later by editing the user."
        confirmLabel="Deactivate"
        tone="danger"
        loading={deactivate.isPending}
        onConfirm={() => void handleDeactivate()}
        data-testid="user-deactivate-confirm"
      />

      <ConfirmDialog
        open={Boolean(resettingPasswordUser)}
        onOpenChange={(open) => {
          if (!open) setResettingPasswordUser(null);
        }}
        title={
          resettingPasswordUser?.status === "invited"
            ? `Send ${resettingPasswordUser?.name ?? "this user"} their sign-in details?`
            : `Reset password for ${resettingPasswordUser?.name ?? "this user"}?`
        }
        // States the consequences people don't expect: the password goes to the account
        // holder rather than back to the operator, and (for an existing account) every live
        // session dies. An invited account has no sessions and no password to invalidate,
        // so that warning is omitted there rather than stated falsely.
        description={
          resettingPasswordUser?.status === "invited"
            ? "A one-time password is emailed to them, and they'll be asked to change it the first time they sign in. You won't see it — only they will."
            : "A one-time password is emailed to them, and they'll be asked to change it the first time they sign in. They'll be signed out everywhere, and their current password stops working immediately. You won't see the new password — only they will."
        }
        confirmLabel={resettingPasswordUser?.status === "invited" ? "Send invitation" : "Reset password"}
        loading={resetPassword.isPending}
        onConfirm={() => void handleResetPassword()}
        data-testid="user-reset-password-confirm"
      />

      <ConfirmDialog
        open={Boolean(removingUser)}
        onOpenChange={(open) => {
          if (!open) setRemovingUser(null);
        }}
        title={`Delete ${removingUser?.name ?? "this user"}?`}
        // Says what actually happens, and names the softer option — most people reaching
        // for Delete want Deactivate, and only learn the difference from this sentence.
        description="They're removed from the CRM and signed out everywhere. Their history — audit trail, leads they own, records they approved — is kept and still shows their name. If they might come back, or you just want to block their login, use Deactivate instead."
        confirmLabel="Delete user"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => void handleRemove()}
        data-testid="user-remove-confirm"
      />
    </div>
  );
}
