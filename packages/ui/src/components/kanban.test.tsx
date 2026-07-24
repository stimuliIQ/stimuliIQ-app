import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KanbanBoard, KanbanColumn, KanbanCard, type KanbanColumnDef } from "./kanban";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface TestLead {
  id: string;
  name: string;
  stage: string;
}

const columns: KanbanColumnDef[] = [
  { id: "new", title: "New", count: 2 },
  { id: "contacted", title: "Contacted", count: 1 },
  { id: "won", title: "Won", count: 0 },
];

const leads: TestLead[] = [
  { id: "l1", name: "Priya Sharma", stage: "new" },
  { id: "l2", name: "Ravi Kumar", stage: "new" },
  { id: "l3", name: "Anita Singh", stage: "contacted" },
];

function renderBoard(onMove = vi.fn()): ReturnType<typeof render> {
  return render(
    <KanbanBoard
      columns={columns}
      items={leads}
      getItemId={(lead) => lead.id}
      getItemColumnId={(lead) => lead.stage}
      renderCard={(lead) => <p>{lead.name}</p>}
      onMove={onMove}
      getCardAriaLabel={(lead) => lead.name}
    />,
  );
}

// ---------------------------------------------------------------------------
// KanbanBoard rendering
// ---------------------------------------------------------------------------

describe("KanbanBoard", () => {
  it("renders a region with aria-label='Kanban board'", () => {
    renderBoard();
    expect(screen.getByRole("region", { name: "Kanban board" })).toBeInTheDocument();
  });

  it("renders each column as a section with accessible label", () => {
    renderBoard();
    // Columns should be sections with aria-label containing title
    expect(screen.getByRole("region", { name: /New/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Contacted/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Won/i })).toBeInTheDocument();
  });

  it("renders column titles", () => {
    renderBoard();
    // getByText gets the actual title headings
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
  });

  it("renders all items in their correct columns", () => {
    renderBoard();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("Anita Singh")).toBeInTheDocument();
  });

  it("renders card content from the renderCard prop", () => {
    renderBoard();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("shows empty state for empty columns", () => {
    renderBoard();
    // Won column has 0 items — should show empty text
    const wonColumn = screen.getByRole("region", { name: /Won/i });
    expect(within(wonColumn).getByText(/[Ee]mpty/)).toBeInTheDocument();
  });

  it("renders cards with aria-label from getCardAriaLabel", () => {
    renderBoard();
    expect(screen.getByRole("article", { name: "Priya Sharma" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Ravi Kumar" })).toBeInTheDocument();
  });

  it("renders count badges in column headers", () => {
    renderBoard();
    // 2 items in "New" column — count should reflect items[] length
    const newColumn = screen.getByRole("region", { name: /New/i });
    // The badge shows the count of items in the column (grouped from items prop)
    expect(within(newColumn).getByText("2")).toBeInTheDocument();
  });

  it("uses data-testid on the board container", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={leads}
        getItemId={(l) => l.id}
        getItemColumnId={(l) => l.stage}
        renderCard={(l) => <p>{l.name}</p>}
        data-testid="my-board"
      />,
    );
    expect(screen.getByTestId("my-board")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// KanbanCard — DnD seam attributes
// ---------------------------------------------------------------------------

describe("KanbanCard (DnD seam)", () => {
  it("exposes data-kanban-item-id and data-kanban-column-id attributes", () => {
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        ariaLabel="Priya Sharma"
        onMove={vi.fn()}
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );
    const card = screen.getByTestId("kanban-card");
    expect(card).toHaveAttribute("data-kanban-item-id", "l1");
    expect(card).toHaveAttribute("data-kanban-column-id", "new");
  });

  it("is keyboard-focusable (tabIndex=0)", () => {
    render(
      <KanbanCard itemId="l1" columnId="new" columns={columns} ariaLabel="Priya Sharma">
        <p>Priya Sharma</p>
      </KanbanCard>,
    );
    const card = screen.getByTestId("kanban-card");
    expect(card).toHaveAttribute("tabindex", "0");
  });

  it("has role=article with aria-label", () => {
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        ariaLabel="Priya Sharma"
        onMove={vi.fn()}
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );
    expect(screen.getByRole("article", { name: "Priya Sharma" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// KanbanCard — accessible move menu
// ---------------------------------------------------------------------------

describe("KanbanCard move control", () => {
  it("renders a 'Move card' button with aria-label", () => {
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={vi.fn()}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );
    // The button is present (may be opacity-0 until hover, but in DOM)
    const moveButton = screen.getByRole("button", { name: "Move card" });
    expect(moveButton).toBeInTheDocument();
    expect(moveButton).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("expands the move Select when Move button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={vi.fn()}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );

    const moveButton = screen.getByRole("button", { name: "Move card" });
    await user.click(moveButton);

    // After click, the Select trigger should be visible (move button replaced)
    expect(screen.getByTestId("kanban-card-move-select")).toBeInTheDocument();
  });

  it("calls onMove with correct args when a column is selected from the move Select", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={onMove}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );

    // Open move menu
    const moveButton = screen.getByRole("button", { name: "Move card" });
    await user.click(moveButton);

    // Select trigger should be present
    const selectTrigger = screen.getByTestId("kanban-card-move-select");
    await user.click(selectTrigger);

    // Pick "Contacted" from the dropdown
    const contactedOption = await screen.findByRole("option", { name: "Contacted" });
    await user.click(contactedOption);

    expect(onMove).toHaveBeenCalledWith("l1", "new", "contacted");
  });

  it("does not render a move button when onMove is not provided", () => {
    render(
      <KanbanCard itemId="l1" columnId="new" columns={columns} ariaLabel="Priya Sharma">
        <p>Priya Sharma</p>
      </KanbanCard>,
    );
    expect(screen.queryByRole("button", { name: "Move card" })).not.toBeInTheDocument();
  });

  it("excludes the current column from the move target list", async () => {
    const user = userEvent.setup();
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={vi.fn()}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );

    const moveButton = screen.getByRole("button", { name: "Move card" });
    await user.click(moveButton);

    const selectTrigger = screen.getByTestId("kanban-card-move-select");
    await user.click(selectTrigger);

    // "New" is the current column — should NOT appear in options
    const options = await screen.findAllByRole("option");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain("New");
    expect(optionTexts).toContain("Contacted");
    expect(optionTexts).toContain("Won");
  });

  it("excludes canMove-forbidden columns from the move target list", async () => {
    const user = userEvent.setup();
    // Forward-only rule: from "new" only "contacted" and "lost" are legal.
    const canMove = (_id: string, from: string, to: string) =>
      from === "new" && (to === "contacted" || to === "lost");
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={vi.fn()}
        canMove={canMove}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );

    const moveButton = screen.getByRole("button", { name: "Move card" });
    await user.click(moveButton);
    const selectTrigger = screen.getByTestId("kanban-card-move-select");
    await user.click(selectTrigger);

    const optionTexts = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(optionTexts).toContain("Contacted"); // legal forward move
    expect(optionTexts).not.toContain("New"); // current column, always excluded
    expect(optionTexts).not.toContain("Won"); // forbidden by canMove
  });

  it("opens move Select via keyboard Enter on the Move button", async () => {
    const user = userEvent.setup();
    render(
      <KanbanCard
        itemId="l1"
        columnId="new"
        columns={columns}
        onMove={vi.fn()}
        ariaLabel="Priya Sharma"
      >
        <p>Priya Sharma</p>
      </KanbanCard>,
    );

    const moveButton = screen.getByRole("button", { name: "Move card" });
    moveButton.focus();
    await user.keyboard("{Enter}");

    // Select should now be visible
    expect(screen.getByTestId("kanban-card-move-select")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// KanbanBoard — keyboard-accessible in-column reordering
// ---------------------------------------------------------------------------

describe("KanbanBoard reorder controls", () => {
  it("does not render reorder buttons when onReorder is not provided", () => {
    renderBoard();
    expect(screen.queryByRole("button", { name: "Move card up" })).not.toBeInTheDocument();
  });

  it("renders reorder up/down buttons when onReorder is provided", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={leads}
        getItemId={(l) => l.id}
        getItemColumnId={(l) => l.stage}
        renderCard={(l) => <p>{l.name}</p>}
        onReorder={vi.fn()}
        getCardAriaLabel={(l) => l.name}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Move card up" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Move card down" }).length).toBeGreaterThan(0);
  });

  it("disables 'Move card up' for the first item in a column and 'Move card down' for the last", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={leads}
        getItemId={(l) => l.id}
        getItemColumnId={(l) => l.stage}
        renderCard={(l) => <p>{l.name}</p>}
        onReorder={vi.fn()}
        getCardAriaLabel={(l) => l.name}
      />,
    );
    // "New" column has 2 items: Priya Sharma (first), Ravi Kumar (second).
    const priyaCard = screen.getByRole("article", { name: "Priya Sharma" });
    const raviCard = screen.getByRole("article", { name: "Ravi Kumar" });
    expect(within(priyaCard).getByRole("button", { name: "Move card up" })).toBeDisabled();
    expect(within(priyaCard).getByRole("button", { name: "Move card down" })).toBeEnabled();
    expect(within(raviCard).getByRole("button", { name: "Move card down" })).toBeDisabled();
    expect(within(raviCard).getByRole("button", { name: "Move card up" })).toBeEnabled();
  });

  it("calls onReorder with itemId, columnId, and direction", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(
      <KanbanBoard
        columns={columns}
        items={leads}
        getItemId={(l) => l.id}
        getItemColumnId={(l) => l.stage}
        renderCard={(l) => <p>{l.name}</p>}
        onReorder={onReorder}
        getCardAriaLabel={(l) => l.name}
      />,
    );
    const raviCard = screen.getByRole("article", { name: "Ravi Kumar" });
    await user.click(within(raviCard).getByRole("button", { name: "Move card up" }));
    expect(onReorder).toHaveBeenCalledWith("l2", "new", "up");
  });
});

// ---------------------------------------------------------------------------
// KanbanBoard — native drag-and-drop
// ---------------------------------------------------------------------------

// jsdom has no real DataTransfer — this stand-in stores set/getData round-trips
// so the board's dragstart→drop payload handshake can be exercised.
function makeDataTransfer(): DataTransfer {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, val: string) => {
      store[type] = val;
    },
    getData: (type: string) => store[type] ?? "",
    dropEffect: "none",
    effectAllowed: "all",
  } as unknown as DataTransfer;
}

describe("KanbanBoard drag-and-drop", () => {
  it("makes cards draggable when onMove is provided", () => {
    renderBoard();
    expect(screen.getByRole("article", { name: "Priya Sharma" })).toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("does not make cards draggable when onMove is absent", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={leads}
        getItemId={(l) => l.id}
        getItemColumnId={(l) => l.stage}
        renderCard={(l) => <p>{l.name}</p>}
        getCardAriaLabel={(l) => l.name}
      />,
    );
    expect(screen.getByRole("article", { name: "Priya Sharma" })).toHaveAttribute(
      "draggable",
      "false",
    );
  });

  it("calls onMove(itemId, from, to) when a card is dropped on a different column", () => {
    const onMove = vi.fn();
    renderBoard(onMove);
    const dt = makeDataTransfer();
    const card = screen.getByRole("article", { name: "Priya Sharma" }); // in "new"
    const target = screen.getByRole("region", { name: /Contacted/i });

    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    expect(onMove).toHaveBeenCalledWith("l1", "new", "contacted");
  });

  it("does NOT call onMove when a card is dropped back on its own column", () => {
    const onMove = vi.fn();
    renderBoard(onMove);
    const dt = makeDataTransfer();
    const card = screen.getByRole("article", { name: "Priya Sharma" }); // in "new"
    const sameColumn = screen.getByRole("region", { name: /New —/i });

    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(sameColumn, { dataTransfer: dt });

    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks the hovered target column active while dragging, and clears it on drop", () => {
    const onMove = vi.fn();
    renderBoard(onMove);
    const dt = makeDataTransfer();
    const card = screen.getByRole("article", { name: "Priya Sharma" });
    const target = screen.getByRole("region", { name: /Contacted/i });

    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    expect(target).toHaveAttribute("data-drop-active", "true");

    fireEvent.drop(target, { dataTransfer: dt });
    expect(target).not.toHaveAttribute("data-drop-active");
  });
});

// ---------------------------------------------------------------------------
// KanbanColumn standalone
// ---------------------------------------------------------------------------

describe("KanbanColumn", () => {
  function ColumnHarness(): JSX.Element {
    return (
      <KanbanColumn column={{ id: "new", title: "New Leads", count: 3 }}>
        <div>Card 1</div>
        <div>Card 2</div>
      </KanbanColumn>
    );
  }

  it("renders as a section with accessible label", () => {
    render(<ColumnHarness />);
    expect(
      screen.getByRole("region", { name: "New Leads — 3 items" }),
    ).toBeInTheDocument();
  });

  it("renders the column title", () => {
    render(<ColumnHarness />);
    expect(screen.getByText("New Leads")).toBeInTheDocument();
  });

  it("renders the count badge", () => {
    render(<ColumnHarness />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders children (card slots)", () => {
    render(<ColumnHarness />);
    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 2")).toBeInTheDocument();
  });
});
