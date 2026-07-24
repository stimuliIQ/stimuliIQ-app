import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeaderboardTable, type LeaderboardEntry } from "./leaderboard-table";

const ENTRIES: LeaderboardEntry[] = [
  { userId: "u1", displayName: "Priya S.", points: 4500, rank: 1 },
  { userId: "u2", displayName: "Rahul M.", points: 4200, rank: 2 },
  { userId: "u3", displayName: "Aarav K.", points: 3900, rank: 3 },
  { userId: "u4", displayName: "Vikram D.", points: 3500, rank: 4 },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("LeaderboardTable — rendering", () => {
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

  it("highlights the current user's row", () => {
    render(<LeaderboardTable entries={ENTRIES} currentUserId="u2" />);
    // "(you)" should appear next to the current user
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PII-minimal — structural alias-safety
// ---------------------------------------------------------------------------

describe("LeaderboardTable — PII-minimal (alias-safe)", () => {
  it("renders only display names — no email rendered in rows", () => {
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
// a11y — rank medals not color-only
// ---------------------------------------------------------------------------

describe("LeaderboardTable — a11y", () => {
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
