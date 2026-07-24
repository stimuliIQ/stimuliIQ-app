import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataFilterBar, type FilterChip, type SavedFilterView } from "./data-filter-bar";

const CHIPS: FilterChip[] = [
  { id: "status", label: "Status: Active", onRemove: vi.fn() },
  { id: "branch", label: "Branch: Hyderabad", onRemove: vi.fn() },
];

const VIEWS: SavedFilterView[] = [
  { id: "v1", name: "My leads" },
  { id: "v2", name: "Hot leads" },
];

describe("DataFilterBar — search", () => {
  it("renders a labelled search input and calls onSearchChange", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(<DataFilterBar searchValue="" onSearchChange={onSearchChange} />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    await user.type(input, "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  it("does not render a search input when onSearchChange is not provided", () => {
    render(<DataFilterBar />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("DataFilterBar — filter chips", () => {
  it("renders active filter chips as visible text", () => {
    render(<DataFilterBar chips={CHIPS} />);
    expect(screen.getByText("Status: Active")).toBeInTheDocument();
    expect(screen.getByText("Branch: Hyderabad")).toBeInTheDocument();
  });

  it("calls onRemove when a chip's remove button is clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<DataFilterBar chips={[{ id: "status", label: "Status: Active", onRemove }]} />);
    await user.click(screen.getByRole("button", { name: "Remove filter: Status: Active" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("calls onClearAll when Clear all is clicked", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    render(<DataFilterBar chips={CHIPS} onClearAll={onClearAll} />);
    await user.click(screen.getByTestId("data-filter-bar-clear-all"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("renders no chip row when there are no chips", () => {
    render(<DataFilterBar chips={[]} onClearAll={vi.fn()} />);
    expect(screen.queryByTestId("data-filter-bar-clear-all")).not.toBeInTheDocument();
  });
});

describe("DataFilterBar — saved views", () => {
  it("renders saved views plus an 'All' toggle", () => {
    render(<DataFilterBar savedViews={VIEWS} activeViewId={null} onSelectView={vi.fn()} />);
    expect(screen.getByTestId("data-filter-bar-view-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("My leads")).toBeInTheDocument();
    expect(screen.getByText("Hot leads")).toBeInTheDocument();
  });

  it("calls onSelectView with the view id when a saved view is clicked", async () => {
    const user = userEvent.setup();
    const onSelectView = vi.fn();
    render(<DataFilterBar savedViews={VIEWS} activeViewId={null} onSelectView={onSelectView} />);
    await user.click(screen.getByTestId("data-filter-bar-view-v1"));
    expect(onSelectView).toHaveBeenCalledWith("v1");
  });

  it("marks the active view with aria-pressed=true", () => {
    render(<DataFilterBar savedViews={VIEWS} activeViewId="v2" onSelectView={vi.fn()} />);
    expect(screen.getByTestId("data-filter-bar-view-v2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("data-filter-bar-view-all")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onDeleteView when a saved view's delete button is clicked", async () => {
    const user = userEvent.setup();
    const onDeleteView = vi.fn();
    render(<DataFilterBar savedViews={VIEWS} onSelectView={vi.fn()} onDeleteView={onDeleteView} />);
    await user.click(screen.getByTestId("data-filter-bar-view-delete-v1"));
    expect(onDeleteView).toHaveBeenCalledWith("v1");
  });

  it("saves a new view via the inline name field (no window.prompt)", async () => {
    const user = userEvent.setup();
    const onSaveView = vi.fn();
    render(<DataFilterBar onSaveView={onSaveView} />);
    await user.click(screen.getByTestId("data-filter-bar-save-view"));
    await user.type(screen.getByTestId("data-filter-bar-view-name-input"), "New saved view");
    await user.click(screen.getByTestId("data-filter-bar-save-view-confirm"));
    expect(onSaveView).toHaveBeenCalledWith("New saved view");
  });
});

describe("DataFilterBar — extra controls", () => {
  it("renders children between search and save view", () => {
    render(
      <DataFilterBar searchValue="" onSearchChange={vi.fn()}>
        <div data-testid="extra-select">Status filter</div>
      </DataFilterBar>,
    );
    expect(screen.getByTestId("extra-select")).toBeInTheDocument();
  });
});
