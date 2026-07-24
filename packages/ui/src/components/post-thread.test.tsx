import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PostThread, type PostItem } from "./post-thread";

const POSTS: PostItem[] = [
  {
    id: "p1",
    authorId: "u1",
    authorDisplayName: "Priya S.",
    body: "<p>How do I submit the final project?</p>",
    upvotes: 3,
    upvotedByCurrentUser: false,
    status: "visible",
    parentId: null,
    createdAt: new Date(),
  },
  {
    id: "p2",
    authorId: "u2",
    authorDisplayName: "Dr. Vikram",
    body: "<p>Go to the Projects section and upload your files.</p>",
    upvotes: 5,
    upvotedByCurrentUser: true,
    status: "visible",
    parentId: "p1",
    createdAt: new Date(),
    isResolution: true,
  },
  {
    id: "p3",
    authorId: "u3",
    authorDisplayName: "Rahul M.",
    body: "<p>Thanks, that worked!</p>",
    upvotes: 1,
    status: "visible",
    parentId: "p1",
    createdAt: new Date(),
  },
];

const HIDDEN_POST: PostItem = {
  id: "p4",
  authorId: "u99",
  authorDisplayName: "Spammer",
  body: "<p>Spam content</p>",
  upvotes: 0,
  status: "hidden",
  hiddenReason: "spam",
  parentId: null,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("PostThread — rendering", () => {
  it("renders with default data-testid='post-thread'", () => {
    render(<PostThread posts={POSTS} />);
    expect(screen.getByTestId("post-thread")).toBeInTheDocument();
  });

  it("renders top-level posts", () => {
    render(<PostThread posts={POSTS} />);
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
  });

  it("renders nested replies", () => {
    render(<PostThread posts={POSTS} />);
    expect(screen.getByText("Dr. Vikram")).toBeInTheDocument();
    expect(screen.getByText("Rahul M.")).toBeInTheDocument();
  });

  it("marks resolution post", () => {
    render(<PostThread posts={POSTS} />);
    expect(screen.getByText("Marked as solution")).toBeInTheDocument();
  });

  it("renders empty state when no posts", () => {
    render(<PostThread posts={[]} />);
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
  });

  it("renders loading skeleton when loading=true", () => {
    render(<PostThread posts={[]} loading />);
    const loading = screen.getByLabelText("Loading posts");
    expect(loading).toHaveAttribute("aria-busy", "true");
  });

  it("renders error message when error prop provided", () => {
    render(<PostThread posts={[]} error="Could not load posts." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load posts.");
  });
});

// ---------------------------------------------------------------------------
// Hidden posts
// ---------------------------------------------------------------------------

describe("PostThread — hidden posts", () => {
  it("shows 'hidden by a moderator' message for hidden posts", () => {
    render(<PostThread posts={[HIDDEN_POST]} />);
    expect(screen.getByText(/hidden by a moderator/i)).toBeInTheDocument();
  });

  it("does not render the body of hidden posts for non-moderators", () => {
    render(<PostThread posts={[HIDDEN_POST]} />);
    // The body is only shown in a <details> for moderators
    expect(screen.queryByText("Spam content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("PostThread — a11y", () => {
  it("has ordered list with aria-label for top-level posts", () => {
    render(<PostThread posts={POSTS} />);
    expect(screen.getByRole("list", { name: "Thread posts" })).toBeInTheDocument();
  });

  it("upvote button has aria-label with count and aria-pressed", () => {
    render(<PostThread posts={POSTS} onUpvote={vi.fn()} />);
    const upvoteBtn = screen.getByTestId("upvote-p1");
    expect(upvoteBtn).toHaveAttribute("aria-label", "Upvote this post — 3 upvotes");
    expect(upvoteBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("upvote aria-pressed=true when already voted", () => {
    render(<PostThread posts={POSTS} onUpvote={vi.fn()} />);
    const upvoteBtn = screen.getByTestId("upvote-p2");
    expect(upvoteBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("reply button has accessible aria-label", () => {
    render(<PostThread posts={POSTS} onReply={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /reply to priya s\.'s post/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("PostThread — interactions", () => {
  it("calls onUpvote with post id when upvote is clicked", async () => {
    const user = userEvent.setup();
    const onUpvote = vi.fn();
    render(<PostThread posts={POSTS} onUpvote={onUpvote} />);
    await user.click(screen.getByTestId("upvote-p1"));
    expect(onUpvote).toHaveBeenCalledWith("p1");
  });

  it("calls onReport when report menu item is clicked", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    render(<PostThread posts={POSTS} onReport={onReport} />);
    await user.click(screen.getByTestId("post-menu-p1"));
    await user.click(screen.getByTestId("report-p1"));
    expect(onReport).toHaveBeenCalledWith("p1");
  });

  it("calls onReply(null) when reply-to-thread button is clicked", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(<PostThread posts={POSTS} onReply={onReply} />);
    await user.click(screen.getByTestId("post-thread-reply-btn"));
    expect(onReply).toHaveBeenCalledWith(null);
  });

  it("calls onReply with parentId when reply-to-post button is clicked", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(<PostThread posts={POSTS} onReply={onReply} />);
    await user.click(screen.getByTestId("reply-p1"));
    expect(onReply).toHaveBeenCalledWith("p1");
  });
});
