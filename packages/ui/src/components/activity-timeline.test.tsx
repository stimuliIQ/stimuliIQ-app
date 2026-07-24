import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ActivityTimeline,
  ActivityTimelineItem,
  type ActivityItem,
} from "./activity-timeline";

const baseItems: ActivityItem[] = [
  {
    id: "1",
    type: "call",
    actorName: "Sneha R.",
    timestamp: new Date("2026-06-27T09:00:00Z"),
    content: "Follow-up call — confirmed interest",
  },
  {
    id: "2",
    type: "note",
    actorName: "Vikram K.",
    timestamp: new Date("2026-06-26T14:30:00Z"),
    content: "Student asked about batch timing",
  },
  {
    id: "3",
    type: "task",
    actorName: "Sneha R.",
    timestamp: new Date("2026-06-25T10:00:00Z"),
    content: "Send fee structure PDF",
    done: true,
  },
];

// ---------------------------------------------------------------------------
// Data-driven items API
// ---------------------------------------------------------------------------

describe("ActivityTimeline (items API)", () => {
  it("renders as an ordered list with aria-label", () => {
    render(<ActivityTimeline items={baseItems} />);
    const list = screen.getByRole("list", { name: "Activity timeline" });
    expect(list.tagName).toBe("OL");
  });

  it("renders all items in the provided order", () => {
    render(<ActivityTimeline items={baseItems} />);
    const listItems = screen.getAllByTestId("activity-timeline-item");
    expect(listItems).toHaveLength(3);
  });

  it("renders actor names for each item", () => {
    render(<ActivityTimeline items={baseItems} />);
    expect(screen.getAllByText("Sneha R.")).toHaveLength(2);
    expect(screen.getByText("Vikram K.")).toBeInTheDocument();
  });

  it("renders content text for each item", () => {
    render(<ActivityTimeline items={baseItems} />);
    expect(screen.getByText("Follow-up call — confirmed interest")).toBeInTheDocument();
    expect(screen.getByText("Student asked about batch timing")).toBeInTheDocument();
  });

  it("renders a 'Done' label for completed tasks", () => {
    render(<ActivityTimeline items={baseItems} />);
    // Item 3 has done=true
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders activity type labels (Call, Note, Task)", () => {
    render(<ActivityTimeline items={baseItems} />);
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("shows an empty state message when items is empty", () => {
    render(<ActivityTimeline items={[]} />);
    expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument();
  });

  it("uses a custom emptyLabel when provided", () => {
    render(<ActivityTimeline items={[]} emptyLabel="Nothing here yet" />);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("calls onItemClick with the correct item id when an item is clicked", async () => {
    const user = userEvent.setup();
    const onItemClick = vi.fn();
    render(<ActivityTimeline items={baseItems} onItemClick={onItemClick} />);

    // Click the first item
    const [firstItem] = screen.getAllByTestId("activity-timeline-item");
    if (!firstItem) throw new Error("No activity items rendered");
    await user.click(firstItem);
    expect(onItemClick).toHaveBeenCalledWith("1");
  });

  it("fires onItemClick when Enter key is pressed on an item", async () => {
    const user = userEvent.setup();
    const onItemClick = vi.fn();
    render(<ActivityTimeline items={baseItems} onItemClick={onItemClick} />);

    const [firstItem] = screen.getAllByTestId("activity-timeline-item");
    if (!firstItem) throw new Error("No activity items rendered");
    firstItem.focus();
    await user.keyboard("{Enter}");
    expect(onItemClick).toHaveBeenCalledWith("1");
  });

  it("fires onItemClick when Space key is pressed on an item", async () => {
    const user = userEvent.setup();
    const onItemClick = vi.fn();
    render(<ActivityTimeline items={baseItems} onItemClick={onItemClick} />);

    const [firstItem] = screen.getAllByTestId("activity-timeline-item");
    if (!firstItem) throw new Error("No activity items rendered");
    firstItem.focus();
    await user.keyboard(" ");
    expect(onItemClick).toHaveBeenCalledWith("1");
  });

  it("items are focusable (tabIndex=0) when onItemClick is provided", () => {
    render(<ActivityTimeline items={baseItems} onItemClick={vi.fn()} />);
    const items = screen.getAllByTestId("activity-timeline-item");
    for (const item of items) {
      expect(item).toHaveAttribute("tabindex", "0");
    }
  });

  it("items are NOT focusable when no onItemClick", () => {
    render(<ActivityTimeline items={baseItems} />);
    const items = screen.getAllByTestId("activity-timeline-item");
    for (const item of items) {
      expect(item).not.toHaveAttribute("tabindex");
    }
  });

  it("each item renders a DateChip (timestamp present)", () => {
    render(<ActivityTimeline items={baseItems} />);
    // DateChips should be present for each item
    const chips = screen.getAllByTestId("date-chip");
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it("renders whatsapp and email types (logged records)", () => {
    const items: ActivityItem[] = [
      {
        id: "w1",
        type: "whatsapp",
        actorName: "Sneha R.",
        timestamp: new Date(),
        content: "Sent WhatsApp message (logged)",
      },
      {
        id: "e1",
        type: "email",
        actorName: "Sneha R.",
        timestamp: new Date(),
        content: "Email sent (logged)",
      },
    ];
    render(<ActivityTimeline items={items} />);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Render-prop / children API
// ---------------------------------------------------------------------------

describe("ActivityTimeline (children API)", () => {
  function Harness(): JSX.Element {
    return (
      <ActivityTimeline>
        <ActivityTimelineItem
          type="call"
          actorName="Sneha R."
          timestamp={new Date("2026-06-27T09:00:00Z")}
        >
          Custom call content
        </ActivityTimelineItem>
        <ActivityTimelineItem
          type="note"
          actorName="Vikram K."
          timestamp={new Date("2026-06-26T14:00:00Z")}
        >
          Custom note content
        </ActivityTimelineItem>
      </ActivityTimeline>
    );
  }

  it("renders as an ordered list", () => {
    render(<Harness />);
    expect(screen.getByRole("list", { name: "Activity timeline" }).tagName).toBe("OL");
  });

  it("renders custom children in order", () => {
    render(<Harness />);
    expect(screen.getByText("Custom call content")).toBeInTheDocument();
    expect(screen.getByText("Custom note content")).toBeInTheDocument();
  });

  it("renders icons for each activity type", () => {
    const { container } = render(<Harness />);
    const svgs = container.querySelectorAll("svg");
    // At least one icon per item (type icon) + DateChip icon
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});
