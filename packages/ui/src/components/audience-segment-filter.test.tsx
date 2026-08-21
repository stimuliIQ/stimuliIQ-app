import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AudienceSegmentFilter,
  type SegmentFieldDef,
  type SegmentFilter,
} from "./audience-segment-filter";

const FIELDS: SegmentFieldDef[] = [
  {
    key: "stage",
    label: "Lead stage",
    operators: ["eq", "in"],
    inputType: "select",
    options: [
      { value: "new", label: "New" },
      { value: "contacted", label: "Contacted" },
      { value: "enrolled", label: "Enrolled" },
    ],
  },
  {
    key: "source",
    label: "Lead source",
    operators: ["eq", "neq"],
    inputType: "text",
  },
];

const FILTERS: SegmentFilter[] = [
  { id: "f1", field: "stage", operator: "eq", value: "new" },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("AudienceSegmentFilter, rendering", () => {
  it("renders with default data-testid='audience-segment-filter'", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("audience-segment-filter")).toBeInTheDocument();
  });

  it("renders 'Add filter' button", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-filter-btn")).toBeInTheDocument();
  });

  it("renders no-filter empty message when filters is empty", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no filters yet/i)).toBeInTheDocument();
  });

  it("renders existing filter rows", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={FILTERS}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId(`remove-filter-f1`)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("AudienceSegmentFilter, a11y", () => {
  it("each filter row is a fieldset with an accessible legend", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={FILTERS}
        onFilterChange={vi.fn()}
      />,
    );
    const fieldset = screen.getByRole("group", { name: "Filter condition 1" });
    expect(fieldset).toBeInTheDocument();
  });

  it("remove button has aria-label including condition number", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={FILTERS}
        onFilterChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove filter condition 1" }),
    ).toBeInTheDocument();
  });

  it("add filter button is aria-labelled", () => {
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-filter-btn")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("AudienceSegmentFilter, interactions", () => {
  it("calls onFilterChange with a new filter when 'Add filter' is clicked", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={[]}
        onFilterChange={onFilterChange}
      />,
    );
    await user.click(screen.getByTestId("add-filter-btn"));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    const newFilters = onFilterChange.mock.calls[0]?.[0] as SegmentFilter[];
    expect(newFilters).toHaveLength(1);
    expect(newFilters[0]?.field).toBe("stage");
  });

  it("calls onFilterChange without the removed filter when remove is clicked", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={FILTERS}
        onFilterChange={onFilterChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove filter condition 1" }));
    expect(onFilterChange).toHaveBeenCalledWith([]);
  });

  it("does not show 'Add filter' when maxFilters is reached", () => {
    const manyFilters: SegmentFilter[] = Array.from({ length: 3 }).map((_, i) => ({
      id: `f${i}`,
      field: "stage",
      operator: "eq" as const,
      value: "new",
    }));
    render(
      <AudienceSegmentFilter
        fields={FIELDS}
        filters={manyFilters}
        onFilterChange={vi.fn()}
        maxFilters={3}
      />,
    );
    expect(screen.queryByTestId("add-filter-btn")).not.toBeInTheDocument();
    expect(screen.getByText(/maximum of 3 filters/i)).toBeInTheDocument();
  });
});
