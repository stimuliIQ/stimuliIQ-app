"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";

import { cn } from "../lib/cn";
import { Select, SelectItem } from "./select";

/**
 * KanbanBoard / KanbanColumn / KanbanCard
 *
 * Generic typed kanban board for the lead pipeline (docs/03-prd-crm.md §7.11:
 * New → Contacted → Qualified → Counselling → Negotiation → Won/Lost).
 *
 * MOVEMENT APPROACH
 * -----------------
 * Two complementary mechanisms drive the SAME `onMove(itemId, fromColumnId, toColumnId)`
 * callback, so pointer and keyboard users are first-class:
 *
 * 1. DRAG-AND-DROP (pointer) — native HTML5 drag-and-drop, ZERO dependencies (no @dnd-kit /
 *    react-dnd, per CLAUDE.md §1). Enabled automatically whenever `onMove` is provided:
 *    each card becomes a drag source, each column a drop target, and dropping a card onto a
 *    different column calls `onMove`. The dragged card dims and the target column shows a
 *    brand-ring highlight. State (which card is dragging, which column is hovered) is owned
 *    by KanbanBoard; the source column is carried across the drag via `dataTransfer`.
 *
 * 2. KEYBOARD MOVE — each card has a "Move card" button (⋯) that expands/collapses a
 *    <Select> listing the other columns. The user selects a target column with keyboard
 *    or mouse; on selection, `onMove(...)` is called. Native DnD is pointer-only, so this
 *    button is the accessible path and is always kept alongside drag-and-drop.
 *    - The button has `aria-expanded` and `aria-haspopup="listbox"`.
 *    - The Select is Radix-based (already keyboard + SR operable).
 *
 * DND SEAM: each KanbanCard still exposes `data-kanban-item-id` / `data-kanban-column-id`
 * and forwards its ref, so an external DnD lib could be layered on later if ever needed.
 *
 * 3. KEYBOARD REORDER (within a column) — pass `onReorder(itemId, columnId, direction)` to
 *    `KanbanBoard` to enable "Move card up"/"Move card down" buttons on each card. Edge
 *    items (top/bottom of the column) get disabled buttons rather than being hidden, so
 *    the control set stays predictable under keyboard/SR navigation. Reordering across
 *    columns is `onMove` (mechanism 1); reordering within a column is `onReorder`; both are
 *    optional and independent — a board can support one, both, or neither.
 *
 * A11Y NOTES
 * ----------
 * - Columns are `<section>` elements with `aria-label="{title} — {count} items"`.
 * - Cards are `<article>` elements, `role="article"` (implicit), keyboard-focusable
 *   (`tabIndex=0`), with `aria-label` summarising the card content.
 * - The move menu button has `aria-label="Move card"` and `aria-expanded`.
 * - Column count is announced via `aria-live="polite"` on the column header count badge
 *   so screen readers hear updates after a move.
 * - No color-only column status — column titles are always visible text.
 * - The entire board region has `role="region"` with `aria-label="Kanban board"`.
 *
 * GENERIC CONTRACT
 * ----------------
 *   TItem must have at least `id: string` and `columnId: string`.
 *
 * Usage:
 *   <KanbanBoard
 *     columns={[
 *       { id: "new", title: "New", count: 5 },
 *       { id: "contacted", title: "Contacted", count: 3 },
 *     ]}
 *     items={leads}                          // TItem[]
 *     getItemId={(lead) => lead.id}
 *     getItemColumnId={(lead) => lead.stage}
 *     renderCard={(lead, { columnId }) => (
 *       <div>
 *         <p>{lead.name}</p>
 *         <SlaChip dueAt={lead.sla_due_at} />
 *       </div>
 *     )}
 *     onMove={(itemId, fromColumnId, toColumnId) => moveStage(itemId, toColumnId)}
 *   />
 */

// ---------------------------------------------------------------------------
// Column descriptor
// ---------------------------------------------------------------------------

export interface KanbanColumnDef {
  id: string;
  /** Visible column title — always text, never color-only. */
  title: string;
  /** Item count shown in the column header badge. */
  count?: number;
  /** Optional className applied to the column wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Card render-prop context
// ---------------------------------------------------------------------------

export interface KanbanCardRenderContext {
  columnId: string;
  /** Call this to programmatically trigger the move-to menu for this card. */
  openMoveMenu: () => void;
}

// ---------------------------------------------------------------------------
// KanbanBoard props
// ---------------------------------------------------------------------------

export interface KanbanBoardProps<TItem> {
  /** Column definitions — each with id, title, and optional count. */
  columns: KanbanColumnDef[];
  /**
   * All items. The board groups them by column using `getItemColumnId`.
   * Items whose columnId doesn't match any column def are silently ignored.
   */
  items: TItem[];
  /** Returns the unique item id (used as React key and as the first arg to `onMove`). */
  getItemId: (item: TItem) => string;
  /** Returns the column id this item currently belongs to. */
  getItemColumnId: (item: TItem) => string;
  /**
   * Render prop — renders the card body content. The card chrome (focus, move button, DnD
   * seam attributes) is owned by KanbanCard; only the business content goes here.
   */
  renderCard: (item: TItem, ctx: KanbanCardRenderContext) => React.ReactNode;
  /**
   * Called when the user moves an item to a different column (via the accessible move menu
   * or a future DnD integration). The actual state update lives in the caller — this
   * component is presentational.
   */
  onMove?: (itemId: string, fromColumnId: string, toColumnId: string) => void;
  /**
   * Optional guard describing which moves are legal. Returns `true` if `itemId` may move
   * from `fromColumnId` to `toColumnId`. When provided, illegal target columns REJECT the
   * drop during drag-and-drop (the browser shows a "no-drop" cursor, the column dims and
   * never highlights, and `onMove` is never fired for them) and are dropped from each
   * card's keyboard Move menu. Omit to allow every cross-column move (default). This lets a
   * board mirror a server-side state machine (e.g. a forward-only lead pipeline) so a move
   * the API would reject can't be attempted in the first place.
   */
  canMove?: (itemId: string, fromColumnId: string, toColumnId: string) => boolean;
  /**
   * Called when the user reorders an item within its own column (keyboard-accessible
   * up/down controls — see KanbanCard). The actual reordering of `items` is the caller's
   * responsibility, same "dumb component, caller owns state" contract as `onMove`. Omit
   * to disable in-column reordering entirely (the up/down controls are not rendered).
   */
  onReorder?: (itemId: string, columnId: string, direction: "up" | "down") => void;
  /**
   * Optional aria label for the card, e.g. a lead name. Used for `aria-label` on each
   * card's `<article>`. If omitted, defaults to "Card".
   */
  getCardAriaLabel?: (item: TItem) => string;
  className?: string;
  /** Test hook; defaults to "kanban-board" when omitted. */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// KanbanCard
// ---------------------------------------------------------------------------

export interface KanbanCardProps {
  itemId: string;
  columnId: string;
  columns: KanbanColumnDef[];
  onMove?: (itemId: string, fromColumnId: string, toColumnId: string) => void;
  /** See `KanbanBoardProps.canMove` — filters this card's keyboard Move menu to legal targets. */
  canMove?: (itemId: string, fromColumnId: string, toColumnId: string) => boolean;
  /** Keyboard-accessible in-column reorder — see `KanbanBoardProps.onReorder`. */
  onReorder?: (itemId: string, columnId: string, direction: "up" | "down") => void;
  /** Whether the up/down reorder buttons are enabled (false at the top/bottom edge). */
  canReorderUp?: boolean;
  canReorderDown?: boolean;
  /** When true the card is a native HTML5 drag source (mouse/touch pointer drag). */
  draggable?: boolean;
  /** True while THIS card is the one being dragged — dims it so the drop target reads clearly. */
  isDragging?: boolean;
  /** Native dragstart handler (set by KanbanBoard — seeds dataTransfer + drag state). */
  onCardDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  /** Native dragend handler (set by KanbanBoard — clears drag state). */
  onCardDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Test hook; defaults to "kanban-card" when omitted. */
  "data-testid"?: string;
}

export const KanbanCard = React.forwardRef<HTMLDivElement, KanbanCardProps>(
  (
    {
      itemId,
      columnId,
      columns,
      onMove,
      canMove,
      onReorder,
      canReorderUp = false,
      canReorderDown = false,
      draggable = false,
      isDragging = false,
      onCardDragStart,
      onCardDragEnd,
      children,
      ariaLabel = "Card",
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    const [moveMenuOpen, setMoveMenuOpen] = React.useState(false);
    const moveButtonRef = React.useRef<HTMLButtonElement>(null);
    const moveMenuId = React.useId();

    // Target columns exclude the current column and any move the guard forbids.
    const targetColumns = columns.filter(
      (col) => col.id !== columnId && (!canMove || canMove(itemId, columnId, col.id)),
    );

    function handleMoveSelect(targetColumnId: string): void {
      onMove?.(itemId, columnId, targetColumnId);
      setMoveMenuOpen(false);
    }

    return (
      <div
        ref={ref}
        // DND SEAM: these attrs identify the draggable item + its source column. The board
        // wires native HTML5 drag-and-drop through them; external DnD libs can read them too.
        data-kanban-item-id={itemId}
        data-kanban-column-id={columnId}
        data-testid={testId ?? "kanban-card"}
        role="article"
        aria-label={ariaLabel}
        aria-roledescription={draggable ? "Draggable card" : undefined}
        tabIndex={0}
        draggable={draggable}
        onDragStart={onCardDragStart}
        onDragEnd={onCardDragEnd}
        className={cn(
          "group relative rounded-md border border-border bg-card p-3 shadow-sm",
          "transition-shadow duration-fast ease-out",
          "hover:shadow-md",
          // Native-drag affordances: grab cursor + no text selection while dragging.
          draggable && "cursor-grab select-none active:cursor-grabbing",
          isDragging && "opacity-50 shadow-none ring-2 ring-ring",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          className,
        )}
      >
        {/* Card body — rendered by parent's render prop */}
        <div>{children}</div>

        {/* Reorder + move controls — visible on hover/focus; fully keyboard + SR operable */}
        <div className="mt-2 flex items-center gap-1">
          {onReorder ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(itemId, columnId, "up");
                }}
                disabled={!canReorderUp}
                aria-label="Move card up"
                data-testid={`${testId ?? "kanban-card"}-reorder-up`}
                className={cn(
                  "rounded p-1 text-fg-muted",
                  "opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100",
                  "hover:bg-surface hover:text-fg disabled:pointer-events-none disabled:opacity-0",
                  "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                )}
              >
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReorder(itemId, columnId, "down");
                }}
                disabled={!canReorderDown}
                aria-label="Move card down"
                data-testid={`${testId ?? "kanban-card"}-reorder-down`}
                className={cn(
                  "rounded p-1 text-fg-muted",
                  "opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100",
                  "hover:bg-surface hover:text-fg disabled:pointer-events-none disabled:opacity-0",
                  "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                )}
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
            </>
          ) : null}

          {/* Move control */}
          {onMove && targetColumns.length > 0 ? (
            <div>
            {moveMenuOpen ? (
              <div id={moveMenuId}>
                <Select
                  aria-label="Move to column"
                  placeholder="Move to…"
                  onValueChange={(val) => {
                    handleMoveSelect(val);
                  }}
                  data-testid={`${testId ?? "kanban-card"}-move-select`}
                >
                  {targetColumns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      {col.title}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            ) : (
              <button
                ref={moveButtonRef}
                type="button"
                aria-label="Move card"
                aria-haspopup="listbox"
                aria-expanded={moveMenuOpen}
                aria-controls={moveMenuOpen ? moveMenuId : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  setMoveMenuOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setMoveMenuOpen(true);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted",
                  "opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100",
                  "hover:bg-surface hover:text-fg",
                  "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                )}
              >
                <MoreHorizontal className="size-3.5" aria-hidden="true" />
                <span>Move</span>
              </button>
            )}
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
KanbanCard.displayName = "KanbanCard";

// ---------------------------------------------------------------------------
// KanbanColumn
// ---------------------------------------------------------------------------

export interface KanbanColumnProps {
  column: KanbanColumnDef;
  children: React.ReactNode;
  className?: string;
  /** True while a dragged card is hovering this column as a valid drop target. */
  isDropActive?: boolean;
  /**
   * True while a drag is in progress and this column is NOT a legal drop target for the
   * dragged card (per `canMove`). Dims the column and shows a not-allowed cursor so the
   * disallowed target reads clearly. The source column is not marked disabled.
   */
  isDropDisabled?: boolean;
  /** Native drop-target handlers (set by KanbanBoard when drag-and-drop is enabled). */
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  /** Test hook; defaults to "kanban-column" when omitted. */
  "data-testid"?: string;
}

export function KanbanColumn({
  column,
  children,
  className,
  isDropActive = false,
  isDropDisabled = false,
  onDragOver,
  onDragLeave,
  onDrop,
  "data-testid": testId,
}: KanbanColumnProps): React.JSX.Element {
  const countId = React.useId();

  return (
    <section
      aria-label={`${column.title} — ${column.count ?? 0} items`}
      data-testid={testId ?? "kanban-column"}
      data-kanban-column-id={column.id}
      data-drop-active={isDropActive || undefined}
      data-drop-disabled={isDropDisabled || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-lg border bg-surface transition-colors duration-fast",
        // Drop-target highlight: brand ring + soft tint so the target column is unmistakable.
        isDropActive ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500 ring-offset-1 ring-offset-bg" : "border-border",
        // Illegal target during a drag: dim + not-allowed cursor so the reject reads clearly.
        isDropDisabled && "cursor-not-allowed opacity-40",
        column.className,
        className,
      )}
    >
      {/* Sticky column header */}
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-lg border-b border-border bg-surface px-3 py-2.5">
        <span className="text-sm font-semibold text-fg">{column.title}</span>
        {/* Count badge — aria-live so moves are announced */}
        <span
          id={countId}
          aria-live="polite"
          aria-atomic="true"
          className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-border px-1.5 text-xs font-medium text-fg-muted"
        >
          {column.count ?? 0}
        </span>
      </div>

      {/* Card stack */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// KanbanBoard — generic entry point
// ---------------------------------------------------------------------------

export function KanbanBoard<TItem>({
  columns,
  items,
  getItemId,
  getItemColumnId,
  renderCard,
  onMove,
  canMove,
  onReorder,
  getCardAriaLabel,
  className,
  "data-testid": testId,
}: KanbanBoardProps<TItem>): React.JSX.Element {
  // Group items by columnId for efficient per-column rendering
  const itemsByColumn = React.useMemo<Map<string, TItem[]>>(() => {
    const map = new Map<string, TItem[]>();
    for (const col of columns) {
      map.set(col.id, []);
    }
    for (const item of items) {
      const colId = getItemColumnId(item);
      const bucket = map.get(colId);
      if (bucket) bucket.push(item);
    }
    return map;
  }, [columns, items, getItemColumnId]);

  // ── Native HTML5 drag-and-drop ────────────────────────────────────────────
  // Enabled whenever `onMove` is provided. Drag a card onto another column to
  // move it there; the accessible Move menu (KanbanCard) stays as the keyboard/
  // screen-reader path (native DnD is pointer-only), so a11y is unaffected.
  const DND_MIME = "application/x-kanban-item";
  const dndEnabled = Boolean(onMove);
  const [dragging, setDragging] = React.useState<{ id: string; from: string } | null>(null);
  const [overColumnId, setOverColumnId] = React.useState<string | null>(null);

  const handleCardDragStart = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>, itemId: string, fromColumnId: string) => {
      event.dataTransfer.effectAllowed = "move";
      const payload = JSON.stringify({ itemId, fromColumnId });
      try {
        event.dataTransfer.setData(DND_MIME, payload);
      } catch {
        /* some browsers restrict custom MIME types — the text/plain fallback below covers them */
      }
      // text/plain is required for a drag to actually initiate in some browsers.
      event.dataTransfer.setData("text/plain", payload);
      setDragging({ id: itemId, from: fromColumnId });
    },
    [],
  );

  const handleCardDragEnd = React.useCallback(() => {
    setDragging(null);
    setOverColumnId(null);
  }, []);

  const handleColumnDragOver = React.useCallback(
    (event: React.DragEvent<HTMLElement>, columnId: string) => {
      if (!dragging) return;
      // Reject the drop on an illegal target: withholding preventDefault() makes the browser
      // show a "no-drop" cursor and suppresses the drop event, so `onMove` never fires for a
      // move the guard forbids.
      if (canMove && dragging.from !== columnId && !canMove(dragging.id, dragging.from, columnId)) {
        event.dataTransfer.dropEffect = "none";
        return;
      }
      event.preventDefault(); // allow the drop
      event.dataTransfer.dropEffect = "move";
      setOverColumnId((cur) => (cur === columnId ? cur : columnId));
    },
    [dragging, canMove],
  );

  const handleColumnDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLElement>, columnId: string) => {
      // dragleave fires when crossing into child nodes too — only clear when the
      // pointer has actually left the column subtree.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOverColumnId((cur) => (cur === columnId ? null : cur));
    },
    [],
  );

  const handleColumnDrop = React.useCallback(
    (event: React.DragEvent<HTMLElement>, toColumnId: string) => {
      event.preventDefault();
      let payload: { itemId: string; fromColumnId: string } | null = null;
      try {
        const raw =
          event.dataTransfer.getData(DND_MIME) || event.dataTransfer.getData("text/plain");
        if (raw) payload = JSON.parse(raw) as { itemId: string; fromColumnId: string };
      } catch {
        payload = null;
      }
      setDragging(null);
      setOverColumnId(null);
      if (!payload || !onMove) return;
      if (payload.fromColumnId === toColumnId) return; // dropped back on its own column — no-op
      // Defensive: even though an illegal target withholds preventDefault (so this handler
      // shouldn't fire), re-check the guard before committing the move.
      if (canMove && !canMove(payload.itemId, payload.fromColumnId, toColumnId)) return;
      onMove(payload.itemId, payload.fromColumnId, toColumnId);
    },
    [onMove, canMove],
  );

  return (
    <div
      role="region"
      aria-label="Kanban board"
      data-testid={testId ?? "kanban-board"}
      className={cn(
        // Horizontal scroll, sticky column headers via column's own sticky positioning
        "flex gap-3 overflow-x-auto pb-4",
        className,
      )}
    >
      {columns.map((col) => {
        const colItems = itemsByColumn.get(col.id) ?? [];
        // Is this column a legal drop target for the card currently being dragged?
        const isLegalTarget =
          dragging != null &&
          dragging.from !== col.id &&
          (!canMove || canMove(dragging.id, dragging.from, col.id));
        // Highlight a column only when a card from a DIFFERENT column is hovering a LEGAL target.
        const isDropActive = dndEnabled && isLegalTarget && overColumnId === col.id;
        // Dim a column that is an illegal target for the in-flight drag (never the source).
        const isDropDisabled =
          dndEnabled && dragging != null && dragging.from !== col.id && !isLegalTarget;
        return (
          <KanbanColumn
            key={col.id}
            column={{ ...col, count: colItems.length }}
            isDropActive={isDropActive}
            isDropDisabled={isDropDisabled}
            onDragOver={dndEnabled ? (e) => handleColumnDragOver(e, col.id) : undefined}
            onDragLeave={dndEnabled ? (e) => handleColumnDragLeave(e, col.id) : undefined}
            onDrop={dndEnabled ? (e) => handleColumnDrop(e, col.id) : undefined}
          >
            {colItems.length === 0 ? (
              <p className="py-4 text-center text-xs text-fg-subtle" aria-hidden="true">
                Empty
              </p>
            ) : (
              colItems.map((item, itemIndex) => {
                const itemId = getItemId(item);
                const ariaLabel = getCardAriaLabel ? getCardAriaLabel(item) : "Card";
                return (
                  <KanbanCard
                    key={itemId}
                    itemId={itemId}
                    columnId={col.id}
                    columns={columns}
                    onMove={onMove}
                    canMove={canMove}
                    onReorder={onReorder}
                    canReorderUp={itemIndex > 0}
                    canReorderDown={itemIndex < colItems.length - 1}
                    draggable={dndEnabled}
                    isDragging={dragging?.id === itemId}
                    onCardDragStart={
                      dndEnabled ? (e) => handleCardDragStart(e, itemId, col.id) : undefined
                    }
                    onCardDragEnd={dndEnabled ? handleCardDragEnd : undefined}
                    ariaLabel={ariaLabel}
                    data-testid="kanban-card"
                  >
                    {renderCard(item, {
                      columnId: col.id,
                      // openMoveMenu is a seam: KanbanCard owns the move button internally.
                      // A consumer who wants to trigger it programmatically (e.g. from a
                      // context menu inside renderCard) can lift state into the parent and
                      // use a ref. The noop here satisfies the KanbanCardRenderContext type.
                      openMoveMenu: () => {}, // no-op — KanbanCard's move button is the primary mechanism
                    })}
                  </KanbanCard>
                );
              })
            )}
          </KanbanColumn>
        );
      })}
    </div>
  );
}
