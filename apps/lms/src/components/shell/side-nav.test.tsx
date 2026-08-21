// Component + a11y tests for the LMS desktop side nav after it moved to the rail + flyout
// pattern the CRM sidebar uses.
//
// The two things this restructure could plausibly get WRONG, and so the two things pinned
// hardest here:
//
//   1. THE OUTSTANDING-PROJECT BADGE. It is the one nav badge that maps to something
//      blocking, a required final project gates the certificate. Projects moved from a
//      top-level row into a flyout, which would have hidden that count behind a hover, so
//      the Coursework row now carries it too. If that bubbling is ever dropped, a student
//      stops seeing the one thing standing between them and their certificate.
//
//   2. HOME AND MY COURSES STAY ONE CLICK AWAY. They are deliberately NOT behind a flyout.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const useMyProjectsMock = vi.fn();
vi.mock("../../hooks/use-my-projects", () => ({
  useMyProjects: () => useMyProjectsMock(),
}));

import { SideNav } from "./lms-shell";

function renderNav(
  overrides: { pathname?: string; hasProjects?: boolean; pendingCount?: number } = {},
) {
  const { pathname = "/", hasProjects = true, pendingCount = 0 } = overrides;
  useMyProjectsMock.mockReturnValue({ hasProjects, pendingCount });
  return render(<SideNav pathname={pathname} preference={false} effectiveCollapsed={false} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LMS side nav, shape", () => {
  it("keeps Home and My Courses as direct rows, not behind a flyout", () => {
    renderNav();
    expect(screen.getByTestId("nav-home")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("nav-courses")).toHaveAttribute("href", "/courses");
    // No section button wraps them.
    expect(screen.queryByTestId("lms-nav-section-home")).not.toBeInTheDocument();
  });

  it("renders the three grouped areas as flyout sections", () => {
    renderNav();
    for (const key of ["coursework", "achievements", "resources"]) {
      const button = screen.getByTestId(`lms-nav-section-${key}`);
      expect(button).toHaveAttribute("aria-haspopup", "true");
      expect(button).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("keeps every destination out of the DOM until its section is opened", () => {
    renderNav();
    expect(screen.queryByTestId("nav-assignments")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-certificates")).not.toBeInTheDocument();
  });
});

describe("LMS side nav, opening", () => {
  it("opens a section on click, which is the only opener a touch device has", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("lms-nav-section-coursework"));

    const panel = screen.getByTestId("lms-nav-panel-coursework");
    expect(within(panel).getByTestId("nav-assignments")).toHaveAttribute("href", "/assignments");
    expect(within(panel).getByTestId("nav-assessments")).toBeInTheDocument();
  });

  it("only one section is open at a time", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("lms-nav-section-coursework"));
    fireEvent.click(screen.getByTestId("lms-nav-section-resources"));

    expect(screen.queryByTestId("lms-nav-panel-coursework")).not.toBeInTheDocument();
    expect(screen.getByTestId("lms-nav-panel-resources")).toBeInTheDocument();
  });

  it("Escape closes the panel", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("lms-nav-section-achievements"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("lms-nav-panel-achievements")).not.toBeInTheDocument();
  });

  it("points the section button at the panel it controls, only while open", () => {
    renderNav();
    const button = screen.getByTestId("lms-nav-section-resources");
    expect(button).not.toHaveAttribute("aria-controls");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-controls", "lms-nav-panel-resources");
    expect(screen.getByTestId("lms-nav-panel-resources")).toHaveAttribute(
      "id",
      "lms-nav-panel-resources",
    );
  });
});

describe("LMS side nav, the outstanding-project badge", () => {
  it("bubbles the count onto the Coursework row, so it is visible without hovering", () => {
    renderNav({ pendingCount: 2 });
    // The count is the whole reason the badge exists; a student must see it at a glance.
    expect(screen.getByTestId("lms-nav-section-coursework")).toHaveAccessibleName(
      "Coursework, 2 pending",
    );
  });

  it("keeps the count on the Projects item itself once the section is open", () => {
    renderNav({ pendingCount: 2 });
    fireEvent.click(screen.getByTestId("lms-nav-section-coursework"));
    expect(screen.getByTestId("nav-projects")).toHaveAccessibleName("Projects, 2 pending");
  });

  it("shows no badge when nothing is outstanding", () => {
    renderNav({ pendingCount: 0 });
    const button = screen.getByTestId("lms-nav-section-coursework");
    expect(button.textContent).not.toContain("pending");
    expect(button).not.toHaveAccessibleName(/pending/);
  });

  it("drops Projects entirely for a program that does not require one", () => {
    // An always-empty Projects entry would imply an outstanding requirement that does not
    // exist for this student.
    renderNav({ hasProjects: false, pendingCount: 0 });
    fireEvent.click(screen.getByTestId("lms-nav-section-coursework"));
    expect(screen.queryByTestId("nav-projects")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-assignments")).toBeInTheDocument();
  });
});

describe("LMS side nav, active route", () => {
  it("marks the active child and highlights its parent section", () => {
    renderNav({ pathname: "/certificates" });

    const button = screen.getByTestId("lms-nav-section-achievements");
    expect(button.className).toContain("bg-brand-50");

    fireEvent.click(button);
    expect(screen.getByTestId("nav-certificates")).toHaveAttribute("aria-current", "page");
  });

  it("marks a direct row active without touching any section", () => {
    renderNav({ pathname: "/courses" });
    expect(screen.getByTestId("nav-courses")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("lms-nav-section-coursework").className).not.toContain("bg-brand-50");
  });
});

describe("LMS side nav, accessibility", () => {
  it("has no axe violations with a flyout open", async () => {
    const { container } = renderNav({ pendingCount: 1 });
    fireEvent.click(screen.getByTestId("lms-nav-section-coursework"));

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
