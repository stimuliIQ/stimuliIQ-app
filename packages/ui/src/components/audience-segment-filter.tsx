"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "../lib/cn";
import { Select, SelectItem } from "./select";

/**
 * AudienceSegmentFilter — filter-builder UI for campaign audience segmentation.
 * Per docs/03-prd-crm.md §7.13, docs/06 §13, docs/07 §5.
 *
 * Builds a list of filter rules (field + operator + value) that are combined as AND
 * conditions. The resulting filter definition matches the API's `SegmentDefDto.filters`
 * shape (from `@repo/types`).
 *
 * Presentational: no data fetching, no API calls. The caller passes available fields
 * (field options) and receives filter changes via `onFilterChange`.
 *
 * a11y:
 * - Each filter row is a fieldset so the legend labels the group.
 * - Add/remove controls are labelled icon buttons.
 * - Select controls have explicit aria-labels.
 *
 * Usage:
 *   <AudienceSegmentFilter
 *     fields={SEGMENT_FIELDS}
 *     filters={segmentDef.filters}
 *     onFilterChange={(newFilters) => updateSegment(newFilters)}
 *   />
 */

export type FilterOperator = "eq" | "neq" | "in" | "not_in" | "contains" | "gt" | "lt";

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "equals",
  neq: "does not equal",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  gt: "greater than",
  lt: "less than",
};

export interface SegmentFieldDef {
  /** Field key matching the API segment filter schema. */
  key: string;
  label: string;
  /** Which operators are valid for this field type. */
  operators: FilterOperator[];
  /** For enum-type fields: the selectable values. */
  options?: Array<{ value: string; label: string }>;
  /** Input type for the value. Defaults to "text". */
  inputType?: "text" | "number" | "select" | "multiselect";
}

export interface SegmentFilter {
  id: string;   // local row id (not sent to API)
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

export interface AudienceSegmentFilterProps {
  fields: SegmentFieldDef[];
  filters: SegmentFilter[];
  onFilterChange: (filters: SegmentFilter[]) => void;
  /** Maximum number of filter rows. Defaults to 10. */
  maxFilters?: number;
  loading?: boolean;
  className?: string;
  /** Test hook; defaults to "audience-segment-filter". */
  "data-testid"?: string;
}

function generateRowId(): string {
  return `filter-${Math.random().toString(36).slice(2, 9)}`;
}

export function AudienceSegmentFilter({
  fields,
  filters,
  onFilterChange,
  maxFilters = 10,
  loading = false,
  className,
  "data-testid": testId,
}: AudienceSegmentFilterProps): React.JSX.Element {
  function addFilter() {
    const defaultField = fields[0];
    if (!defaultField) return;
    onFilterChange([
      ...filters,
      {
        id: generateRowId(),
        field: defaultField.key,
        operator: defaultField.operators[0] ?? "eq",
        value: "",
      },
    ]);
  }

  function removeFilter(id: string) {
    onFilterChange(filters.filter((f) => f.id !== id));
  }

  function updateFilter(id: string, updates: Partial<SegmentFilter>) {
    onFilterChange(
      filters.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...updates };
        // If field changed, reset operator and value
        if (updates.field && updates.field !== f.field) {
          const newFieldDef = fields.find((fd) => fd.key === updates.field);
          updated.operator = newFieldDef?.operators[0] ?? "eq";
          updated.value = "";
        }
        return updated;
      }),
    );
  }

  return (
    <div
      data-testid={testId ?? "audience-segment-filter"}
      className={cn("flex flex-col gap-3", loading && "pointer-events-none opacity-60", className)}
      aria-busy={loading}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-fg">Audience filters</h4>
        <p className="text-xs text-fg-muted">All conditions must match (AND)</p>
      </div>

      {filters.length === 0 ? (
        <p className="text-sm text-fg-muted rounded-md border border-dashed border-border px-4 py-4 text-center">
          No filters yet. All recipients in the selected list will be included.
        </p>
      ) : (
        <ol
          aria-label="Segment filter rules"
          className="flex flex-col gap-2"
        >
          {filters.map((filter, index) => {
            const fieldDef = fields.find((f) => f.key === filter.field);
            const operators = fieldDef?.operators ?? [];
            const hasOptions = fieldDef?.inputType === "select" || fieldDef?.inputType === "multiselect";

            return (
              <li key={filter.id}>
                <fieldset
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3"
                  aria-label={`Filter condition ${index + 1}`}
                >
                  <legend className="sr-only">Filter condition {index + 1}</legend>

                  {/* Field selector */}
                  <Select
                    value={filter.field}
                    onValueChange={(v) => updateFilter(filter.id, { field: v })}
                    aria-label={`Filter ${index + 1} field`}
                    className="min-w-[10rem] flex-1"
                  >
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </Select>

                  {/* Operator selector */}
                  <Select
                    value={filter.operator}
                    onValueChange={(v) => updateFilter(filter.id, { operator: v as FilterOperator })}
                    aria-label={`Filter ${index + 1} operator`}
                    className="min-w-[8rem]"
                  >
                    {operators.map((op) => (
                      <SelectItem key={op} value={op}>
                        {FILTER_OPERATOR_LABELS[op]}
                      </SelectItem>
                    ))}
                  </Select>

                  {/* Value input */}
                  {hasOptions && fieldDef?.options ? (
                    <Select
                      value={Array.isArray(filter.value) ? (filter.value[0] ?? "") : filter.value}
                      onValueChange={(v) =>
                        updateFilter(filter.id, {
                          value: fieldDef.inputType === "multiselect" ? [v] : v,
                        })
                      }
                      aria-label={`Filter ${index + 1} value`}
                      className="min-w-[8rem] flex-1"
                    >
                      {fieldDef.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <input
                      type={fieldDef?.inputType === "number" ? "number" : "text"}
                      value={Array.isArray(filter.value) ? filter.value.join(", ") : filter.value}
                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      aria-label={`Filter ${index + 1} value`}
                      placeholder="Value"
                      className={cn(
                        "min-w-[8rem] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-fg",
                        "placeholder:text-fg-subtle",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                      data-testid={`filter-value-${filter.id}`}
                    />
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeFilter(filter.id)}
                    aria-label={`Remove filter condition ${index + 1}`}
                    className={cn(
                      "rounded-md p-1.5 text-fg-subtle hover:bg-surface hover:text-danger transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    data-testid={`remove-filter-${filter.id}`}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </fieldset>
              </li>
            );
          })}
        </ol>
      )}

      {/* Add filter button */}
      {filters.length < maxFilters ? (
        <button
          type="button"
          onClick={addFilter}
          disabled={fields.length === 0}
          className={cn(
            "inline-flex items-center gap-2 self-start rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-fg-muted",
            "hover:border-brand-500 hover:text-brand-500 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
          data-testid="add-filter-btn"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add filter
        </button>
      ) : (
        <p className="text-xs text-fg-muted">
          Maximum of {maxFilters} filters reached.
        </p>
      )}
    </div>
  );
}
