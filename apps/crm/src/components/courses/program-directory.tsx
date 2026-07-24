// Programs directory — server-paginated DataTable wired to
// hooks/use-courses.ts (docs/03 §7.4). Search + status filter; row click
// opens the detail drawer hosting the curriculum builder + publish toggle.
// RBAC-aware: Create only shows with `courses.create`.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem } from "@repo/ui";
import type { ListProgramsQuery, MeResponse, ProgramStatus, ProgramSummary } from "@repo/types";

import { useProgramsList } from "../../hooks/use-courses";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { formatPaiseAsInr } from "../../lib/money";
import { ProgramStatusChip } from "./program-status-chip";
import { ProgramFormDrawer } from "./program-form-drawer";
import { ProgramDetailDrawer } from "./program-detail-drawer";

const STATUS_OPTIONS: { value: ProgramStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

interface ProgramDirectoryProps {
  me: MeResponse | undefined;
}

export function ProgramDirectory({ me }: ProgramDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "courses");

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ProgramStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedProgramId, setSelectedProgramId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const query: ListProgramsQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
    includeDeleted: false,
  };

  const { data, isLoading, isError, refetch, isFetching } = useProgramsList(query);

  const columns: Array<DataTableColumn<ProgramSummary>> = [
    { id: "title", header: "Title", cell: (row) => row.title, sortable: false },
    { id: "domain", header: "Domain", cell: (row) => row.domain },
    { id: "level", header: "Level", cell: (row) => row.level },
    { id: "mode", header: "Mode", cell: (row) => row.mode },
    {
      id: "pricePaise",
      header: "Price",
      cell: (row) => formatPaiseAsInr(row.pricePaise),
      align: "right",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <ProgramStatusChip status={row.status} />,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="programs-error"
        title="Couldn't load programs"
        description="Something went wrong fetching the catalog."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="programs-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="programs-directory">
      <PageHeader
        title="Courses"
        description="Programs, curriculum, and publish status."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="programs-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add program
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Title or slug"
        data-testid="programs-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as ProgramStatus))}
          wrapperClassName="w-44"
          data-testid="programs-status-filter"
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
        onRowClick={(row) => setSelectedProgramId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No programs yet",
          description: "Try adjusting your filters, or add the first program.",
        }}
        caption="Program catalog"
        data-testid="programs-table"
      />

      <ProgramFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <ProgramDetailDrawer
        programId={selectedProgramId}
        onOpenChange={(open) => !open && setSelectedProgramId(null)}
        me={me}
      />
    </div>
  );
}
