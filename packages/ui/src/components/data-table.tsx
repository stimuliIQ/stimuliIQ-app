import * as React from "react";

import { cn } from "../lib/cn";
import { Checkbox } from "./checkbox";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * DataTable — the CRM workhorse list view, per docs/04 §3.1/§3.4 and
 * docs/07-design-system.md §5 ("server pagination, sort, sticky header, row select,
 * virtualization, empty state"). Deliberately **dumb**: it owns no data-fetching — callers
 * (TanStack Query in the CRM) own the request and pass `rows` + pagination/sort state +
 * callbacks. This keeps the component reusable across `web`/`lms`/`crm` and keeps business
 * logic out of `@repo/ui` (CLAUDE.md §3).
 *
 * Density: consumes the ambient `[data-density="compact"]` attribute (set on `<html>`/
 * `<body>` by the CRM shell) via the `--density-row-height`/`--density-padding-*` tokens —
 * no separate "compact" prop/fork.
 *
 * Virtualization seam (docs/03 §8, follow-up tracked per phase-1 plan risk #6): this P1
 * implementation renders all `rows` directly (no windowing). The seam to add
 * `@tanstack/react-virtual` later is the `getRowId` + the `<tbody>` render loop below —
 * swap the `.map` for a virtualizer's `virtualItems` loop without touching the public
 * props API. Not adding the dependency now per the task constraint (defer rather than add
 * a virtualization lib speculatively).
 *
 * Usage:
 *   <DataTable
 *     columns={[
 *       { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
 *       { id: "status", header: "Status", cell: (row) => <StatusChip tone="success" label="Active" /> },
 *     ]}
 *     rows={students}
 *     getRowId={(row) => row.id}
 *     pagination={{ page, pageSize, total, onPageChange: setPage }}
 *     sort={{ sortBy, sortDir, onSortChange: (id, dir) => { setSortBy(id); setSortDir(dir); } }}
 *     loading={isLoading}
 *     emptyState={{ title: "No students yet", description: "Try adjusting your filters." }}
 *   />
 */
export type SortDirection = "asc" | "desc";

export interface DataTableColumn<TRow> {
  /** Unique column id; used as the sort key and React key. */
  id: string;
  header: React.ReactNode;
  cell: (row: TRow) => React.ReactNode;
  /** Enables the clickable sortable header for this column. */
  sortable?: boolean;
  /** Additional className for both header and body cells (e.g. width, text-align). */
  className?: string;
  /** Right-aligns numeric columns. */
  align?: "left" | "right" | "center";
}

export interface DataTablePaginationState {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableSortState {
  sortBy: string | null;
  sortDir: SortDirection;
  onSortChange: (sortBy: string, sortDir: SortDirection) => void;
}

export interface DataTableSelectionState<TRow> {
  selectedIds: ReadonlySet<string>;
  onSelectionChange: (selectedIds: ReadonlySet<string>) => void;
  getRowId: (row: TRow) => string;
}

export interface DataTableProps<TRow> {
  columns: Array<DataTableColumn<TRow>>;
  rows: ReadonlyArray<TRow>;
  getRowId: (row: TRow) => string;
  /** Skeleton rows render in place of `rows` while a server request is in flight. */
  loading?: boolean;
  /** Number of skeleton rows to render while `loading`; defaults to 5. */
  loadingRowCount?: number;
  pagination?: DataTablePaginationState;
  sort?: DataTableSortState;
  selection?: DataTableSelectionState<TRow>;
  /** Per-row action slot (e.g. a kebab menu), rendered as the last column. */
  rowActions?: (row: TRow) => React.ReactNode;
  /** Shown instead of the body when `rows` is empty and not loading. */
  emptyState?: Omit<EmptyStateProps, "data-testid">;
  /** Click handler for a data row (e.g. open the detail drawer); ignored for the header row. */
  onRowClick?: (row: TRow) => void;
  /**
   * Optional toolbar slot rendered above the table — typically a `DataFilterBar`
   * (search + filter chips + saved views, `./data-filter-bar.tsx`). Kept as a slot rather
   * than a hard dependency so `DataTable` stays usable without a filter bar and
   * `DataFilterBar` stays reusable outside `DataTable` (e.g. above a `KanbanBoard`).
   */
  toolbar?: React.ReactNode;
  className?: string;
  /** Caption announced to screen readers describing the table's purpose (visually hidden). */
  caption?: string;
  /** Test hook; defaults to "data-table" when omitted. */
  "data-testid"?: string;
}

function SortIndicator({ direction }: { direction: SortDirection | null }): React.JSX.Element {
  return (
    <span aria-hidden="true" className="inline-flex flex-col text-[0.5rem] leading-none">
      <span className={direction === "asc" ? "text-fg" : "text-fg-subtle"}>▲</span>
      <span className={direction === "desc" ? "text-fg" : "text-fg-subtle"}>▼</span>
    </span>
  );
}

export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  loading = false,
  loadingRowCount = 5,
  pagination,
  sort,
  selection,
  rowActions,
  emptyState,
  onRowClick,
  toolbar,
  className,
  caption,
  "data-testid": testId,
}: DataTableProps<TRow>): React.JSX.Element {
  const hasSelection = Boolean(selection);
  const hasRowActions = Boolean(rowActions);
  const isEmpty = !loading && rows.length === 0;

  const allSelected =
    selection && rows.length > 0 && rows.every((row) => selection.selectedIds.has(selection.getRowId(row)));
  const someSelected =
    selection && !allSelected && rows.some((row) => selection.selectedIds.has(selection.getRowId(row)));

  const toggleAll = (checked: boolean) => {
    if (!selection) return;
    if (checked) {
      selection.onSelectionChange(new Set(rows.map((row) => selection.getRowId(row))));
    } else {
      selection.onSelectionChange(new Set());
    }
  };

  const toggleRow = (rowId: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (checked) next.add(rowId);
    else next.delete(rowId);
    selection.onSelectionChange(next);
  };

  const handleSort = (columnId: string) => {
    if (!sort) return;
    const nextDir: SortDirection =
      sort.sortBy === columnId && sort.sortDir === "asc" ? "desc" : "asc";
    sort.onSortChange(columnId, nextDir);
  };

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div
      data-testid={testId ?? "data-table"}
      className={cn("flex flex-col gap-3", className)}
    >
      {toolbar ? <div data-testid="data-table-toolbar">{toolbar}</div> : null}
      <div className="relative max-h-[70vh] overflow-auto rounded-md border border-border">
        <table className="w-full caption-bottom text-sm" data-density-row="true">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border">
              {hasSelection ? (
                <th
                  scope="col"
                  className="w-10 px-[var(--density-padding-x)] py-[var(--density-padding-y)]"
                >
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    data-testid="data-table-select-all"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const isSorted = sort?.sortBy === column.id;
                const ariaSort = !column.sortable
                  ? undefined
                  : isSorted
                    ? sort?.sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      "px-[var(--density-padding-x)] py-[var(--density-padding-y)] text-left font-medium text-fg-muted",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.className,
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 font-medium text-fg-muted hover:text-fg",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                          isSorted && "text-fg",
                        )}
                        data-testid={`data-table-sort-${column.id}`}
                      >
                        {column.header}
                        <SortIndicator direction={isSorted ? (sort?.sortDir ?? null) : null} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {hasRowActions ? (
                <th scope="col" className="px-[var(--density-padding-x)] py-[var(--density-padding-y)]">
                  <span className="sr-only">Row actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRowCount }).map((_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} className="border-b border-border last:border-0">
                    {hasSelection ? (
                      <td className="px-[var(--density-padding-x)] py-[var(--density-padding-y)]">
                        <Skeleton shape="line" className="h-4 w-4" />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className="px-[var(--density-padding-x)] py-[var(--density-padding-y)]"
                      >
                        <Skeleton shape="line" />
                      </td>
                    ))}
                    {hasRowActions ? (
                      <td className="px-[var(--density-padding-x)] py-[var(--density-padding-y)]">
                        <Skeleton shape="line" className="w-8" />
                      </td>
                    ) : null}
                  </tr>
                ))
              : rows.map((row) => {
                  const rowId = getRowId(row);
                  const isSelected = selection?.selectedIds.has(rowId) ?? false;
                  return (
                    <tr
                      key={rowId}
                      data-testid="data-table-row"
                      data-state={isSelected ? "selected" : undefined}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        "border-b border-border last:border-0",
                        "h-[var(--density-row-height)]",
                        onRowClick && "cursor-pointer hover:bg-surface",
                        isSelected && "bg-brand-50",
                      )}
                    >
                      {hasSelection ? (
                        <td
                          className="px-[var(--density-padding-x)] py-[var(--density-padding-y)]"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            aria-label="Select row"
                            checked={isSelected}
                            onCheckedChange={(checked) => toggleRow(rowId, checked === true)}
                            data-testid="data-table-select-row"
                          />
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={cn(
                            "px-[var(--density-padding-x)] py-[var(--density-padding-y)] text-fg",
                            column.align === "right" && "text-right",
                            column.align === "center" && "text-center",
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                      {hasRowActions ? (
                        <td
                          className="px-[var(--density-padding-x)] py-[var(--density-padding-y)] text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {rowActions?.(row)}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {isEmpty ? (
          <EmptyState
            data-testid="data-table-empty"
            title={emptyState?.title ?? "No results"}
            description={emptyState?.description ?? "There's nothing to show yet."}
            icon={emptyState?.icon}
            action={emptyState?.action}
          />
        ) : null}
      </div>
      {pagination ? (
        <DataTablePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={totalPages}
          onPageChange={pagination.onPageChange}
        />
      ) : null}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Test hook; defaults to "pagination" when omitted. */
  "data-testid"?: string;
}

/**
 * Pagination — standalone control, also used internally by DataTable. 1-indexed `page`.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  "data-testid": testId,
}: PaginationProps): React.JSX.Element {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <DataTablePagination
      page={page}
      pageSize={pageSize}
      total={total}
      totalPages={totalPages}
      onPageChange={onPageChange}
      testId={testId}
    />
  );
}

function DataTablePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  testId,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  testId?: string;
}): React.JSX.Element {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      data-testid={testId ?? "pagination"}
      className="flex items-center justify-between gap-4 text-sm text-fg-muted"
    >
      <p aria-live="polite">
        {total === 0 ? "0 results" : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          data-testid="pagination-prev"
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-fg",
            "transition-colors duration-fast ease-out hover:bg-surface",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Previous
        </button>
        <span aria-current="page" className="px-1">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          data-testid="pagination-next"
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-fg",
            "transition-colors duration-fast ease-out hover:bg-surface",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
