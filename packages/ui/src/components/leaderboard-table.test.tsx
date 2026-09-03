import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeaderboardTable, type LeaderboardEntry } from "./leaderboard-table";

const ENTRIES: LeaderboardEntry[] = [
  { isMe: false, displayName: "Priya S.", points: 4500, rank: 1 },
  { isMe: true, displayName: "Rahul M.", points: 4200, rank: 2 },
  { isMe: false, displayName: "Aarav K.", points: 3900, rank: 3 },
  { isMe: false, displayName: "Vikram D.", points: 3500, rank: 4 },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("LeaderboardTable, rendering", () => {
  it("renders with default data-testid='leaderboard-table'", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByTestId("leaderboard-table")).toBeInTheDocument();
  });

  it("renders as a table element", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders all entries", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
    expect(screen.getByText("Rahul M.")).toBeInTheDocument();
    expect(screen.getByText("Aarav K.")).toBeInTheDocument();
    expect(screen.getByText("Vikram D.")).toBeInTheDocument();
  });

  it("renders heading when provided", () => {
    render(<LeaderboardTable entries={ENTRIES} heading="Class Leaderboard" />);
    expect(screen.getByRole("heading", { name: "Class Leaderboard" })).toBeInTheDocument();
  });

  it("highlights the viewer's own row, and only that one", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    // Exactly one "(you)" — this used to be every row, because the LMS had no user id to
    // compare against and stamped the current user's onto all of them.
    expect(screen.getAllByText("(you)")).toHaveLength(1);
    const marked = screen
      .getAllByTestId("leaderboard-row")
      .filter((row) => row.getAttribute("data-current-user") === "true");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("Rahul M.");
  });

  it("marks no row when the viewer is not on the board", () => {
    render(<LeaderboardTable entries={ENTRIES.map((e) => ({ ...e, isMe: false }))} />);
    expect(screen.queryByText("(you)")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PII-minimal, structural alias-safety
// ---------------------------------------------------------------------------

describe("LeaderboardTable, PII-minimal (alias-safe)", () => {
  it("renders only display names, no email rendered in rows", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    const rows = screen.getAllByTestId("leaderboard-row");
    rows.forEach((row) => {
      // Cell text should not contain an @ sign (email-like)
      expect(row.textContent).not.toMatch(/@/);
    });
  });

  it("table caption announces that only display names are shown", () => {
    const { container } = render(<LeaderboardTable entries={ENTRIES} />);
    const caption = container.querySelector("caption");
    expect(caption?.textContent).toContain("display names only");
  });

  it("renders the opt-in notice by default", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByText(/opted in/i)).toBeInTheDocument();
  });

  it("renders a custom opt-in notice when provided", () => {
    render(
      <LeaderboardTable entries={ENTRIES} optInNotice="Only consenting students are listed." />,
    );
    expect(screen.getByText("Only consenting students are listed.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y, rank medals not color-only
// ---------------------------------------------------------------------------

describe("LeaderboardTable, a11y", () => {
  it("top-3 ranks show text labels (1st/2nd/3rd), not just color", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByText("1st")).toBeInTheDocument();
    expect(screen.getByText("2nd")).toBeInTheDocument();
    expect(screen.getByText("3rd")).toBeInTheDocument();
  });

  it("rank 4+ shows a numeric rank", () => {
    render(<LeaderboardTable entries={ENTRIES} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("empty state renders when no entries", () => {
    render(<LeaderboardTable entries={[]} />);
    expect(screen.getByText("No entries yet")).toBeInTheDocument();
  });

  it("loading state renders skeleton with aria-busy", () => {
    render(<LeaderboardTable entries={[]} loading />);
    const loader = screen.getByLabelText("Loading leaderboard");
    expect(loader).toHaveAttribute("aria-busy", "true");
  });
});
