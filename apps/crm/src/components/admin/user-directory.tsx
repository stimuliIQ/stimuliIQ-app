// Admin ▸ Users — staff-account credential management directory.
// Server-paginated DataTable over hooks/use-staff-users.ts, mirroring
// branch-directory.tsx. RBAC-aware: Create/Edit/Deactivate gated on
// users.create/users.edit/users.delete (super_admin + admin only).
import * as React from "react";
import { KeyRound, Pencil, Plus, Trash2, UserX } from "lucide-react";
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
  useToast,
} from "@repo/ui";
import type { ListStaffUsersQuery, MeResponse, StaffUser, StaffUserStatus } from "@repo/types";

import { useStaffUsersList, useDeactivateStaffUser, useRemoveStaffUser } from "../../hooks/use-staff-users";
import { useRolesList } from "../../hooks/use-roles";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { UserFormDrawer } from "./user-form-drawer";
import { ClearTwoFactorDrawer } from "./clear-two-factor-drawer";

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
  // Separate module from `users.*` — see ClearTwoFactorDrawer's header for why this is
  // its own permission rather than part of users.edit.
  const canResetTwoFactor = hasPermission(me?.permissions, "twofa.reset");
  // `users.remove`, seeded for super_admin ALONE — deliberately not `permissions.canDelete`
  // (`users.delete`), which admin also holds and which only DEACTIVATES. Presentation only:
  // the API enforces the same split (CLAUDE.md §3.5).
  const canRemove = hasPermission(me?.permissions, "users.remove");

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
          <span className="flex items-center gap-1">
            {permissions.canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.name}`}
                onClick={() => setEditingUser(row)}
                data-testid="user-edit-row-button"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            {/* `twofa.reset` (super_admin/admin only), never the own-scope `twofa.manage`
                every role holds. Hidden for yourself: the API forbids self-clearing, so
                an admin who lost their own device uses the sign-in recovery link. */}
            {canResetTwoFactor && row.id !== me?.user.id ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Clear two-factor authentication for ${row.name}`}
                onClick={() => setClearingTwoFactorUser(row)}
                data-testid="user-clear-2fa-row-button"
              >
                <KeyRound className="size-4 text-warning" aria-hidden="true" />
              </Button>
            ) : null}
            {permissions.canDelete && row.status !== "deactivated" && row.id !== me?.user.id ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Deactivate ${row.name}`}
                onClick={() => setDeactivatingUser(row)}
                data-testid="user-deactivate-row-button"
              >
                <UserX className="size-4 text-danger" aria-hidden="true" />
              </Button>
            ) : null}
            {/* Delete — super_admin only (`users.remove`). Hidden for yourself: the API
                refuses self-removal, so offering it would only ever produce a 403. */}
            {canRemove && row.id !== me?.user.id ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${row.name}`}
                onClick={() => setRemovingUser(row)}
                data-testid="user-remove-row-button"
              >
                <Trash2 className="size-4 text-danger" aria-hidden="true" />
              </Button>
            ) : null}
          </span>
        )}
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
