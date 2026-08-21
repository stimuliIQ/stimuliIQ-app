import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CourseCard } from "./course-card";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("CourseCard, rendering", () => {
  it("renders the course title", () => {
    render(<CourseCard title="Python for Data Science" />);
    expect(screen.getByText("Python for Data Science")).toBeInTheDocument();
  });

  it("renders the program meta when provided", () => {
    render(<CourseCard title="Python" program="B.Tech 2024 Batch A" />);
    expect(screen.getByText("B.Tech 2024 Batch A")).toBeInTheDocument();
  });

  it("renders a ProgressBar when progress is provided", () => {
    render(<CourseCard title="Python" progress={65} />);
    const bar = screen.getByTestId("progress-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "65");
  });

  it("does not render a ProgressBar when progress is omitted", () => {
    render(<CourseCard title="Python" />);
    expect(screen.queryByTestId("progress-bar")).not.toBeInTheDocument();
  });

  it("renders the nextLesson text when provided alongside progress", () => {
    render(<CourseCard title="Python" progress={40} nextLesson="Module 2 · NumPy arrays" />);
    expect(screen.getByText(/NumPy arrays/)).toBeInTheDocument();
  });

  it("renders a StatusChip when statusLabel is provided", () => {
    render(<CourseCard title="Python" statusTone="success" statusLabel="Active" />);
    expect(screen.getByTestId("status-chip")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the CTA slot when cta is provided", () => {
    render(
      <CourseCard title="Python" cta={<button type="button">Continue</button>} />,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("uses default data-testid of 'course-card'", () => {
    render(<CourseCard title="Python" />);
    expect(screen.getByTestId("course-card")).toBeInTheDocument();
  });

  it("respects a custom data-testid", () => {
    render(<CourseCard title="Python" data-testid="my-card" />);
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interaction, onClick
// ---------------------------------------------------------------------------

describe("CourseCard, onClick interaction", () => {
  it("renders as role='button' when onClick is provided", () => {
    render(<CourseCard title="Python" onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("fires onClick when the card is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CourseCard title="Python" onClick={onClick} />);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick when Enter is pressed on the card", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CourseCard title="Python" onClick={onClick} />);

    const card = screen.getByRole("button");
    card.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick when Space is pressed on the card", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CourseCard title="Python" onClick={onClick} />);

    const card = screen.getByRole("button");
    card.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is keyboard-focusable when onClick is provided", () => {
    render(<CourseCard title="Python" onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "0");
  });

  it("is NOT a button and NOT focusable when no onClick provided", () => {
    render(<CourseCard title="Python" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// asChild, renders styling onto a child element
// ---------------------------------------------------------------------------

describe("CourseCard, asChild (link mode)", () => {
  it("renders the outer element as an <a> when asChild is true", () => {
    render(
      <CourseCard asChild title="Python" data-testid="link-card">
        <a href="/courses/enr-001" />
      </CourseCard>,
    );
    // The card container should be the <a> element
    const card = screen.getByTestId("link-card");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/courses/enr-001");
  });

  it("renders the card's visual content inside the child element", () => {
    render(
      <CourseCard asChild title="Python" data-testid="link-card">
        <a href="/courses/enr-001" />
      </CourseCard>,
    );
    // The title should be inside the card
    expect(screen.getByText("Python")).toBeInTheDocument();
  });
});
