// Branches directory — server-paginated DataTable wired to
// hooks/use-branches.ts (docs/03 §7.16). Also the picker data source for
// Batches/Faculty branch selects. RBAC-aware: Create/Edit gated on
// `branches.create`/`branches.edit` (Owner/Admin only per the API).
import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem } from "@repo/ui";
import type { BranchDetail, BranchStatus, ListBranchesQuery, MeResponse } from "@repo/types";

import { useBranchesList } from "../../hooks/use-branches";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { BranchStatusChip } from "./branch-status-chip";
import { BranchFormDrawer } from "./branch-form-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

const STATUS_OPTIONS: { value: BranchStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface BranchDirectoryProps {
  me: MeResponse | undefined;
}

export function BranchDirectory({ me }: BranchDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "branches");

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<BranchStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingBranch, setEditingBranch] = React.useState<BranchDetail | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const query: ListBranchesQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useBranchesList(query);

  const columns: Array<DataTableColumn<BranchDetail>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    { id: "city", header: "City", cell: (row) => row.city },
    { id: "address", header: "Address", cell: (row) => row.address ?? "-" },
    {
      id: "status",
      header: "Status",
      cell: (row) => <BranchStatusChip status={row.status} />,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="branches-error"
        title="Couldn't load branches"
        description={queryErrorMessage(error, "Something went wrong fetching the branch list.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="branches-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="branches-directory">
      <PageHeader
        title="Branches"
        description="Manage branch locations used across batches and faculty."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="branches-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add branch
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name or city"
        data-testid="branches-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as BranchStatus))}
          wrapperClassName="w-44"
          data-testid="branches-status-filter"
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
          title: "No branches yet",
          description: "Add the first branch location.",
        }}
        caption="Branch directory"
        data-testid="branches-table"
        rowActions={
          permissions.canEdit
            ? (row) => (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${row.name}`}
                  onClick={() => setEditingBranch(row)}
                  data-testid="branch-edit-row-button"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              )
            : undefined
        }
      />

      <BranchFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <BranchFormDrawer
        open={Boolean(editingBranch)}
        onOpenChange={(open) => !open && setEditingBranch(null)}
        branch={editingBranch ?? undefined}
      />
    </div>
  );
}
