// Leads pipeline — Kanban board (docs/03 §7.11) with a DataTable fallback
// view toggle for power users / a11y (some screen-reader/keyboard workflows
// are faster as a flat table than as a multi-column board — docs/03 §11
// "saved views" + §15 a11y). Both views share the SAME query/cache entry
// (hooks/use-leads.ts `useLeadsList`) so toggling views never refetches.
//
// KANBAN DATA/GROUPING APPROACH (documented per the task brief):
//   We fetch ONE generously-sized page (`PIPELINE_PAGE_SIZE`) of leads
//   matching the current filters (owner/source/branch/search — NOT stage,
//   since the board needs all 7 stages at once) and group client-side by
//   `stage` into the 7 KanbanBoard columns. This is the right tradeoff for a
//   kanban (which is inherently "show me everything across columns at
//   once") vs true server pagination per column, which would require 7
//   separate paginated requests and complicate the optimistic move. If a
//   tenant's in-scope lead volume exceeds the cap, the filter bar (owner/
//   source/branch/search) is the documented way to narrow scope — see
//   hooks/use-leads.ts header comment. The TABLE view below uses full
//   server-side pagination (including a stage filter) for exactly this
//   "I have too many leads for a board" case.
//
// RBAC: counsellors are scoped server-side to `own`/`assigned` leads (the
// ScopeInterceptor + leads.owner_id, per docs/03 §9 + phase-2.md). This
// board renders whatever the API returns — it does NOT do client-side scope
// filtering; out-of-scope leads simply never appear in the response.
import * as React from "react";
import { LayoutGrid, Table2, Plus } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  KanbanBoard,
  PageHeader,
  Select,
  SelectItem,
  SlaChip,
} from "@repo/ui";
import type { LeadSummary, MeResponse } from "@repo/types";

import { useLeadsList, useMoveLeadStage } from "../../hooks/use-leads";
import {
  useBulkAssignLeads,
  useBulkMoveLeadsStage,
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViewsList,
} from "../../hooks/use-bulk-saved-views";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { useToast } from "@repo/ui";
import { surfaceError } from "../../lib/surface-error";
import { LEAD_STAGE_COLUMNS, LeadStageChip, canMoveLeadStage } from "./lead-stage-chip";
import { LeadFormDrawer } from "./lead-form-drawer";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { OwnerSelect } from "./owner-select";

const PIPELINE_PAGE_SIZE = 200;

interface PipelineBoardProps {
  me: MeResponse | undefined;
  /**
   * Seeds the owner filter from the `?owner=mine` deep link (notification bell). Read
   * ONCE as the initial state rather than kept in sync with the URL: once the board is
   * open, the filter dropdown is the source of truth, and re-syncing would snap the
   * user's manual choice back to "mine" on every re-render.
   */
  initialOwnerFilter?: "mine";
}

/**
 * Known website lead sources → human labels. The API's `source` filter is an exact
 * match on the stored string, and these are the exact values the public site submits
 * (grep `source=` in apps/web). Scholarship sits first: scholarship applications come
 * in as leads with source "scholarship-page", and this dropdown is how the team views
 * them separately from the rest of the pipeline.
 */
const LEAD_SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "scholarship-page", label: "Scholarship" },
  { value: "web-book-slot", label: "Book a slot" },
  { value: "homepage-cta-band", label: "Homepage callback" },
  { value: "web-program-detail", label: "Program page" },
  { value: "web-timed-popup", label: "Website popup" },
  { value: "web-exit-intent", label: "Exit-intent popup" },
  { value: "web-sticky-bar", label: "Sticky bar" },
  { value: "newsletter", label: "Newsletter" },
];

const LEAD_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_SOURCE_OPTIONS.map((o) => [o.value, o.label]),
);

/** The owner filter's three mutually exclusive shapes — see the state declaration below. */
type OwnerFilter =
  | { kind: "any" }
  | { kind: "mine" }
  | { kind: "unassigned" }
  | { kind: "user"; id: string };

/**
 * Projects the owner filter into the exact query fields the API accepts. Keeping this as
 * one function is what guarantees only ONE of mine/unassigned/ownerId is ever sent — the
 * DTO returns 422 if more than one is present.
 */
function ownerFilterToQuery(filter: OwnerFilter): { mine?: boolean; unassigned?: boolean; ownerId?: string } {
  switch (filter.kind) {
    case "mine":
      return { mine: true };
    case "unassigned":
      return { unassigned: true };
    case "user":
      return { ownerId: filter.id };
    case "any":
    default:
      return {};
  }
}

export function PipelineBoard({ me, initialOwnerFilter }: PipelineBoardProps): React.JSX.Element {
  const canCreate = hasPermission(me?.permissions, "leads.create");
  const canBulkEdit = hasPermission(me?.permissions, "bulk.leads");

  // Table is the default view: it shows every lead (all stages) in one paginated,
  // scannable list with a Stage filter, whereas the board caps at PIPELINE_PAGE_SIZE
  // and hides won/lost context off-screen. Power users toggle to the board for drag-
  // and-drop stage moves.
  const [view, setView] = React.useState<"kanban" | "table">("table");
  const [search, setSearch] = React.useState("");
  const [source, setSource] = React.useState("");
  const [stage, setStage] = React.useState<LeadSummary["stage"] | undefined>(undefined);
  /**
   * The owner filter is ONE piece of state with three mutually exclusive shapes, not
   * three independent booleans — the API rejects combining them (422), and modelling
   * them separately would let the UI build a request the server refuses.
   *   { kind: "any" }              — no owner filter
   *   { kind: "mine" }             — server resolves "me" from the session
   *   { kind: "unassigned" }       — leads nobody owns
   *   { kind: "user", id }         — one specific rep
   */
  const [ownerFilter, setOwnerFilter] = React.useState<OwnerFilter>(
    initialOwnerFilter === "mine" ? { kind: "mine" } : { kind: "any" },
  );
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);
  const [bulkOwnerId, setBulkOwnerId] = React.useState<string | null>(null);
  const [bulkAssignConfirmOpen, setBulkAssignConfirmOpen] = React.useState(false);

  const { toast } = useToast();
  const moveStage = useMoveLeadStage();
  const bulkAssign = useBulkAssignLeads();
  const bulkMoveStage = useBulkMoveLeadsStage();
  const { data: savedViews } = useSavedViewsList({ module: "leads" });
  const createSavedView = useCreateSavedView();
  const deleteSavedView = useDeleteSavedView();

  const debouncedSearch = useDebouncedValue(search);
  const debouncedSource = useDebouncedValue(source);
  const tablePageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, debouncedSource, stage, ownerFilter]);

  const ownerQuery = ownerFilterToQuery(ownerFilter);

  // Kanban: fetch all stages (no stage filter), capped page.
  const kanbanQuery = {
    page: 1,
    pageSize: PIPELINE_PAGE_SIZE,
    search: debouncedSearch || undefined,
    source: debouncedSource || undefined,
    ...ownerQuery,
  };
  const kanban = useLeadsList(kanbanQuery);

  // Table: full server-side pagination, including a stage filter.
  const tableQuery = {
    page,
    pageSize: tablePageSize,
    search: debouncedSearch || undefined,
    source: debouncedSource || undefined,
    stage,
    ...ownerQuery,
  };
  const table = useLeadsList(tableQuery);

  const activeQueryResult = view === "kanban" ? kanban : table;

  async function handleMove(itemId: string, fromColumnId: string, toColumnId: string) {
    if (fromColumnId === toColumnId) return;
    try {
      await moveStage.mutateAsync({ id: itemId, body: { stage: toColumnId as LeadSummary["stage"] } });
      toast({ title: "Stage updated", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't move this lead");
    }
  }

  function applyView(viewId: string | null) {
    setActiveViewId(viewId);
    if (!viewId) return;
    const view = savedViews?.find((v) => v.id === viewId);
    if (!view) return;
    const filters = view.filters as Partial<{
      search: string;
      source: string;
      stage: LeadSummary["stage"];
      ownerFilter: OwnerFilter;
    }>;
    setSearch(filters.search ?? "");
    setSource(filters.source ?? "");
    setStage(filters.stage);
    // Views saved before the owner filter existed have no `ownerFilter` key — fall back
    // to "any" rather than leaving the previous selection silently applied.
    setOwnerFilter(filters.ownerFilter ?? { kind: "any" });
  }

  async function handleSaveView(name: string) {
    try {
      // `ownerFilter` is stored as the discriminated union, not as the flattened query
      // fields. A saved "Assigned to me" view therefore stays personal to whoever opens
      // it (the server resolves "me" per request) instead of freezing one person's id
      // into a view a colleague might later load.
      await createSavedView.mutateAsync({ module: "leads", name, filters: { search, source, stage, ownerFilter } });
      toast({ title: "View saved", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this view");
    }
  }

  async function handleBulkAssign() {
    try {
      const result = await bulkAssign.mutateAsync({ ids: Array.from(selectedIds), ownerId: bulkOwnerId });
      toast({
        title: "Bulk assign complete",
        description: `${result.successCount} of ${result.results.length} leads updated.${
          bulkOwnerId ? " They've been notified in the CRM." : ""
        }`,
        variant: result.failureCount === 0 ? "success" : "default",
      });
      setSelectedIds(new Set());
      setBulkOwnerId(null);
      setBulkAssignConfirmOpen(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't bulk-assign these leads");
    }
  }

  async function handleBulkStage(nextStage: LeadSummary["stage"]) {
    try {
      const result = await bulkMoveStage.mutateAsync({ ids: Array.from(selectedIds), stage: nextStage });
      toast({
        title: "Bulk stage update complete",
        description: `${result.successCount} of ${result.results.length} leads updated.`,
        variant: result.failureCount === 0 ? "success" : "default",
      });
      setSelectedIds(new Set());
    } catch (error) {
      surfaceError(toast, error, "Couldn't bulk-move these leads");
    }
  }

  const columns = LEAD_STAGE_COLUMNS;

  const tableColumns: Array<DataTableColumn<LeadSummary>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    {
      id: "contact",
      header: "Contact",
      // Phone + email share one cell to keep the table narrow; either may be
      // missing (newsletter leads have no phone, popup leads often no email).
      cell: (row) => {
        const phone = row.phone.trim();
        return (
          <div className="space-y-0.5">
            <div>{phone || row.email || "-"}</div>
            {phone && row.email ? <div className="text-xs text-fg-muted">{row.email}</div> : null}
          </div>
        );
      },
    },
    {
      id: "programInterestTitle",
      header: "Program / College",
      // Popup leads carry a free-typed course instead of a catalog program id.
      cell: (row) => (
        <div className="space-y-0.5">
          <div>{row.programInterestTitle ?? row.courseInterest ?? "-"}</div>
          {row.college ? <div className="text-xs text-fg-muted">{row.college}</div> : null}
        </div>
      ),
    },
    { id: "stage", header: "Stage", cell: (row) => <LeadStageChip stage={row.stage} /> },
    { id: "source", header: "Source", cell: (row) => LEAD_SOURCE_LABELS[row.source] ?? row.source },
    {
      id: "ownerName",
      header: "Owner",
      // Unassigned is called out in warning colour rather than rendered as plain text:
      // a lead nobody owns is a problem to fix, not a neutral state to scroll past.
      cell: (row) =>
        row.ownerName ? (
          <div className="space-y-0.5">
            <div>{row.ownerName}</div>
            {row.assignedByName ? (
              <div className="text-xs text-fg-muted">by {row.assignedByName}</div>
            ) : row.assignedAt ? (
              <div className="text-xs text-fg-muted">auto-assigned</div>
            ) : null}
          </div>
        ) : (
          <span className="font-medium text-warning">Unassigned</span>
        ),
    },
    {
      id: "firstContactedAt",
      header: "Contacted",
      // The column that turns "we have 400 leads" into "nobody has called these 60".
      cell: (row) =>
        row.firstContactedAt ? (
          new Date(row.firstContactedAt).toLocaleDateString()
        ) : (
          <span className="font-medium text-warning">Not yet</span>
        ),
    },
    {
      id: "slaDueAt",
      header: "SLA",
      cell: (row) => (row.slaDueAt ? <SlaChip dueAt={new Date(row.slaDueAt)} /> : "-"),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      align: "right",
    },
  ];

  if (activeQueryResult.isError) {
    return (
      <EmptyState
        data-testid="pipeline-error"
        title="Couldn't load the pipeline"
        description="Something went wrong fetching leads."
        action={
          <Button variant="secondary" onClick={() => activeQueryResult.refetch()} data-testid="pipeline-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="pipeline-board">
      <PageHeader
        title="Pipeline"
        description="New → Contacted → Qualified → Counselling → Negotiation → Won/Lost. Server enforces who you can see and move."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Pipeline view">
              <button
                type="button"
                aria-pressed={view === "kanban"}
                onClick={() => setView("kanban")}
                data-testid="pipeline-view-kanban"
                className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium text-fg-muted data-[active=true]:bg-card data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-active={view === "kanban"}
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
                Board
              </button>
              <button
                type="button"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
                data-testid="pipeline-view-table"
                className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium text-fg-muted data-[active=true]:bg-card data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-active={view === "table"}
              >
                <Table2 className="size-4" aria-hidden="true" />
                Table
              </button>
            </div>
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)} data-testid="pipeline-create-button">
                <Plus className="size-4" aria-hidden="true" />
                Add lead
              </Button>
            ) : null}
          </div>
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Name / phone / email"
        savedViews={savedViews?.map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeViewId}
        onSelectView={applyView}
        onSaveView={handleSaveView}
        onDeleteView={(id) => deleteSavedView.mutate(id)}
        data-testid="pipeline-filter-bar"
      >
        <Select
          label="Source"
          placeholder="All sources"
          value={source || "__all__"}
          onValueChange={(value) => setSource(value === "__all__" ? "" : value)}
          wrapperClassName="w-52"
          data-testid="pipeline-source-filter"
        >
          <SelectItem value="__all__">All sources</SelectItem>
          {LEAD_SOURCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>
        {/* The filter that makes tenant-wide `all` scope usable: a marketing user sees
            every lead by permission, and without this has no way to find their own. */}
        <OwnerSelect
          label="Owner"
          mode="filter"
          value={ownerFilter.kind === "user" ? ownerFilter.id : null}
          mineSelected={ownerFilter.kind === "mine"}
          unassignedSelected={ownerFilter.kind === "unassigned"}
          onSelectMine={() => setOwnerFilter({ kind: "mine" })}
          onSelectUnassigned={() => setOwnerFilter({ kind: "unassigned" })}
          onChange={(id) => setOwnerFilter(id ? { kind: "user", id } : { kind: "any" })}
          wrapperClassName="w-64"
          data-testid="pipeline-owner-filter"
        />
        {view === "table" ? (
          <Select
            label="Stage"
            placeholder="All stages"
            value={stage}
            onValueChange={(value) => setStage(value === "__all__" ? undefined : (value as LeadSummary["stage"]))}
            wrapperClassName="w-44"
            data-testid="pipeline-stage-filter"
          >
            <SelectItem value="__all__">All stages</SelectItem>
            {columns.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.title}
              </SelectItem>
            ))}
          </Select>
        ) : null}
      </DataFilterBar>

      {view === "table" && canBulkEdit && selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-3" data-testid="pipeline-bulk-toolbar">
          <span className="text-sm font-medium text-fg">{selectedIds.size} selected</span>
          <OwnerSelect
            label="Assign to"
            value={bulkOwnerId}
            onChange={setBulkOwnerId}
            wrapperClassName="w-64"
            data-testid="pipeline-bulk-owner-select"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBulkAssignConfirmOpen(true)}
            loading={bulkAssign.isPending}
            data-testid="pipeline-bulk-assign"
          >
            {bulkOwnerId ? `Assign ${selectedIds.size}` : `Unassign ${selectedIds.size}`}
          </Button>
          <Select
            placeholder="Move stage…"
            onValueChange={(v) => handleBulkStage(v as LeadSummary["stage"])}
            wrapperClassName="w-44"
            data-testid="pipeline-bulk-stage-select"
          >
            {columns.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.title}
              </SelectItem>
            ))}
          </Select>
        </div>
      ) : null}

      {view === "kanban" ? (
        <KanbanBoard<LeadSummary>
          columns={columns}
          items={kanban.data?.items ?? []}
          getItemId={(lead) => lead.id}
          getItemColumnId={(lead) => lead.stage}
          getCardAriaLabel={(lead) => `${lead.name} · ${lead.stage}`}
          onMove={handleMove}
          canMove={(_id, from, to) =>
            canMoveLeadStage(from as LeadSummary["stage"], to as LeadSummary["stage"])
          }
          data-testid="pipeline-kanban-board"
          renderCard={(lead) => (
            <button
              type="button"
              onClick={() => setSelectedLeadId(lead.id)}
              data-testid="pipeline-card-open"
              className="flex w-full flex-col gap-1.5 text-left"
            >
              <span className="text-sm font-medium text-fg">{lead.name}</span>
              {lead.phone ? (
                <span className="text-xs font-medium tabular-nums text-fg-muted">{lead.phone}</span>
              ) : null}
              {lead.email ? <span className="break-all text-xs text-fg-muted">{lead.email}</span> : null}
              <span className="text-xs text-fg-muted">
                {lead.programInterestTitle ?? lead.courseInterest ?? "No program interest"}
              </span>
              <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
                <span className={lead.ownerName ? undefined : "font-medium text-warning"}>
                  {lead.ownerName ?? "Unassigned"}
                </span>
                <span>{lead.source}</span>
              </div>
              {/* An owned but never-contacted lead is the failure mode this whole pass
                  exists to make visible — it looks fine on a board until you ask. */}
              {lead.ownerName && !lead.firstContactedAt ? (
                <span className="text-xs font-medium text-warning">Not contacted yet</span>
              ) : null}
              {/* self-start: the card is a flex column (align-items:stretch), which
                  would otherwise stretch this inline-flex chip into a full-width pill. */}
              {lead.slaDueAt ? <SlaChip size="sm" dueAt={new Date(lead.slaDueAt)} className="self-start" /> : null}
            </button>
          )}
        />
      ) : (
        <DataTable
          columns={tableColumns}
          rows={table.data?.items ?? []}
          getRowId={(row) => row.id}
          loading={table.isLoading || table.isFetching}
          onRowClick={(row) => setSelectedLeadId(row.id)}
          selection={canBulkEdit ? { selectedIds, onSelectionChange: setSelectedIds, getRowId: (row) => row.id } : undefined}
          pagination={{
            page,
            pageSize: tablePageSize,
            total: table.data?.meta.total ?? 0,
            onPageChange: setPage,
          }}
          emptyState={{
            title: "No leads found",
            description: "Try adjusting your filters, or add a new lead.",
          }}
          caption="Lead pipeline"
          data-testid="pipeline-table"
        />
      )}

      <LeadFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <LeadDetailDrawer leadId={selectedLeadId} me={me} onOpenChange={(open) => !open && setSelectedLeadId(null)} />
      <ConfirmDialog
        open={bulkAssignConfirmOpen}
        onOpenChange={setBulkAssignConfirmOpen}
        title={bulkOwnerId ? "Assign these leads?" : "Unassign these leads?"}
        description={
          bulkOwnerId
            ? `${selectedIds.size} lead(s) will be handed to the selected owner, who will be notified in the CRM.`
            : `${selectedIds.size} lead(s) will lose their current owner. Nobody will be notified.`
        }
        confirmLabel={bulkOwnerId ? "Assign" : "Unassign"}
        loading={bulkAssign.isPending}
        onConfirm={handleBulkAssign}
        data-testid="pipeline-bulk-assign-confirm"
      />
    </div>
  );
}
