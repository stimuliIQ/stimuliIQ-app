// Component tests for the Colleges CRM screen (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4). Mirrors content/content-pages-manager.test.tsx's
// pattern: mock the data hooks directly (CLAUDE.md §3: no business logic in components,
// so these are pure rendering/gating tests) rather than hit a real API.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { College, MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { CollegesManager } from "./colleges-manager";

const useCollegesListMock = vi.fn();
const useDeleteCollegeMock = vi.fn();
const useCreateCollegeMock = vi.fn();
const useUpdateCollegeMock = vi.fn();

vi.mock("../../hooks/use-colleges", () => ({
  useCollegesList: (...args: unknown[]) => useCollegesListMock(...args),
  useDeleteCollege: (...args: unknown[]) => useDeleteCollegeMock(...args),
  // CollegeFormDrawer (always mounted by CollegesManager, gated by its own `open` prop,
  // not conditionally rendered on row click) calls both of these unconditionally.
  useCreateCollege: (...args: unknown[]) => useCreateCollegeMock(...args),
  useUpdateCollege: (...args: unknown[]) => useUpdateCollegeMock(...args),
}));

const FULL_ACCESS_ME: MeResponse = {
  user: { id: "u-1", email: "admin@stimuliiq.test", name: "Admin", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [
    { key: "content.view", scope: "all" },
    { key: "content.create", scope: "all" },
    { key: "content.edit", scope: "all" },
    { key: "content.delete", scope: "all" },
  ],
};

// A role that can only VIEW (mirrors a `content.view`-only grant, e.g. a role with
// read access to the CMS but no mutation rights), proves the create button and
// per-row delete button are gated on content.create/content.delete, not merely on
// being logged in.
const VIEW_ONLY_ME: MeResponse = {
  ...FULL_ACCESS_ME,
  user: { ...FULL_ACCESS_ME.user, id: "u-2" },
  permissions: [{ key: "content.view", scope: "all" }],
};

const COLLEGE_A: College = {
  id: "college-a",
  name: "ABC Institute of Technology",
  logoUrl: null,
  url: null,
  category: "college_partner",
  focus: "Engineering & Computer Science",
  established: 1998,
  city: "Hyderabad",
  status: "published",
  order: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderManager(me: MeResponse | undefined = FULL_ACCESS_ME) {
  return render(
    <ToastProvider>
      <CollegesManager me={me} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useCollegesListMock.mockReset();
  useDeleteCollegeMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCreateCollegeMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateCollegeMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useCollegesListMock.mockReturnValue({ data: { items: [COLLEGE_A] }, isLoading: false, isError: false, refetch: vi.fn() });
});

describe("CollegesManager, list rendering", () => {
  it("renders a college row with its focus/established/city columns", () => {
    renderManager();
    expect(screen.getByTestId("colleges-table")).toBeInTheDocument();
    expect(screen.getByText("ABC Institute of Technology")).toBeInTheDocument();
    expect(screen.getByText("Hyderabad")).toBeInTheDocument();
    expect(screen.getByText("Engineering & Computer Science")).toBeInTheDocument();
    expect(screen.getByText("1998")).toBeInTheDocument();
  });

  it("shows an error state with a retry action when the list fails to load", () => {
    useCollegesListMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderManager();
    expect(screen.getByTestId("colleges-manager-error")).toBeInTheDocument();
  });
});

describe("CollegesManager, RBAC gating (content.create / content.delete)", () => {
  it("shows the 'New college' button and a per-row delete button for a full-access user", () => {
    renderManager(FULL_ACCESS_ME);
    expect(screen.getByTestId("college-create-button")).toBeInTheDocument();
    expect(screen.getByTestId(`delete-college-${COLLEGE_A.id}`)).toBeInTheDocument();
  });

  it("hides the 'New college' button and per-row delete button for a view-only user", () => {
    renderManager(VIEW_ONLY_ME);
    expect(screen.queryByTestId("college-create-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`delete-college-${COLLEGE_A.id}`)).not.toBeInTheDocument();
  });
});

describe("CollegesManager, delete confirmation flow", () => {
  it("clicking the row's delete button opens a confirm dialog before mutating", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId(`delete-college-${COLLEGE_A.id}`));
    expect(await screen.findByTestId("confirm-delete-college")).toBeInTheDocument();
  });
});

describe("CollegesManager, a11y", () => {
  it("has no detectable a11y violations with a populated list", async () => {
    const { container } = renderManager();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
