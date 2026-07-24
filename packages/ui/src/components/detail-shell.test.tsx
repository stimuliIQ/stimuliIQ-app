import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DetailShell, type DetailShellTab } from "./detail-shell";

const TABS: DetailShellTab[] = [
  { value: "enrollments", label: "Enrollments", content: <p>Enrollments content</p> },
  { value: "payments", label: "Payments", content: <p>Payments content</p> },
  { value: "tickets", label: "Tickets", badge: <span>2 open</span>, content: <p>Tickets content</p> },
];

describe("DetailShell", () => {
  it("renders the title as a heading", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} />);
    expect(screen.getByRole("heading", { level: 1, name: /Priya Sharma/ })).toBeInTheDocument();
  });

  it("renders subtitle and meta", () => {
    render(
      <DetailShell
        title="Priya Sharma"
        subtitle="priya@example.com"
        meta={<span>Active</span>}
        tabs={TABS}
      />,
    );
    expect(screen.getByText("priya@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders all tabs as an accessible tablist", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} tabsAriaLabel="Student sections" />);
    expect(screen.getByRole("tablist", { name: "Student sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Enrollments/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Payments/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Tickets/ })).toBeInTheDocument();
  });

  it("shows the first tab's content by default", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} />);
    expect(screen.getByText("Enrollments content")).toBeVisible();
  });

  it("switches tab content on click", async () => {
    const user = userEvent.setup();
    render(<DetailShell title="Priya Sharma" tabs={TABS} />);
    await user.click(screen.getByRole("tab", { name: /Payments/ }));
    expect(screen.getByText("Payments content")).toBeVisible();
  });

  it("supports roving-focus keyboard navigation across tabs (ArrowRight)", async () => {
    const user = userEvent.setup();
    render(<DetailShell title="Priya Sharma" tabs={TABS} />);
    const enrollmentsTab = screen.getByRole("tab", { name: /Enrollments/ });
    enrollmentsTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Payments/ })).toHaveFocus();
  });

  it("calls onValueChange when the active tab changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<DetailShell title="Priya Sharma" tabs={TABS} onValueChange={onValueChange} />);
    await user.click(screen.getByRole("tab", { name: /Tickets/ }));
    expect(onValueChange).toHaveBeenCalledWith("tickets");
  });

  it("renders tab badges as visible text (never color-only)", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} />);
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("shows a loading skeleton", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} loading />);
    expect(screen.getByLabelText("Loading record")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} error="Failed to load student" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load student");
  });

  it("respects an explicit defaultValue", () => {
    render(<DetailShell title="Priya Sharma" tabs={TABS} defaultValue="payments" />);
    expect(screen.getByText("Payments content")).toBeVisible();
  });
});
