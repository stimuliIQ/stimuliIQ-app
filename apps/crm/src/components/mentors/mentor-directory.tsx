// Mentor directory — server-paginated DataTable, search + engagementStatus
// filter (WS-1, docs/specs/phase-8-mentor.md). Mirrors faculty-directory.tsx.
// AC-16: loading skeleton (DataTable's own `loading` state), a clear empty
// state with an "Add mentor" CTA, and a non-blank error state with retry —
// never a blank panel. RBAC-aware: Create only shows with `mentors.create`
// (the API is the real gate, CLAUDE.md §3.5).
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem } from "@repo/ui";
import type { ListMentorsQuery, MentorEngagementStatus, MentorSummary, MeResponse } from "@repo/types";

import { useMentorsList } from "../../hooks/use-mentors";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";
import { MentorEngagementStatusChip } from "../shared/mentor-engagement-status-chip";
import { MentorFormDrawer } from "./mentor-form-drawer";
import { MentorDetailDrawer } from "./mentor-detail-drawer";

const ENGAGEMENT_STATUSES: { value: MentorEngagementStatus; label: string }[] = [
  { value: "prospective", label: "Prospective" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface MentorDirectoryProps {
  me: MeResponse | undefined;
}

export function MentorDirectory({ me }: MentorDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "mentors");

  const [search, setSearch] = React.useState("");
  const [engagementStatus, setEngagementStatus] = React.useState<MentorEngagementStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedMentorId, setSelectedMentorId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, engagementStatus]);

  const query: ListMentorsQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    engagementStatus,
    includeDeleted: false,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useMentorsList(query);

  const columns: Array<DataTableColumn<MentorSummary>> = [
    { id: "fullName", header: "Name", cell: (row) => row.fullName, sortable: true },
    { id: "email", header: "Email", cell: (row) => row.email },
    { id: "externalInstitute", header: "Institute", cell: (row) => row.externalInstitute },
    {
      id: "expertise",
      header: "Expertise",
      cell: (row) => (row.expertise.length > 0 ? row.expertise.join(", ") : "-"),
    },
    {
      id: "engagementStatus",
      header: "Status",
      cell: (row) => <MentorEngagementStatusChip status={row.engagementStatus} />,
    },
    { id: "assignedBatchCount", header: "Batches", cell: (row) => row.assignedBatchCount, align: "right" },
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
        data-testid="mentors-error"
        title="Couldn't load mentors"
        description={queryErrorMessage(error, "Something went wrong fetching the mentor directory.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="mentors-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="mentor-directory">
      <PageHeader
        title="Mentors"
        description="Externally-hired subject experts who lead batches to completion. Search, filter, and manage hiring records."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="mentor-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add mentor
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name or institute"
        data-testid="mentor-filter-bar"
      >
        <Select
          label="Engagement status"
          placeholder="All statuses"
          value={engagementStatus}
          onValueChange={(value) =>
            setEngagementStatus(value === "__all__" ? undefined : (value as MentorEngagementStatus))
          }
          wrapperClassName="w-56"
          data-testid="mentor-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {ENGAGEMENT_STATUSES.map((opt) => (
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
        onRowClick={(row) => setSelectedMentorId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No mentors yet",
          description: "Try adjusting your filters, or add the first mentor.",
          action: permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="mentor-empty-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add mentor
            </Button>
          ) : undefined,
        }}
        caption="Mentor directory"
        data-testid="mentor-table"
      />

      <MentorFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <MentorDetailDrawer
        mentorId={selectedMentorId}
        onOpenChange={(open) => !open && setSelectedMentorId(null)}
        me={me}
      />
    </div>
  );
}
