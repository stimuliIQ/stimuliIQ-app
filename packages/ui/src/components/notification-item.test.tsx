import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationItem } from "./notification-item";

const BASE_PROPS = {
  id: "notif-1",
  type: "grade_ready" as const,
  title: "Your assignment has been graded",
  body: "Python Basics — Module 3: scored 82/100.",
  timestamp: new Date("2025-01-01T10:00:00Z"),
  isRead: false,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("NotificationItem — rendering", () => {
  it("renders with default data-testid='notification-item'", () => {
    render(<NotificationItem {...BASE_PROPS} />);
    expect(screen.getByTestId("notification-item")).toBeInTheDocument();
  });

  it("renders the notification title", () => {
    render(<NotificationItem {...BASE_PROPS} />);
    expect(screen.getByText("Your assignment has been graded")).toBeInTheDocument();
  });

  it("renders the body text", () => {
    render(<NotificationItem {...BASE_PROPS} />);
    expect(screen.getByText("Python Basics — Module 3: scored 82/100.")).toBeInTheDocument();
  });

  it("renders a <time> element with dateTime attribute", () => {
    render(<NotificationItem {...BASE_PROPS} />);
    // <time> elements don't have a built-in ARIA role — use querySelector
    const timeEl = document.querySelector("time");
    expect(timeEl).toBeInTheDocument();
    expect(timeEl).toHaveAttribute("dateTime");
  });

  it("shows 'New' badge for unread items", () => {
    render(<NotificationItem {...BASE_PROPS} isRead={false} />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("does not show 'New' badge for read items", () => {
    render(<NotificationItem {...BASE_PROPS} isRead={true} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("renders the action CTA when actionLabel + onAction provided", () => {
    const onAction = vi.fn();
    render(
      <NotificationItem
        {...BASE_PROPS}
        actionLabel="View grade"
        onAction={onAction}
      />,
    );
    expect(screen.getByRole("button", { name: "View grade" })).toBeInTheDocument();
  });

  it("does not render the action CTA when not provided", () => {
    render(<NotificationItem {...BASE_PROPS} />);
    expect(screen.queryByRole("button", { name: "View grade" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y — status never color-only
// ---------------------------------------------------------------------------

describe("NotificationItem — a11y", () => {
  it("announces notification type to screen readers via sr-only text", () => {
    const { container } = render(<NotificationItem {...BASE_PROPS} type="grade_ready" />);
    const srSpan = container.querySelector(".sr-only");
    expect(srSpan?.textContent).toContain("Grade ready");
  });

  it("mark-as-read button has an aria-label including the notification title", () => {
    const onMarkRead = vi.fn();
    render(<NotificationItem {...BASE_PROPS} onMarkRead={onMarkRead} />);
    const btn = screen.getByRole("button", { name: /mark.*graded.*as read/i });
    expect(btn).toBeInTheDocument();
  });

  it("mark-as-read button is absent for read items", () => {
    const onMarkRead = vi.fn();
    render(<NotificationItem {...BASE_PROPS} isRead={true} onMarkRead={onMarkRead} />);
    // Should not be present
    expect(screen.queryByRole("button", { name: /mark.*as read/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("NotificationItem — interactions", () => {
  it("calls onMarkRead with the notification id when the mark-read button is clicked", async () => {
    const user = userEvent.setup();
    const onMarkRead = vi.fn();
    render(<NotificationItem {...BASE_PROPS} onMarkRead={onMarkRead} />);
    await user.click(screen.getByRole("button", { name: /mark.*as read/i }));
    expect(onMarkRead).toHaveBeenCalledWith("notif-1");
  });

  it("calls onAction when the CTA button is clicked", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <NotificationItem
        {...BASE_PROPS}
        actionLabel="View grade"
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("button", { name: "View grade" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
