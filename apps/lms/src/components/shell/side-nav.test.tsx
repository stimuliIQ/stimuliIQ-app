// Component + a11y tests for the LMS desktop side nav.
//
// The nav is FLAT: every destination is a top-level row and nothing opens a submenu. The
// two things that restructure could plausibly get wrong, and so the two things pinned
// hardest here:
//
//   1. NOTHING IS HIDDEN. Every destination must be in the DOM and reachable without a
//      hover, a click or a guess about which caption owns it. Captions are captions, not
//      controls — if a section button ever reappears, these tests fail.
//
//   2. THE OUTSTANDING-PROJECT BADGE. It is the one nav badge that maps to something
//      blocking: a required final project gates the certificate. It now sits on the
//      Projects row itself, which is only correct while that row is always visible.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

const ALL_DESTINATIONS: [testId: string, href: string][] = [
  ["nav-home", "/"],
  ["nav-courses", "/courses"],
  ["nav-assignments", "/assignments"],
  ["nav-projects", "/projects"],
  ["nav-assessments", "/assessments"],
  ["nav-progress", "/progress"],
  ["nav-certificates", "/certificates"],
  ["nav-calendar", "/calendar"],
  ["nav-downloads", "/downloads"],
  ["nav-forum", "/forum"],
  ["nav-support", "/support"],
];

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
  it("puts every destination on the surface as a top-level link", () => {
    renderNav();
    for (const [testId, href] of ALL_DESTINATIONS) {
      expect(screen.getByTestId(testId)).toHaveAttribute("href", href);
    }
  });

  it("has no expandable section anywhere — a caption is a caption, not a control", () => {
    renderNav();
    // Nothing in the nav may claim to own a popup.
    const nav = screen.getByTestId("lms-sidenav");
    expect(nav.querySelectorAll("[aria-haspopup]")).toHaveLength(0);
    expect(nav.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(nav.querySelectorAll("button")).toHaveLength(0);
  });

  it("captions the three grouped areas", () => {
    renderNav();
    const nav = screen.getByTestId("lms-sidenav");
    for (const caption of ["Coursework", "Achievements", "Resources"]) {
      expect(nav.textContent).toContain(caption);
    }
  });

  it("drops Projects entirely for a program that does not require one", () => {
    // An always-empty Projects entry would imply an outstanding requirement that does not
    // exist for this student.
    renderNav({ hasProjects: false, pendingCount: 0 });
    expect(screen.queryByTestId("nav-projects")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-assignments")).toBeInTheDocument();
  });
});

describe("LMS side nav, the outstanding-project badge", () => {
  it("carries the count on the Projects row, visible without any interaction", () => {
    renderNav({ pendingCount: 2 });
    expect(screen.getByTestId("nav-projects")).toHaveAccessibleName("Projects, 2 pending");
  });

  it("shows no badge when nothing is outstanding", () => {
    renderNav({ pendingCount: 0 });
    const row = screen.getByTestId("nav-projects");
    expect(row.textContent).not.toContain("pending");
    expect(row).not.toHaveAccessibleName(/pending/);
  });
});

describe("LMS side nav, active route", () => {
  it("marks exactly the active row", () => {
    renderNav({ pathname: "/certificates" });
    expect(screen.getByTestId("nav-certificates")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-certificates").className).toContain("bg-brand-50");
    expect(screen.getByTestId("nav-progress")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("nav-progress").className).not.toContain("bg-brand-50");
  });

  it("treats Home as an exact match, so it is not active on every route", () => {
    renderNav({ pathname: "/courses" });
    expect(screen.getByTestId("nav-courses")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-home")).not.toHaveAttribute("aria-current");
  });
});

describe("LMS side nav, accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderNav({ pendingCount: 1 });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
