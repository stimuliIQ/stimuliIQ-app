// Component tests for the icon-rail + flyout nav.
//
// The behaviour worth pinning is the one that broke the old design on real
// hardware: a submenu that only opens on hover is unreachable on a phone or an
// iPad, so the section's click handler must open it on EVERY device, and the
// hover handler must exist only where `(hover: hover) and (pointer: fine)`
// matches. jsdom's `matchMedia` stub answers `false` to everything (see
// src/test/setup.ts), which makes the default render here a touch device, so
// "click opens it" is tested against the harder case, and the hover case opts
// in by overriding the stub.
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MeResponse } from "@repo/types";

// `Link` needs a `<RouterProvider>` ancestor at runtime; render it as a plain
// anchor here, and pin the location so "active route" assertions are stable.
// Same pattern as content-pages-manager.test.tsx.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/courses" }),
}));

import { Sidebar } from "./sidebar";

const ADMIN_ME: MeResponse = {
  user: {
    id: "u-1",
    email: "admin@stimuliiq.test",
    name: "Admin",
    phone: null,
    avatar: null,
    status: "active",
    mustChangePassword: false,
  },
  tenantId: "t-1",
  roles: ["super_admin"],
  // There is no wildcard grant in `hasPermission`, it compares keys literally
  // (see lib/permissions.ts), so a super_admin fixture has to name the keys the
  // assertions below reach for.
  permissions: [
    { key: "students.view", scope: "all" },
    { key: "courses.view", scope: "all" },
    { key: "faculty.view", scope: "all" },
    { key: "mentors.view", scope: "all" },
    { key: "batches.view", scope: "all" },
    { key: "assignments.view", scope: "all" },
    { key: "assessments.view", scope: "all" },
    { key: "forum.moderate", scope: "all" },
    { key: "leads.view", scope: "all" },
    { key: "leads.create", scope: "all" },
    { key: "payments.view", scope: "all" },
    { key: "orders.view", scope: "all" },
    { key: "twofa.manage", scope: "own" },
  ],
};

/** A counsellor: leads, yes; the Academics section's children, no. */
const LEADS_ONLY_ME: MeResponse = {
  ...ADMIN_ME,
  roles: ["counsellor"],
  permissions: [{ key: "leads.view", scope: "all" }],
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  // The spies are returned separately from `overrides` so their Mock type survives
  // the spread (merging them into one object widens them to `() => void`).
  const onCloseMobile = vi.fn();
  const onToggleCollapsed = vi.fn();
  const view = render(
    <Sidebar
      me={ADMIN_ME}
      collapsed={false}
      mobileOpen={false}
      onCloseMobile={onCloseMobile}
      onToggleCollapsed={onToggleCollapsed}
      {...overrides}
    />,
  );
  return { ...view, onCloseMobile, onToggleCollapsed };
}

/** Makes `(hover: hover) and (pointer: fine)` match, i.e. pretend to be a mouse. */
function pretendMousePointer(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("hover: hover"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Sidebar, opening a section", () => {
  it("keeps every submenu closed until something opens it", () => {
    renderSidebar();
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-section-academics")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the flyout on CLICK on a touch device, where there is no hover to rely on", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    const panel = screen.getByTestId("nav-panel-academics");
    expect(within(panel).getByTestId("nav-leaf-batches")).toBeInTheDocument();
    expect(within(panel).getByTestId("nav-leaf-assessments")).toBeInTheDocument();
  });

  it("does NOT open on hover on a touch device, a coarse pointer fires spurious mouseenter", () => {
    renderSidebar();
    fireEvent.mouseEnter(screen.getByTestId("nav-section-academics").parentElement!);
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("opens on hover once the device reports a real hover state", () => {
    pretendMousePointer();
    renderSidebar();

    fireEvent.mouseEnter(screen.getByTestId("nav-section-academics").parentElement!);
    // Hover intent: the first open waits, so sweeping the pointer down the column
    // does not throw a panel at every section on the way past.
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("nav-panel-academics")).toBeInTheDocument();
  });

  it("a hover that leaves before the intent delay elapses opens nothing", () => {
    pretendMousePointer();
    renderSidebar();
    const item = screen.getByTestId("nav-section-academics").parentElement!;

    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("switching to a neighbouring section while one is open is immediate", () => {
    pretendMousePointer();
    renderSidebar();

    fireEvent.mouseEnter(screen.getByTestId("nav-section-academics").parentElement!);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.mouseEnter(screen.getByTestId("nav-section-commerce").parentElement!);
    expect(screen.getByTestId("nav-panel-commerce")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("a click never waits for the hover-intent delay", () => {
    pretendMousePointer();
    renderSidebar();

    fireEvent.click(screen.getByTestId("nav-section-academics"));
    expect(screen.getByTestId("nav-panel-academics")).toBeInTheDocument();
  });

  it("closes shortly after the pointer leaves, not instantly", () => {
    pretendMousePointer();
    renderSidebar();
    const item = screen.getByTestId("nav-section-academics").parentElement!;

    fireEvent.mouseEnter(item);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.mouseLeave(item);
    // Still open inside the grace window, this is what stops the panel
    // vanishing when the pointer clips a neighbouring row on the way in.
    expect(screen.getByTestId("nav-panel-academics")).toBeInTheDocument();

    // `act` because the close is a `setTimeout` callback, React does not flush a
    // state update fired from a raw timer without it.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("a second click on the same section closes it again", () => {
    renderSidebar();
    const button = screen.getByTestId("nav-section-academics");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("only one section is open at a time", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));
    fireEvent.click(screen.getByTestId("nav-section-commerce"));

    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-panel-commerce")).toBeInTheDocument();
  });
});

describe("Sidebar, dismissing", () => {
  it("Escape closes the flyout", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("Escape closes the flyout BEFORE the drawer, so one keypress drops one layer", () => {
    const { onCloseMobile } = renderSidebar({ mobileOpen: true });
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
    // The drawer survives the first press…
    onCloseMobile.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });
    // …and closes on the second.
    expect(onCloseMobile).toHaveBeenCalled();
  });

  it("a pointer press outside the nav closes the flyout", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
  });

  it("a pointer press INSIDE the flyout leaves it alone", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    fireEvent.pointerDown(screen.getByTestId("nav-leaf-batches"));
    expect(screen.getByTestId("nav-panel-academics")).toBeInTheDocument();
  });
});

describe("Sidebar, RBAC gating", () => {
  it("hides sections the viewer holds no permission for", () => {
    renderSidebar({ me: LEADS_ONLY_ME });

    expect(screen.getByTestId("nav-section-leads")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-item-two-factor auth")).not.toBeInTheDocument();
  });

  it("hides individual leaves inside an open section", () => {
    renderSidebar({ me: LEADS_ONLY_ME });
    fireEvent.click(screen.getByTestId("nav-section-leads"));

    expect(screen.getByTestId("nav-leaf-pipeline")).toBeInTheDocument();
    // `leads.create` is not held, so Import must not be offered at all.
    expect(screen.queryByTestId("nav-leaf-import")).not.toBeInTheDocument();
  });

  it("hides a section whose every child is hidden, rather than offering a dead end", () => {
    // Almost no section declares a permission of its own — the gate is on each leaf — so a
    // section only disappears if this rule holds. Without it a viewer missing a whole module
    // still gets its heading, clicks it, and lands on "Nothing here for your role": the nav
    // promising a screen the account cannot open. A super admin hit exactly that on
    // Organisation, on a database where `org.teams.view` had never been seeded.
    renderSidebar({ me: LEADS_ONLY_ME });

    expect(screen.queryByTestId("nav-section-academics")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-section-organisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing here for your role.")).not.toBeInTheDocument();
  });

  it("shows a section as soon as ONE of its children is permitted", () => {
    const me: MeResponse = {
      ...LEADS_ONLY_ME,
      permissions: [{ key: "org.teams.view", scope: "all" }],
    };
    renderSidebar({ me });

    expect(screen.getByTestId("nav-section-organisation")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("nav-section-organisation"));
    expect(screen.getByTestId("nav-leaf-teams")).toBeInTheDocument();
  });
});

describe("Sidebar, active route", () => {
  it("marks the active leaf and its parent section", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    // /courses is the mocked location, and Courses lives under Academics.
    expect(screen.getByTestId("nav-leaf-courses")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-section-academics").className).toContain("bg-brand-50");
  });
});

describe("Sidebar, accessibility", () => {
  it("has no axe violations with a flyout open", async () => {
    const { container } = renderSidebar();
    fireEvent.click(screen.getByTestId("nav-section-academics"));

    // jest-axe's matcher is incompatible with Vitest's expect (see test/setup.ts);
    // asserting on `violations` is the repo convention and is equivalent.
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("ArrowRight opens the section from the keyboard", () => {
    renderSidebar();
    fireEvent.keyDown(screen.getByTestId("nav-section-academics"), { key: "ArrowRight" });

    expect(screen.getByTestId("nav-panel-academics")).toBeInTheDocument();
  });

  it("ArrowLeft inside the panel closes it and returns focus to the section", () => {
    renderSidebar();
    const button = screen.getByTestId("nav-section-academics");
    fireEvent.click(button);

    fireEvent.keyDown(screen.getByTestId("nav-panel-academics"), { key: "ArrowLeft" });
    expect(screen.queryByTestId("nav-panel-academics")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("points the section button at the panel it controls, only while open", () => {
    renderSidebar();
    const button = screen.getByTestId("nav-section-academics");
    expect(button).not.toHaveAttribute("aria-controls");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-controls", "nav-panel-academics");
    expect(screen.getByTestId("nav-panel-academics")).toHaveAttribute("id", "nav-panel-academics");
  });
});

describe("Sidebar, the collapse control", () => {
  it("sits at the top: expanded shows the collapse chevron beside the wordmark", () => {
    const { onToggleCollapsed } = renderSidebar({ collapsed: false });

    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle).toHaveAccessibleName("Collapse sidebar");
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("collapsed, the brand mark IS the expand button", () => {
    const { onToggleCollapsed } = renderSidebar({ collapsed: true });

    const railToggle = screen.getByTestId("sidebar-toggle-rail");
    expect(railToggle).toHaveAccessibleName("Expand sidebar");
    // The mark lives inside the button, so clicking the logo expands the nav.
    expect(railToggle.querySelector("img")).toHaveAttribute("src", "/icon-192.png");

    fireEvent.click(railToggle);
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("keeps the collapse control out of the nav list, no footer row", () => {
    const { container } = renderSidebar({ collapsed: false });
    const nav = container.querySelector("nav")!;

    expect(within(nav).queryByTestId("sidebar-toggle")).not.toBeInTheDocument();
    expect(screen.queryByText("Collapse")).not.toBeInTheDocument();
  });
});

describe("Sidebar, the rail tooltip", () => {
  it("labels a rail icon on hover, anchored to the row rather than floating free", () => {
    pretendMousePointer();
    renderSidebar({ collapsed: true });

    fireEvent.mouseEnter(screen.getByTestId("nav-item-search engine").parentElement!);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tip = screen.getByTestId("nav-tooltip-search-engine");
    expect(tip).toHaveTextContent("Search Engine");
    expect(tip).toHaveAttribute("role", "tooltip");
    // A measured `top` is the whole fix, without it `position: fixed` falls back
    // to the static position, which is the bottom of the row, not its middle.
    expect(tip.style.top).not.toBe("");
  });

  it("labels a rail icon on keyboard focus too", () => {
    renderSidebar({ collapsed: true });

    fireEvent.focus(screen.getByTestId("nav-item-search engine").parentElement!);
    expect(screen.getByTestId("nav-tooltip-search-engine")).toBeInTheDocument();
  });

  it("shows no tooltip when the column is expanded, the label is already there", () => {
    pretendMousePointer();
    renderSidebar({ collapsed: false });

    fireEvent.mouseEnter(screen.getByTestId("nav-item-search engine").parentElement!);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("nav-tooltip-search-engine")).not.toBeInTheDocument();
  });
});

describe("Sidebar, the mobile drawer", () => {
  it("stays off-canvas until it is opened", () => {
    renderSidebar({ mobileOpen: false });
    expect(screen.getByTestId("crm-sidebar").className).toContain("-left-64");
  });

  it("slides in when opened", () => {
    renderSidebar({ mobileOpen: true });
    expect(screen.getByTestId("crm-sidebar").className).toContain("left-0");
  });

  it("closes from the scrim and from its own close button", () => {
    const { onCloseMobile } = renderSidebar({ mobileOpen: true });

    fireEvent.click(screen.getByTestId("crm-sidebar-scrim"));
    expect(onCloseMobile).toHaveBeenCalled();

    onCloseMobile.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-close-mobile"));
    expect(onCloseMobile).toHaveBeenCalled();
  });

  it("never animates with a transform, that would trap the fixed flyout inside the drawer", () => {
    renderSidebar({ mobileOpen: true });
    expect(screen.getByTestId("crm-sidebar").className).not.toMatch(/\btranslate-x-/);
  });
});
