import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Calendar, type CalendarEvent } from "./calendar";

const ANCHOR = new Date(2026, 6, 9); // 9 Jul 2026 (Thursday)

const EVENTS: CalendarEvent[] = [
  { id: "e1", title: "Live Class: React Hooks", start: new Date(2026, 6, 9, 10, 0), end: new Date(2026, 6, 9, 11, 0) },
  { id: "e2", title: "Doubt Session", start: new Date(2026, 6, 15, 15, 0) },
];

describe("Calendar — month view", () => {
  it("renders the month grid with the anchor month label", () => {
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} />);
    expect(screen.getByRole("grid", { name: /July 2026/i })).toBeInTheDocument();
    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });

  it("shows event titles inside their day cell", () => {
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} />);
    const dayCell = screen.getByRole("gridcell", { name: /^\w+, 9 July 2026, 1 event/i });
    expect(within(dayCell).getByText("Live Class: React Hooks")).toBeInTheDocument();
  });

  it("marks today with aria-current=date when in the displayed month", () => {
    const today = new Date();
    render(<Calendar events={[]} defaultAnchorDate={today} />);
    const cells = screen.getAllByRole("gridcell");
    const todayCell = cells.find((c) => c.getAttribute("aria-current") === "date");
    expect(todayCell).toBeDefined();
  });

  it("navigates to the previous/next month", async () => {
    const user = userEvent.setup();
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} />);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("June 2026")).toBeInTheDocument();
  });

  it("jumps to the current month via the Today button", async () => {
    const user = userEvent.setup();
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} />);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    const now = new Date();
    const expectedLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it("calls onDateSelect when a day cell is clicked", async () => {
    const user = userEvent.setup();
    const onDateSelect = vi.fn();
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} onDateSelect={onDateSelect} />);
    const dayCell = screen.getByRole("gridcell", { name: /^\w+, 15 July 2026, 1 event/i });
    await user.click(dayCell);
    expect(onDateSelect).toHaveBeenCalledTimes(1);
    const calledWith = onDateSelect.mock.calls[0]?.[0] as Date;
    expect(calledWith.getDate()).toBe(15);
  });

  it("moves roving focus with ArrowRight and calls onDateSelect via Enter", async () => {
    const user = userEvent.setup();
    const onDateSelect = vi.fn();
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} onDateSelect={onDateSelect} />);
    // Focus the initially-focusable cell (roving tabindex target = anchor date, 9 Jul).
    const grid = screen.getByRole("grid");
    const startCell = screen.getByRole("gridcell", { name: /^\w+, 9 July 2026/i });
    startCell.focus();
    expect(startCell).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    // Focus should move to 10 Jul.
    const nextCell = screen.getByRole("gridcell", { name: /^\w+, 10 July 2026/i });
    expect(nextCell).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onDateSelect).toHaveBeenCalledTimes(1);
    expect(grid).toBeInTheDocument();
  });

  it("only the roving-focus cell has tabIndex 0", () => {
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} />);
    const cells = screen.getAllByRole("gridcell");
    const zeroTabIndex = cells.filter((c) => c.getAttribute("tabindex") === "0");
    expect(zeroTabIndex).toHaveLength(1);
  });
});

describe("Calendar — agenda view", () => {
  it("switches to agenda view and lists events grouped by date", async () => {
    const user = userEvent.setup();
    render(<Calendar events={EVENTS} defaultAnchorDate={ANCHOR} defaultView="month" />);
    await user.click(screen.getByRole("tab", { name: "Agenda" }));
    expect(screen.getByTestId("calendar-agenda")).toBeInTheDocument();
    expect(screen.getByText("Live Class: React Hooks")).toBeInTheDocument();
    expect(screen.getByText("Doubt Session")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", async () => {
    const user = userEvent.setup();
    render(<Calendar events={[]} defaultAnchorDate={ANCHOR} defaultView="agenda" />);
    await user.click(screen.getByRole("tab", { name: "Agenda" }));
    expect(screen.getByText("No events scheduled")).toBeInTheDocument();
  });

  it("calls onEventClick when an agenda event is activated", async () => {
    const user = userEvent.setup();
    const onEventClick = vi.fn();
    render(
      <Calendar events={EVENTS} defaultAnchorDate={ANCHOR} defaultView="agenda" onEventClick={onEventClick} />,
    );
    await user.click(screen.getByTestId("calendar-agenda-event-e1"));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("calls onExportEvent (iCal export seam) when Add to calendar is clicked", async () => {
    const user = userEvent.setup();
    const onExportEvent = vi.fn();
    render(
      <Calendar
        events={EVENTS}
        defaultAnchorDate={ANCHOR}
        defaultView="agenda"
        onExportEvent={onExportEvent}
      />,
    );
    await user.click(screen.getByTestId("calendar-export-e1"));
    expect(onExportEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });
});

describe("Calendar — loading/error", () => {
  it("shows a loading state", () => {
    render(<Calendar events={[]} loading />);
    expect(screen.getByLabelText("Loading calendar")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    render(<Calendar events={[]} error="Failed to load calendar" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load calendar");
  });
});

describe("Calendar — day tone", () => {
  // Weekly offs and holidays cannot be modelled as events: 52 Sundays a year would exhaust
  // the two-events-per-day slots real events need. Hence a per-day tint instead.
  const isSunday = (d: Date) => d.getDay() === 0;

  it("tints the days the caller marks as non-working", () => {
    render(
      <Calendar
        events={[]}
        defaultAnchorDate={ANCHOR}
        dayTone={(d) => (isSunday(d) ? "nonWorking" : "default")}
      />,
    );
    const shaded = screen.getAllByTestId("calendar-day").filter((c) => c.dataset.tone === "nonWorking");
    // July 2026 shows 5 Sundays across the rendered 6-week grid (incl. adjacent months).
    expect(shaded.length).toBeGreaterThanOrEqual(4);
    for (const cell of shaded) {
      expect(new Date(`${cell.dataset.date}T00:00:00`).getDay()).toBe(0);
    }
  });

  it("leaves every day untinted when no dayTone is given", () => {
    render(<Calendar events={[]} defaultAnchorDate={ANCHOR} />);
    for (const cell of screen.getAllByTestId("calendar-day")) {
      expect(cell.dataset.tone).toBeUndefined();
    }
  });

  // Colour is never the only signal — a screen-reader user gets the same information.
  it("appends the caller's day label to the cell's accessible name", () => {
    render(
      <Calendar
        events={[]}
        defaultAnchorDate={ANCHOR}
        dayTone={(d) => (d.getDate() === 9 ? "highlight" : "default")}
        dayLabel={(d) => (d.getDate() === 9 ? "holiday: Test Day" : undefined)}
      />,
    );
    expect(screen.getByRole("gridcell", { name: /9 July 2026, holiday: Test Day/i })).toBeInTheDocument();
  });

  it("keeps the event count in the accessible name alongside the day label", () => {
    render(
      <Calendar
        events={EVENTS}
        defaultAnchorDate={ANCHOR}
        dayLabel={(d) => (d.getDate() === 9 ? "weekly off" : undefined)}
      />,
    );
    expect(
      screen.getByRole("gridcell", { name: /9 July 2026, weekly off, 1 event/i }),
    ).toBeInTheDocument();
  });
});
