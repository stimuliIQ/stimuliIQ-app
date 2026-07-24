"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./button";

/**
 * DataFilterBar — saved-view / advanced-filter toolbar for `DataTable` (T19,
 * docs/plans/phase-9-completion.md), used for the leads/students list, video library,
 * tickets queue, etc. Composes with `DataTable` via its `toolbar` prop but is a standalone
 * component so it can also sit above a `KanbanBoard` or any other list surface.
 *
 * Presentational/dumb: search text, active filter chips, and saved views are all owned by
 * the caller. `children` is a slot for the actual filter controls (typically `Select`s or
 * `AudienceSegmentFilter`-style rows) rendered between the search box and the chip row.
 *
 * a11y:
 * - Search input has a visible label via `aria-label` (or pass `searchLabel`).
 * - Each filter chip is a labelled remove button ("Remove filter: {label}").
 * - Saved views render as a `role="group"` of toggle buttons with `aria-pressed`.
 * - "Save view" reveals an inline, keyboard-operable name field (no `window.prompt`).
 *
 * Usage:
 *   <DataTable
 *     toolbar={
 *       <DataFilterBar
 *         searchValue={search}
 *         onSearchChange={setSearch}
 *         chips={activeChips}
 *         onClearAll={() => setFilters([])}
 *         savedViews={savedViews}
 *         activeViewId={activeViewId}
 *         onSelectView={setActiveViewId}
 *         onSaveView={(name) => saveView(name, currentFilters)}
 *       >
 *         <Select label="Status" value={status} onValueChange={setStatus}>...</Select>
 *       </DataFilterBar>
 *     }
 *     columns={columns}
 *     rows={rows}
 *     getRowId={(r) => r.id}
 *   />
 */
export interface FilterChip {
  id: string;
  /** Visible chip text, e.g. "Status: Active". */
  label: string;
  onRemove?: () => void;
}

export interface SavedFilterView {
  id: string;
  name: string;
}

export interface DataFilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  chips?: FilterChip[];
  onClearAll?: () => void;
  savedViews?: SavedFilterView[];
  /** `null` = no saved view active ("All"). */
  activeViewId?: string | null;
  onSelectView?: (viewId: string | null) => void;
  onSaveView?: (name: string) => void;
  onDeleteView?: (viewId: string) => void;
  /** Extra filter controls (Selects, date pickers) rendered inline. */
  children?: React.ReactNode;
  className?: string;
  /** Test hook; defaults to "data-filter-bar" when omitted. */
  "data-testid"?: string;
}

export function DataFilterBar({
  searchValue,
  onSearchChange,
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  chips = [],
  onClearAll,
  savedViews,
  activeViewId = null,
  onSelectView,
  onSaveView,
  onDeleteView,
  children,
  className,
  "data-testid": testId,
}: DataFilterBarProps): React.JSX.Element {
  const [savingView, setSavingView] = React.useState(false);
  const [newViewName, setNewViewName] = React.useState("");

  function handleSaveViewSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = newViewName.trim();
    if (!trimmed || !onSaveView) return;
    onSaveView(trimmed);
    setNewViewName("");
    setSavingView(false);
  }

  return (
    <div data-testid={testId ?? "data-filter-bar"} className={cn("flex flex-col gap-3", className)}>
      {/* Saved views */}
      {savedViews && savedViews.length > 0 ? (
        <div role="group" aria-label="Saved views" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelectView?.(null)}
            aria-pressed={activeViewId === null}
            data-testid="data-filter-bar-view-all"
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              activeViewId === null
                ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                : "border-border text-fg-muted hover:bg-surface hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
            )}
          >
            All
          </button>
          {savedViews.map((view) => (
            <span key={view.id} className="group relative inline-flex items-center">
              <button
                type="button"
                onClick={() => onSelectView?.(view.id)}
                aria-pressed={activeViewId === view.id}
                data-testid={`data-filter-bar-view-${view.id}`}
                className={cn(
                  "rounded-full border px-3 py-1 pr-6 text-xs font-medium transition-colors",
                  activeViewId === view.id
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                    : "border-border text-fg-muted hover:bg-surface hover:text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
                  !onDeleteView && "pr-3",
                )}
              >
                {view.name}
              </button>
              {onDeleteView ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteView(view.id);
                  }}
                  aria-label={`Delete saved view: ${view.name}`}
                  data-testid={`data-filter-bar-view-delete-${view.id}`}
                  className={cn(
                    "absolute right-1 rounded-full p-0.5 text-fg-subtle opacity-0 transition-opacity",
                    "group-hover:opacity-100 group-focus-within:opacity-100 hover:text-danger",
                    "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {/* Search + extra controls + save view */}
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange ? (
          <div className="relative flex-1 min-w-[12rem]">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              data-testid="data-filter-bar-search"
              className={cn(
                "h-9 w-full rounded-md border border-border bg-bg pl-8 pr-3 text-sm text-fg",
                "placeholder:text-fg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              )}
            />
          </div>
        ) : null}

        {children}

        {onSaveView ? (
          savingView ? (
            <form onSubmit={handleSaveViewSubmit} className="flex items-center gap-1.5">
              <label htmlFor="data-filter-bar-new-view-name" className="sr-only">
                New view name
              </label>
              <input
                id="data-filter-bar-new-view-name"
                type="text"
                autoFocus
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="View name"
                data-testid="data-filter-bar-view-name-input"
                className={cn(
                  "h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
              <Button type="submit" size="sm" data-testid="data-filter-bar-save-view-confirm">
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSavingView(false);
                  setNewViewName("");
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSavingView(true)}
              data-testid="data-filter-bar-save-view"
            >
              Save view
            </Button>
          )
        ) : null}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Active filters:</span>
          {chips.map((chip) => (
            <span
              key={chip.id}
              data-testid={`data-filter-bar-chip-${chip.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted"
            >
              {chip.label}
              {chip.onRemove ? (
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remove filter: ${chip.label}`}
                  data-testid={`data-filter-bar-chip-remove-${chip.id}`}
                  className={cn(
                    "rounded-full p-0.5 text-fg-subtle hover:text-danger",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
          {onClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              data-testid="data-filter-bar-clear-all"
              className={cn(
                "text-xs font-medium text-brand-500 hover:underline",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
              )}
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

DataFilterBar.displayName = "DataFilterBar";
