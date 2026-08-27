// Roles & Permissions directory — list of roles (use-roles.ts), create/edit
// role, and a per-role permission matrix editor (docs/03 §7.16/§9, the
// headline Admin feature). Selecting a role from the list opens the matrix
// editor for that role in a side panel. RBAC-aware: Create/Edit gated on
// `roles.create`/`roles.edit`.
import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerBody, DrawerContent, EmptyState, PageHeader, StatusChip, useToast } from "@repo/ui";
import type { MeResponse, Role } from "@repo/types";

import { useDeleteRole, useRolesList } from "../../hooks/use-roles";
import { getModulePermissions } from "../../lib/permissions";
import { RoleFormDrawer } from "./role-form-drawer";
import { RolePermissionMatrix } from "./role-permission-matrix";

interface RoleDirectoryProps {
  me: MeResponse | undefined;
}

export function RoleDirectory({ me }: RoleDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "roles");
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<Role | null>(null);
  const [selectedRole, setSelectedRole] = React.useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = React.useState<Role | null>(null);
  const pageSize = 20;

  const { data, isLoading, isError, refetch, isFetching } = useRolesList({ page, pageSize });
  const deleteRole = useDeleteRole();

  // Custom (non-system) roles can be managed; system roles (super_admin, admin) are
  // seed-fixed and both edit + delete are blocked server-side.
  const canManage = permissions.canEdit;

  function handleDelete() {
    if (!deletingRole) return;
    const id = deletingRole.id;
    deleteRole.mutate(id, {
      onSuccess: () => {
        toast({ title: "Role deleted", variant: "success" });
        setDeletingRole(null);
        if (selectedRole?.id === id) setSelectedRole(null);
      },
      onError: (err) => {
        const problem =
          err && typeof err === "object" && "problem" in err
            ? (err as { problem: { detail?: string; title?: string } }).problem
            : undefined;
        toast({
          title: "Couldn't delete role",
          description: problem?.detail ?? problem?.title ?? (err as Error).message,
          variant: "destructive",
        });
        setDeletingRole(null);
      },
    });
  }

  const columns: Array<DataTableColumn<Role>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    { id: "key", header: "Key", cell: (row) => row.key },
    {
      id: "isSystem",
      header: "Type",
      cell: (row) => (
        <StatusChip tone={row.isSystem ? "neutral" : "info"} label={row.isSystem ? "System" : "Custom"} />
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="roles-error"
        title="Couldn't load roles"
        description="Something went wrong fetching the role list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="roles-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="roles-directory">
      <PageHeader
        title="Roles & permissions"
        description="Select a role to view and edit its permission matrix."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="roles-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add role
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedRole(row)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No roles yet",
          description: "Add the first custom role.",
        }}
        caption="Role directory"
        data-testid="roles-table"
        rowActions={
          canManage
            ? (row) => (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => setEditingRole(row)}
                    data-testid="role-edit-row-button"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  {/* System roles (super_admin, admin) are seed-fixed — no delete. */}
                  {!row.isSystem ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${row.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingRole(row);
                      }}
                      data-testid={`role-delete-row-button-${row.id}`}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              )
            : undefined
        }
      />

      <Drawer open={Boolean(selectedRole)} onOpenChange={(open) => !open && setSelectedRole(null)}>
        {selectedRole ? (
          <DrawerContent
            position="center"
            size="xl"
            title={`Permissions · ${selectedRole.name}`}
            description="Choose the screens this role can open, and what it can do on each. Saving replaces this role's entire grant set."
            data-testid="role-permission-matrix-panel"
          >
            <DrawerBody>
              <RolePermissionMatrix role={selectedRole} me={me} />
            </DrawerBody>
          </DrawerContent>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(deletingRole)}
        onOpenChange={(open) => !open && setDeletingRole(null)}
        title={deletingRole ? `Delete "${deletingRole.name}"?` : "Delete role?"}
        description="The role will be soft-deleted. If any users are still assigned to it, deletion is blocked until you reassign them."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteRole.isPending}
        data-testid="confirm-delete-role"
      />

      <RoleFormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => setSelectedRole(created)}
      />
      <RoleFormDrawer open={Boolean(editingRole)} onOpenChange={(open) => !open && setEditingRole(null)} role={editingRole ?? undefined} />
    </div>
  );
}
