import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThreadList, ThreadCard, type ThreadSummary } from "./thread-list";

const T1: ThreadSummary = {
  id: "t1",
  title: "How do I submit the final project?",
  authorDisplayName: "Priya S.",
  replyCount: 5,
  status: "open",
  lastActivityAt: new Date(),
};

const T2: ThreadSummary = {
  id: "t2",
  title: "Best resources for Python basics",
  authorDisplayName: "Rahul M.",
  replyCount: 12,
  status: "resolved",
  lastActivityAt: new Date(),
};

const T3: ThreadSummary = {
  id: "t3",
  title: "Welcome to the batch forum",
  authorDisplayName: "Dr. Vikram",
  replyCount: 0,
  status: "pinned",
  lastActivityAt: new Date(),
};

const THREADS: ThreadSummary[] = [T1, T2, T3];

// ---------------------------------------------------------------------------
// ThreadCard
// ---------------------------------------------------------------------------

describe("ThreadCard — rendering", () => {
  it("renders with default data-testid='thread-card'", () => {
    render(<ThreadCard thread={T1} />);
    expect(screen.getByTestId("thread-card")).toBeInTheDocument();
  });

  it("renders the thread title", () => {
    render(<ThreadCard thread={T1} />);
    expect(screen.getByText("How do I submit the final project?")).toBeInTheDocument();
  });

  it("renders the author display name", () => {
    render(<ThreadCard thread={T1} />);
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
  });

  it("renders the reply count", () => {
    render(<ThreadCard thread={T1} />);
    expect(screen.getByText(/5 replies/)).toBeInTheDocument();
  });

  it("renders the thread status via StatusChip", () => {
    render(<ThreadCard thread={T2} />);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("renders Pinned status", () => {
    render(<ThreadCard thread={T3} />);
    expect(screen.getByText("Pinned")).toBeInTheDocument();
  });
});

describe("ThreadCard — a11y", () => {
  it("has role='listitem' for semantic list membership", () => {
    render(<ThreadCard thread={T1} />);
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("is keyboard-interactive when onThreadClick is provided", () => {
    render(<ThreadCard thread={T1} onThreadClick={vi.fn()} />);
    const card = screen.getByTestId("thread-card");
    expect(card).toHaveAttribute("tabIndex", "0");
  });

  it("is not keyboard-interactive without onThreadClick", () => {
    render(<ThreadCard thread={T1} />);
    const card = screen.getByTestId("thread-card");
    expect(card).not.toHaveAttribute("tabIndex");
  });

  it("unread threads include sr-only 'Unread replies' text", () => {
    render(
      <ThreadCard thread={{ ...T1, hasUnread: true }} />,
    );
    expect(screen.getByText("Unread replies.")).toBeInTheDocument();
  });
});

describe("ThreadCard — interactions", () => {
  it("calls onThreadClick when card is clicked", async () => {
    const user = userEvent.setup();
    const onThreadClick = vi.fn();
    render(<ThreadCard thread={T1} onThreadClick={onThreadClick} />);
    await user.click(screen.getByTestId("thread-card"));
    expect(onThreadClick).toHaveBeenCalledWith(T1);
  });

  it("calls onThreadClick on Enter key", async () => {
    const user = userEvent.setup();
    const onThreadClick = vi.fn();
    render(<ThreadCard thread={T1} onThreadClick={onThreadClick} />);
    screen.getByTestId("thread-card").focus();
    await user.keyboard("{Enter}");
    expect(onThreadClick).toHaveBeenCalledWith(T1);
  });

  it("calls onThreadClick on Space key", async () => {
    const user = userEvent.setup();
    const onThreadClick = vi.fn();
    render(<ThreadCard thread={T1} onThreadClick={onThreadClick} />);
    screen.getByTestId("thread-card").focus();
    await user.keyboard(" ");
    expect(onThreadClick).toHaveBeenCalledWith(T1);
  });
});

// ---------------------------------------------------------------------------
// ThreadList
// ---------------------------------------------------------------------------

describe("ThreadList — rendering", () => {
  it("renders with default data-testid='thread-list'", () => {
    render(<ThreadList threads={THREADS} />);
    expect(screen.getByTestId("thread-list")).toBeInTheDocument();
  });

  it("renders all thread cards", () => {
    render(<ThreadList threads={THREADS} />);
    expect(screen.getAllByTestId("thread-card")).toHaveLength(3);
  });

  it("renders heading when provided", () => {
    render(<ThreadList threads={THREADS} heading="Course Discussions" />);
    expect(screen.getByRole("heading", { name: "Course Discussions" })).toBeInTheDocument();
  });

  it("renders empty state when no threads", () => {
    render(<ThreadList threads={[]} />);
    expect(screen.getByText("No threads yet")).toBeInTheDocument();
  });

  it("renders loading skeleton when loading=true", () => {
    const { container } = render(<ThreadList threads={[]} loading />);
    const loading = container.querySelector("[aria-busy='true']");
    expect(loading).toBeInTheDocument();
  });

  it("renders error message when error is provided", () => {
    render(<ThreadList threads={[]} error="Failed to load threads." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load threads.");
  });
});
