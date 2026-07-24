import * as React from "react";

import { cn } from "../lib/cn";

/**
 * DetailGrid / DetailRow — shared read-only key/value pattern for drawer
 * detail views, per docs/specs/crm-ui-consistency.md §5. Formalizes the
 * `dl.grid grid-cols-2 gap-4 text-sm` / `dt` muted / `dd` fg pattern that
 * ~10 detail drawers (audit log, faculty, batch, ...) already hand-roll
 * identically — a single primitive so it can't drift.
 *
 * Usage:
 *   <DetailGrid>
 *     <DetailRow label="Phone" value={faculty.phone ?? "—"} />
 *     <DetailRow label="Rating" value={faculty.rating ?? "—"} />
 *     <DetailRow label="Expertise" value={<SkillTags items={faculty.expertise} />} fullWidth />
 *   </DetailGrid>
 */
export type DetailGridColumns = 1 | 2 | 3;

const DETAIL_GRID_COLUMN_CLASSES: Record<DetailGridColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export interface DetailGridProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Number of grid columns. Defaults to 2 (the existing convention). */
  columns?: DetailGridColumns;
  /** Test hook; defaults to "detail-grid" when omitted. */
  "data-testid"?: string;
}

export const DetailGrid = React.forwardRef<HTMLDListElement, DetailGridProps>(
  ({ className, columns = 2, children, "data-testid": testId, ...props }, ref) => {
    return (
      <dl
        ref={ref}
        data-testid={testId ?? "detail-grid"}
        className={cn("grid gap-4 text-sm", DETAIL_GRID_COLUMN_CLASSES[columns], className)}
        {...props}
      >
        {children}
      </dl>
    );
  },
);
DetailGrid.displayName = "DetailGrid";

export interface DetailRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The `dt` label text. */
  label: React.ReactNode;
  /** The `dd` value content. Ignored if `children` is provided instead. */
  value?: React.ReactNode;
  /**
   * Span every column of the parent `DetailGrid` (`col-span-full`) — for long
   * values (bio, tag lists) that shouldn't share a row with another field.
   */
  fullWidth?: boolean;
  /** Test hook; defaults to "detail-row" when omitted. */
  "data-testid"?: string;
}

export const DetailRow = React.forwardRef<HTMLDivElement, DetailRowProps>(
  ({ label, value, fullWidth, className, children, "data-testid": testId, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-testid={testId ?? "detail-row"}
        className={cn(fullWidth && "col-span-full", className)}
        {...props}
      >
        <dt className="text-fg-muted">{label}</dt>
        <dd className="mt-1 text-fg">{children ?? value}</dd>
      </div>
    );
  },
);
DetailRow.displayName = "DetailRow";
