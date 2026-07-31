// Programs directory — server-paginated DataTable wired to
// hooks/use-courses.ts (docs/03 §7.4). Search + status filter; row click
// opens the detail drawer hosting the curriculum builder + publish toggle.
// RBAC-aware: Create only shows with `courses.create`.
import * as React from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem, useToast, readableTextOn } from "@repo/ui";
import type { ListProgramsQuery, MeResponse, ProgramStatus, ProgramSummary } from "@repo/types";

import { useProgramsList, useReorderPrograms } from "../../hooks/use-courses";
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

/**
 * Reorder sends the full ordered id list, so it needs every program in one fetch. 500 is
 * far above any realistic catalog size while still bounding the request; past it the
 * up/down buttons would silently reorder against a truncated list, so the controls are
 * hidden entirely rather than allowed to corrupt the sequence.
 */
const REORDER_FETCH_LIMIT = 500;

const REORDER_FILTER_HINT = "Clear the search and status filters to reorder programs.";

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

  // Reordering rewrites the WHOLE sequence from an id array, so it needs every program —
  // not the 20 on the current page. A second, unpaginated fetch supplies that full list;
  // it is only enabled while reordering is actually possible (see `reorderDisabled`), so
  // the ordinary browsing path never pays for it.
  const reorderDisabled = Boolean(debouncedSearch || status);
  const { data: allPrograms } = useProgramsList(
    { page: 1, pageSize: REORDER_FETCH_LIMIT, includeDeleted: false },
    { enabled: permissions.canEdit && !reorderDisabled },
  );
  const reorderPrograms = useReorderPrograms();
  const { toast } = useToast();

  const orderedIds = React.useMemo(
    () => (allPrograms?.items ?? []).map((row) => row.id),
    [allPrograms],
  );

  // If the catalog outgrew the single unpaginated fetch, `orderedIds` is a truncated view
  // of the sequence and reordering against it would push every unfetched program to the
  // end. Refuse rather than silently corrupt the order.
  const listTruncated = (allPrograms?.meta.total ?? 0) > orderedIds.length;
  const canReorder = permissions.canEdit && !reorderDisabled && !listTruncated;

  const move = (programId: string, direction: -1 | 1) => {
    const index = orderedIds.indexOf(programId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedIds.length) return;
    const next = [...orderedIds];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    reorderPrograms.mutate(
      { programIds: next },
      {
        onError: () =>
          toast({
            title: "Couldn't reorder programs",
            description: "Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

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
    {
      id: "badge",
      header: "Badge",
      cell: (row) =>
        // Rendered from the stored colour with the same derived text colour the site uses,
        // so this column is a true preview rather than an approximation.
        row.badgeEnabled && row.badgeLabel && row.badgeColor ? (
          <span
            className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: row.badgeColor, color: readableTextOn(row.badgeColor) }}
          >
            {row.badgeLabel}
          </span>
        ) : (
          <span className="text-xs text-fg-muted">—</span>
        ),
    },
  ];

  if (permissions.canEdit) {
    columns.push({
      id: "reorder",
      header: "Order",
      // Up/down buttons rather than drag-and-drop: keyboard-operable with no new
      // dependency, matching the curriculum builder's existing choice.
      cell: (row) => {
        const index = orderedIds.indexOf(row.id);
        return (
          <div
            className="flex items-center gap-1"
            // The click targets sit inside a row whose own click opens the detail drawer.
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${row.title} up`}
              title={reorderDisabled ? REORDER_FILTER_HINT : "Move up"}
              disabled={!canReorder || reorderPrograms.isPending || index <= 0}
              onClick={() => move(row.id, -1)}
              data-testid={`program-move-up-${row.id}`}
            >
              <ChevronUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${row.title} down`}
              title={reorderDisabled ? REORDER_FILTER_HINT : "Move down"}
              disabled={
                !canReorder || reorderPrograms.isPending || index < 0 || index >= orderedIds.length - 1
              }
              onClick={() => move(row.id, 1)}
              data-testid={`program-move-down-${row.id}`}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </div>
        );
      },
    });
  }

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

      {permissions.canEdit && (reorderDisabled || listTruncated) ? (
        <p className="text-sm text-fg-muted" data-testid="programs-reorder-hint">
          {listTruncated
            ? `Reordering is unavailable above ${REORDER_FETCH_LIMIT} programs.`
            : REORDER_FILTER_HINT}
        </p>
      ) : null}

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
