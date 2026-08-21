import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationBell, type NotificationBellItem } from "./notification-bell";

const ITEMS: NotificationBellItem[] = [
  {
    id: "n1",
    type: "grade_ready",
    title: "Assignment graded",
    timestamp: new Date(),
    isRead: false,
  },
  {
    id: "n2",
    type: "announcement",
    title: "New batch announcement",
    timestamp: new Date(),
    isRead: true,
  },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("NotificationBell, rendering", () => {
  it("renders with default data-testid='notification-bell'", () => {
    render(
      <NotificationBell items={ITEMS} onMarkRead={vi.fn()} />,
    );
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
  });

  it("shows unread count badge when there are unread items", () => {
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    // 1 unread (n1)
    expect(screen.getByLabelText(/1 unread/)).toBeInTheDocument();
  });

  it("shows 'none unread' label when all items are read", () => {
    const allRead = ITEMS.map((i) => ({ ...i, isRead: true }));
    render(<NotificationBell items={allRead} onMarkRead={vi.fn()} />);
    expect(screen.getByLabelText(/none unread/)).toBeInTheDocument();
  });

  it("has aria-haspopup=true on the bell button", () => {
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    expect(screen.getByTestId("notification-bell")).toHaveAttribute("aria-haspopup", "true");
  });

  it("dropdown is not visible initially", () => {
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    expect(screen.queryByTestId("notification-bell-dropdown")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Open/close
// ---------------------------------------------------------------------------

describe("NotificationBell, open/close", () => {
  it("opens dropdown when bell is clicked", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    await user.click(screen.getByTestId("notification-bell"));
    expect(screen.getByTestId("notification-bell-dropdown")).toBeInTheDocument();
  });

  it("shows notification items in the dropdown", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    await user.click(screen.getByTestId("notification-bell"));
    expect(screen.getByText("Assignment graded")).toBeInTheDocument();
    expect(screen.getByText("New batch announcement")).toBeInTheDocument();
  });

  it("closes dropdown when the close button is clicked", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    await user.click(screen.getByTestId("notification-bell"));
    await user.click(screen.getByRole("button", { name: "Close notifications" }));
    expect(screen.queryByTestId("notification-bell-dropdown")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    await user.click(screen.getByTestId("notification-bell"));
    expect(screen.getByTestId("notification-bell-dropdown")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("notification-bell-dropdown")).not.toBeInTheDocument();
  });

  it("aria-expanded reflects open state", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    const bell = screen.getByTestId("notification-bell");
    expect(bell).toHaveAttribute("aria-expanded", "false");
    await user.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
  });
});

// ---------------------------------------------------------------------------
// a11y, live-region
// ---------------------------------------------------------------------------

describe("NotificationBell, a11y live-region", () => {
  it("renders a live-region with role='status' and aria-live='polite'", () => {
    render(<NotificationBell items={ITEMS} onMarkRead={vi.fn()} />);
    const region = screen.getByTestId("notification-live-region");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
  });

  it("announces new notifications when newItemIds changes", async () => {
    const { rerender } = render(
      <NotificationBell items={ITEMS} onMarkRead={vi.fn()} newItemIds={new Set()} />,
    );
    const region = screen.getByTestId("notification-live-region");
    expect(region.textContent).toBe("");

    rerender(
      <NotificationBell
        items={ITEMS}
        onMarkRead={vi.fn()}
        newItemIds={new Set(["n1"])}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("notification-live-region").textContent).toContain(
        "1 new notification arrived",
      );
    });
  });

  it("announces plural when multiple new items arrive", async () => {
    const { rerender } = render(
      <NotificationBell items={ITEMS} onMarkRead={vi.fn()} newItemIds={new Set()} />,
    );
    rerender(
      <NotificationBell
        items={ITEMS}
        onMarkRead={vi.fn()}
        newItemIds={new Set(["n1", "n2"])}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("notification-live-region").textContent).toContain(
        "2 new notifications arrived",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Mark-all-read
// ---------------------------------------------------------------------------

describe("NotificationBell, mark all read", () => {
  it("calls onMarkAllRead when 'All read' button is clicked", async () => {
    const user = userEvent.setup();
    const onMarkAllRead = vi.fn();
    render(
      <NotificationBell items={ITEMS} onMarkRead={vi.fn()} onMarkAllRead={onMarkAllRead} />,
    );
    await user.click(screen.getByTestId("notification-bell"));
    await user.click(screen.getByRole("button", { name: "Mark all notifications as read" }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

describe("NotificationBell, empty state", () => {
  it("shows empty state when no items", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={[]} onMarkRead={vi.fn()} />);
    await user.click(screen.getByTestId("notification-bell"));
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it("shows skeleton rows when loading=true", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={[]} onMarkRead={vi.fn()} loading />);
    await user.click(screen.getByTestId("notification-bell"));
    // Skeleton rows are animated divs, check the dropdown is open
    expect(screen.getByTestId("notification-bell-dropdown")).toBeInTheDocument();
  });
});
