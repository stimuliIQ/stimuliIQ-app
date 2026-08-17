"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * ActionMenu — the "⋯" row-actions menu for dense tables (docs/07-design-system.md §5).
 *
 * WHY THIS EXISTS. A row of bare icon buttons makes every action a guessing game: the
 * Users screen shipped a key glyph that clears two-factor auth and was reasonably read as
 * "reset password". Icons alone cannot carry that distinction. A menu gives every action
 * its NAME, in a stable order, in one predictable place, and it stops the action column
 * growing a new glyph every time a feature lands.
 *
 * DECLARATIVE `items` rather than composed children, deliberately: row actions are the
 * same shape everywhere (label, icon, handler, sometimes destructive, sometimes hidden by
 * permission), and a shared array shape keeps ordering and tone consistent across screens
 * instead of each table re-inventing them. Filter the array to express permissions — an
 * item that is not in it is not rendered.
 *
 * Built on Radix DropdownMenu (as Select/Dialog/Tabs already are) for roving focus,
 * typeahead, Escape-to-close, outside-click and collision-aware positioning. Those are the
 * parts of a menu that are easy to get subtly wrong by hand, and getting them wrong makes
 * the control unusable by keyboard.
 *
 * Usage:
 *   <ActionMenu
 *     triggerLabel={`Actions for ${row.name}`}
 *     items={[
 *       { id: "edit", label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => … },
 *       { id: "delete", label: "Delete", tone: "danger", onSelect: () => … },
 *     ]}
 *   />
 */
export interface ActionMenuItem {
  /** Stable key, also used as the item's `data-testid` suffix. */
  id: string;
  /** The visible name. This is the whole point of the menu — never ship an unlabelled item. */
  label: string;
  /** Optional leading glyph. Decorative only: the label carries the meaning. */
  icon?: React.ReactNode;
  onSelect: () => void;
  /** `danger` tints destructive entries (delete/deactivate). */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Rendered under the label for an action whose consequence is not obvious. */
  description?: string;
  /** Draws a divider ABOVE this item — use to fence destructive actions off. */
  separatorBefore?: boolean;
}

export interface ActionMenuProps {
  /**
   * The trigger's accessible name. Include the row's subject ("Actions for Priya Sharma")
   * so a screen-reader user moving down a column hears which row each menu belongs to,
   * rather than twenty identical "Actions" buttons.
   */
  triggerLabel: string;
  items: ActionMenuItem[];
  align?: "start" | "end";
  className?: string;
  "data-testid"?: string;
}

export function ActionMenu({
  triggerLabel,
  items,
  align = "end",
  className,
  "data-testid": testId,
}: ActionMenuProps) {
  // An empty menu means the viewer holds no permission for any action on this row. Render
  // nothing rather than a button that opens onto a blank panel.
  if (items.length === 0) return null;

  return (
    // NON-MODAL deliberately. Radix's modal mode sets `pointer-events: none` on the body
    // for as long as the menu is open, which for a row menu means the page behind it stops
    // scrolling and every other row goes inert — heavy behaviour for a five-item list, and
    // a lock that outlives the menu if anything interrupts its cleanup. Outside-click and
    // Escape still close it.
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          data-testid={testId}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded text-fg-muted",
            "transition-colors hover:bg-surface hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            "data-[state=open]:bg-surface data-[state=open]:text-fg",
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={4}
          className={cn(
            "z-50 min-w-[12rem] overflow-hidden rounded-md border border-border bg-card p-1 text-fg shadow-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "motion-reduce:animate-none",
          )}
        >
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separatorBefore ? (
                <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
              ) : null}
              <DropdownMenuPrimitive.Item
                disabled={item.disabled}
                // `onSelect` fires for click AND Enter/Space, so keyboard users get the
                // same action without a separate handler.
                onSelect={() => item.onSelect()}
                data-testid={testId ? `${testId}-${item.id}` : undefined}
                className={cn(
                  "flex cursor-pointer select-none items-start gap-2 rounded px-2 py-1.5 text-sm outline-none",
                  "focus:bg-surface data-[highlighted]:bg-surface",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  item.tone === "danger" ? "text-danger focus:text-danger data-[highlighted]:text-danger" : "text-fg",
                )}
              >
                {item.icon ? (
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {item.description ? (
                    <span className="text-xs text-fg-muted">{item.description}</span>
                  ) : null}
                </span>
              </DropdownMenuPrimitive.Item>
            </React.Fragment>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
