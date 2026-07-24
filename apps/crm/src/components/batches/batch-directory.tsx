// Batch directory — server-paginated DataTable wired to hooks/use-batches.ts
// (docs/03 §7.5). Filters: program/branch/faculty/status via Select, all
// populated from the respective list hooks. RBAC-aware: Create action only
// shows with `batches.create`.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem } from "@repo/ui";
import type { BatchStatus, BatchSummary, ListBatchesQuery, MeResponse } from "@repo/types";

import { useBatchesList } from "../../hooks/use-batches";
import { useProgramsList } from "../../hooks/use-courses";
import { useBranchScope } from "../../app/branch-scope";
import { useFacultyList } from "../../hooks/use-faculty";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { BatchStatusChip } from "../shared/batch-status-chip";
import { BatchFormDrawer } from "./batch-form-drawer";
import { BatchDetailDrawer } from "./batch-detail-drawer";

const STATUS_OPTIONS: { value: BatchStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

interface BatchDirectoryProps {
  me: MeResponse | undefined;
}

export function BatchDirectory({ me }: BatchDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "batches");

  const { branches, selectedBranchId: branchId, setSelectedBranchId: setBranchId } =
    useBranchScope();

  const [search, setSearch] = React.useState("");
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const [facultyId, setFacultyId] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<BatchStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, programId, branchId, facultyId, status]);

  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: facultyData } = useFacultyList({ page: 1, pageSize: 200, includeDeleted: false });

  const query: ListBatchesQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    programId,
    branchId,
    facultyId,
    status,
    includeDeleted: false,
  };

  const { data, isLoading, isError, refetch, isFetching } = useBatchesList(query);

  const columns: Array<DataTableColumn<BatchSummary>> = [
    { id: "name", header: "Batch", cell: (row) => row.name, sortable: true },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "branchName", header: "Branch", cell: (row) => row.branchName },
    { id: "facultyName", header: "Faculty", cell: (row) => row.facultyName ?? "Unassigned" },
    {
      id: "enrolledCount",
      header: "Enrolled",
      cell: (row) => `${row.enrolledCount} / ${row.capacity}`,
      align: "right",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <BatchStatusChip status={row.status} />,
    },
    {
      id: "startDate",
      header: "Starts",
      cell: (row) => new Date(row.startDate).toLocaleDateString(),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="batches-error"
        title="Couldn't load batches"
        description="Something went wrong fetching the batch list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="batches-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const programs = programsData?.items ?? [];
  const faculty = facultyData?.items ?? [];

  return (
    <div className="space-y-6 md:space-y-8" data-testid="batches-directory">
      <PageHeader
        title="Batches"
        description="Manage cohorts, faculty assignment, and rosters."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="batches-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add batch
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Batch name"
        data-testid="batches-filter-bar"
      >
        <Select
          label="Program"
          placeholder="All programs"
          value={programId}
          onValueChange={(value) => setProgramId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-48"
          data-testid="batches-program-filter"
        >
          <SelectItem value="__all__">All programs</SelectItem>
          {programs.map((program) => (
            <SelectItem key={program.id} value={program.id}>
              {program.title}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Branch"
          placeholder="All branches"
          value={branchId}
          onValueChange={(value) => setBranchId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-44"
          data-testid="batches-branch-filter"
        >
          <SelectItem value="__all__">All branches</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Faculty"
          placeholder="All faculty"
          value={facultyId}
          onValueChange={(value) => setFacultyId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-44"
          data-testid="batches-faculty-filter"
        >
          <SelectItem value="__all__">All faculty</SelectItem>
          {faculty.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as BatchStatus))}
          wrapperClassName="w-40"
          data-testid="batches-status-filter"
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
        onRowClick={(row) => setSelectedBatchId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No batches yet",
          description: "Try adjusting your filters, or add the first batch.",
        }}
        caption="Batch directory"
        data-testid="batches-table"
      />

      <BatchFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <BatchDetailDrawer batchId={selectedBatchId} onOpenChange={(open) => !open && setSelectedBatchId(null)} me={me} />
    </div>
  );
}
