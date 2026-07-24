// Date-range (+ optional granularity) filter shared by every Analytics
// dashboard — docs/plans/phase-7.md Wave 3 #14. Mirrors the plain
// `<Input type="date">` pair pattern already used by
// components/admin/audit-log-directory.tsx rather than introducing a new
// date-range-picker primitive.
import * as React from "react";
import { Input, Select, SelectItem } from "@repo/ui";
import type { ReportGranularity } from "@repo/types";

export interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Range validity per AC-4 (`from <= to`) — surfaced so the caller can disable the query/show a hint. */
  invalid?: boolean;
  granularity?: ReportGranularity;
  onGranularityChange?: (value: ReportGranularity) => void;
}

const GRANULARITY_OPTIONS: { value: ReportGranularity; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  invalid = false,
  granularity,
  onGranularityChange,
}: DateRangeFilterProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="analytics-date-range-filter">
      <Input
        label="From"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(event) => onFromChange(event.target.value)}
        wrapperClassName="w-40"
        data-testid="analytics-date-from"
      />
      <Input
        label="To"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(event) => onToChange(event.target.value)}
        wrapperClassName="w-40"
        data-testid="analytics-date-to"
      />
      {granularity && onGranularityChange ? (
        <Select
          label="Granularity"
          value={granularity}
          onValueChange={(value) => onGranularityChange(value as ReportGranularity)}
          placeholder="Select granularity"
          wrapperClassName="w-36"
          data-testid="analytics-granularity"
        >
          {GRANULARITY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      ) : null}
      {invalid ? (
        <p role="alert" className="text-xs text-danger" data-testid="analytics-date-range-invalid">
          "From" must be on or before "To".
        </p>
      ) : null}
    </div>
  );
}
DateRangeFilter.displayName = "DateRangeFilter";
