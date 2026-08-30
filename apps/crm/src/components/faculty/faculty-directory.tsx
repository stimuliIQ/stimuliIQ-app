// Faculty directory — server-paginated DataTable, search + branch filter
// (docs/03 §7.3). The branch filter is a proper branch-name Select backed by
// Admin → Branches data (use-branches.ts' useAllBranches), upgraded in Wave
// 4b now that the Branches module exists; the query param (`branchId`) was
// already wired end-to-end in Wave 4a.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem } from "@repo/ui";
import type { FacultySummary, ListFacultyQuery, MeResponse } from "@repo/types";

import { useFacultyList } from "../../hooks/use-faculty";
import { useBranchScope } from "../../app/branch-scope";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { FacultyFormDrawer } from "./faculty-form-drawer";
import { FacultyDetailDrawer } from "./faculty-detail-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

interface FacultyDirectoryProps {
  me: MeResponse | undefined;
}

export function FacultyDirectory({ me }: FacultyDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "faculty");

  const { branches, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedFacultyId, setSelectedFacultyId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, branchId]);

  const query: ListFacultyQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    branchId,
    includeDeleted: false,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useFacultyList(query);

  const columns: Array<DataTableColumn<FacultySummary>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    { id: "email", header: "Email", cell: (row) => row.email },
    {
      id: "expertise",
      header: "Expertise",
      cell: (row) => (row.expertise.length > 0 ? row.expertise.join(", ") : "-"),
    },
    { id: "rating", header: "Rating", cell: (row) => row.rating ?? "-", align: "right" },
    {
      id: "createdAt",
      header: "Added",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="faculty-error"
        title="Couldn't load faculty"
        description={queryErrorMessage(error, "Something went wrong fetching the directory.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="faculty-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="faculty-directory">
      <PageHeader
        title="Faculty"
        description="Search, filter, and manage faculty profiles."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="faculty-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add faculty
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name or email"
        data-testid="faculty-filter-bar"
      >
        <Select
          label="Branch"
          placeholder="All branches"
          value={branchId}
          onValueChange={(value) => setBranchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-56"
          data-testid="faculty-branch-filter"
        >
          <SelectItem value="__all__">All branches</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name} ({branch.city})
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedFacultyId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No faculty yet",
          description: "Try adjusting your filters, or add the first faculty member.",
        }}
        caption="Faculty directory"
        data-testid="faculty-table"
      />

      <FacultyFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <FacultyDetailDrawer facultyId={selectedFacultyId} onOpenChange={(open) => !open && setSelectedFacultyId(null)} me={me} />
    </div>
  );
}
