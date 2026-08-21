import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BadgeChip, BadgeGrid, type BadgeGridItem } from "./badge-chip";

// ---------------------------------------------------------------------------
// BadgeChip
// ---------------------------------------------------------------------------

describe("BadgeChip, rendering", () => {
  it("renders with default data-testid='badge-chip'", () => {
    render(<BadgeChip name="First Project" earned />);
    expect(screen.getByTestId("badge-chip")).toBeInTheDocument();
  });

  it("renders the badge name", () => {
    render(<BadgeChip name="Streak Master" earned />);
    expect(screen.getByText("Streak Master")).toBeInTheDocument();
  });

  it("sets aria-label to badge name", () => {
    render(<BadgeChip name="First Project" earned />);
    expect(screen.getByLabelText("First Project")).toBeInTheDocument();
  });
});

describe("BadgeChip, no color-only status", () => {
  it("locked badge includes 'Locked' in the aria-label", () => {
    render(<BadgeChip name="Streak Master" locked />);
    expect(screen.getByLabelText("Streak Master, Locked")).toBeInTheDocument();
  });

  it("locked badge renders a Lock icon", () => {
    const { container } = render(<BadgeChip name="Streak Master" locked />);
    // The lock icon is an SVG inside the chip
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("earned badge does not include 'Locked' in aria-label", () => {
    render(<BadgeChip name="First Project" earned />);
    expect(screen.getByLabelText("First Project")).toBeInTheDocument();
    expect(screen.queryByLabelText(/locked/i)).not.toBeInTheDocument();
  });

  it("data-earned attribute reflects earned state", () => {
    render(<BadgeChip name="Badge" earned data-testid="bc" />);
    expect(screen.getByTestId("bc")).toHaveAttribute("data-earned", "true");
  });

  it("data-locked attribute reflects locked state", () => {
    render(<BadgeChip name="Badge" locked data-testid="bc" />);
    expect(screen.getByTestId("bc")).toHaveAttribute("data-locked", "true");
  });
});

// ---------------------------------------------------------------------------
// BadgeGrid
// ---------------------------------------------------------------------------

const BADGES: BadgeGridItem[] = [
  { id: "b1", name: "First Project", earned: true },
  { id: "b2", name: "Streak Master", earned: false },
  { id: "b3", name: "Perfect Attendance", earned: true },
];

describe("BadgeGrid, rendering", () => {
  it("renders with default data-testid='badge-grid'", () => {
    render(<BadgeGrid badges={BADGES} />);
    expect(screen.getByTestId("badge-grid")).toBeInTheDocument();
  });

  it("renders all badges", () => {
    render(<BadgeGrid badges={BADGES} />);
    expect(screen.getByText("First Project")).toBeInTheDocument();
    expect(screen.getByText("Streak Master")).toBeInTheDocument();
    expect(screen.getByText("Perfect Attendance")).toBeInTheDocument();
  });

  it("renders heading when provided", () => {
    render(<BadgeGrid badges={BADGES} heading="My badges" />);
    expect(screen.getByRole("heading", { name: "My badges" })).toBeInTheDocument();
  });

  it("renders empty message when no badges", () => {
    render(<BadgeGrid badges={[]} />);
    expect(screen.getByText(/no badges yet/i)).toBeInTheDocument();
  });

  it("renders loading skeleton when loading=true", () => {
    const { container } = render(<BadgeGrid badges={[]} loading />);
    const loadingDiv = container.querySelector("[aria-busy='true']");
    expect(loadingDiv).toBeInTheDocument();
  });
});
