import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTable, type DataTableColumn } from "./data-table";

interface StudentRow {
  id: string;
  name: string;
  status: string;
}

const rows: StudentRow[] = [
  { id: "1", name: "Aditi Sharma", status: "Active" },
  { id: "2", name: "Rohan Verma", status: "Lead" },
];

const columns: Array<DataTableColumn<StudentRow>> = [
  { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
  { id: "status", header: "Status", cell: (row) => row.status },
];

function getRowId(row: StudentRow): string {
  return row.id;
}

describe("DataTable", () => {
  it("renders semantic table markup with scoped column headers", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={getRowId} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    expect(nameHeader).toHaveAttribute("scope", "col");
    expect(screen.getAllByTestId("data-table-row")).toHaveLength(2);
    expect(screen.getByText("Aditi Sharma")).toBeInTheDocument();
  });

  it("exposes aria-sort and calls onSortChange when a sortable header is activated", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        sort={{ sortBy: null, sortDir: "asc", onSortChange }}
      />,
    );

    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    expect(nameHeader).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByTestId("data-table-sort-name"));
    expect(onSortChange).toHaveBeenCalledWith("name", "asc");
  });

  it("shows skeleton rows while loading and an empty state when there are no rows", () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} getRowId={getRowId} loading loadingRowCount={3} />,
    );
    expect(screen.queryAllByTestId("data-table-row")).toHaveLength(0);

    rerender(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={getRowId}
        loading={false}
        emptyState={{ title: "No students yet", description: "Adjust your filters." }}
      />,
    );
    expect(screen.getByTestId("data-table-empty")).toBeInTheDocument();
    expect(screen.getByText("No students yet")).toBeInTheDocument();
  });

  it("supports row selection via header select-all and per-row checkboxes", async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        selection={{ selectedIds: new Set(), onSelectionChange, getRowId }}
      />,
    );

    await user.click(screen.getByTestId("data-table-select-all"));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(["1", "2"]));
  });

  it("paginates with a controlled callback and announces the visible range", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        pagination={{ page: 1, pageSize: 2, total: 5, onPageChange }}
      />,
    );

    expect(screen.getByText("Showing 1–2 of 5")).toBeInTheDocument();
    await user.click(screen.getByTestId("pagination-next"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders per-row actions without triggering the row click handler", async () => {
    const onRowClick = vi.fn();
    const onActionClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        onRowClick={onRowClick}
        rowActions={(row): JSX.Element => (
          <button onClick={() => onActionClick(row.id)}>Edit</button>
        )}
      />,
    );

    const [firstRow] = screen.getAllByTestId("data-table-row");
    await user.click(within(firstRow!).getByRole("button", { name: "Edit" }));

    expect(onActionClick).toHaveBeenCalledWith("1");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders an optional toolbar slot above the table (e.g. DataFilterBar)", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        toolbar={<div data-testid="my-filter-bar">Filters</div>}
      />,
    );
    expect(screen.getByTestId("data-table-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("my-filter-bar")).toBeInTheDocument();
  });

  it("renders no toolbar wrapper when toolbar is not provided", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={getRowId} />);
    expect(screen.queryByTestId("data-table-toolbar")).not.toBeInTheDocument();
  });
});
