// Admin ▸ Users — staff-account credential management directory.
// Server-paginated DataTable over hooks/use-staff-users.ts, mirroring
// branch-directory.tsx. RBAC-aware: Create/Edit/Deactivate gated on
// users.create/users.edit/users.delete (super_admin + admin only).
import * as React from "react";
import { Pencil, Plus, UserX } from "lucide-react";
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

import { useStaffUsersList, useDeactivateStaffUser } from "../../hooks/use-staff-users";
import { useRolesList } from "../../hooks/use-roles";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { UserFormDrawer } from "./user-form-drawer";

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
    <div className="space-y-6 md:space-y-8" data-testid="users-directory">
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
          </span>
        )}
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
    </div>
  );
}
