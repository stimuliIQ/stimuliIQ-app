// Regression + behaviour tests for RolePermissionMatrix (docs/03 §7.16).
//
// The original headline bug: the `hasChanges` useMemo used to sit AFTER the
// isLoading/isError early returns, so switching roles, which flips the component through
// its loading state, changed the hook count between renders and threw "rendered more hooks
// than during the previous render". The first test drives exactly that transition.
//
// The rest cover the sidebar-shaped tree: a screen toggle that reveals its actions,
// turning a screen off taking its actions with it, and the grants-without-view case that
// must never be silently dropped (the editor saves a FULL REPLACE of the grant set).
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, Role } from "@repo/types";

import { RolePermissionMatrix } from "./role-permission-matrix";

const usePermissionCatalogMock = vi.fn();
const useRolePermissionsMock = vi.fn();
const useUpdateRolePermissionsMock = vi.fn();
vi.mock("../../hooks/use-roles", () => ({
  usePermissionCatalog: (...args: unknown[]) => usePermissionCatalogMock(...args),
  useRolePermissions: (...args: unknown[]) => useRolePermissionsMock(...args),
  useUpdateRolePermissions: (...args: unknown[]) => useUpdateRolePermissionsMock(...args),
}));

const ROLE: Role = {
  id: "role-1",
  key: "counsellor",
  name: "Counsellor",
  description: null,
  isSystem: false,
} as unknown as Role;

const ME: MeResponse = {
  user: { id: "u-1", email: "admin@stimuliiq.test", name: "Admin", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [
    { key: "students.view", scope: "all" },
    { key: "students.edit", scope: "all" },
    { key: "students.delete", scope: "all" },
  ],
};

// `students.view` is the Students ▸ Directory gate; `students.edit`/`students.delete` are
// two of its actions (lib/permission-screens.ts).
const CATALOG = {
  modules: [
    {
      module: "students",
      permissions: [
        { key: "students.view", label: "View students" },
        { key: "students.edit", label: "Edit students" },
        { key: "students.delete", label: "Delete students" },
      ],
    },
  ],
};
const GRANTS = { grants: [{ permissionKey: "students.view", scope: "all" as const }] };

const loadingQuery = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
const catalogLoaded = { data: CATALOG, isLoading: false, isError: false, refetch: vi.fn() };
const grantsLoaded = { data: GRANTS, isLoading: false, isError: false, refetch: vi.fn() };
const noGrants = { data: { grants: [] }, isLoading: false, isError: false, refetch: vi.fn() };

function renderMatrix(me: MeResponse = ME) {
  return render(
    <ToastProvider>
      <RolePermissionMatrix role={ROLE} me={me} />
    </ToastProvider>,
  );
}

/**
 * Sections collapse by default when the role holds nothing in them, and a collapsed body is
 * `inert` — its switches are deliberately unclickable. Tests that act on a row open it first.
 */
async function openSection(user: ReturnType<typeof userEvent.setup>, name: string) {
  const section = screen.getByTestId("permission-matrix-module");
  const trigger = within(section).getByTestId("collapsible-section-trigger");
  if (trigger.getAttribute("aria-expanded") === "false") await user.click(trigger);
  expect(trigger).toHaveTextContent(name);
}

beforeEach(() => {
  useUpdateRolePermissionsMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("RolePermissionMatrix", () => {
  it("survives the loading -> loaded transition without a hook-order crash", () => {
    // First render: still loading (the state a role switch drops the component into).
    usePermissionCatalogMock.mockReturnValue(loadingQuery);
    useRolePermissionsMock.mockReturnValue(loadingQuery);
    const { rerender } = renderMatrix();
    expect(screen.getByTestId("permission-matrix-loading")).toBeInTheDocument();

    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);
    rerender(
      <ToastProvider>
        <RolePermissionMatrix role={ROLE} me={ME} />
      </ToastProvider>,
    );
    expect(screen.getByTestId("permission-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("permission-matrix-save")).toBeDisabled();
  });

  it("groups permissions under their sidebar section, not their module key", () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);
    renderMatrix();
    // "Students" is the sidebar section; the old editor printed the raw module name.
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveTextContent("Students");
    // The row is a plain toggle — the scope <Select> is gone entirely.
    expect(screen.getByTestId("permission-toggle-students.view")).toBeInTheDocument();
    expect(screen.queryByTestId("permission-scope-students.view")).not.toBeInTheDocument();
  });

  it("hides a screen's actions until the screen itself is switched on", async () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(noGrants);

    const user = userEvent.setup();
    renderMatrix();
    await openSection(user, "Students");

    expect(screen.queryByTestId("permission-toggle-students.edit")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("permission-toggle-students.view"));
    expect(screen.getByTestId("permission-toggle-students.edit")).toBeInTheDocument();
  });

  it("saves a newly-toggled permission at 'all' scope", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useUpdateRolePermissionsMock.mockReturnValue({ mutateAsync, isPending: false });
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(noGrants);

    const user = userEvent.setup();
    renderMatrix();
    await openSection(user, "Students");
    await user.click(screen.getByTestId("permission-toggle-students.view"));
    await user.click(screen.getByTestId("permission-matrix-save"));

    expect(mutateAsync).toHaveBeenCalledWith({
      roleId: ROLE.id,
      body: { grants: [{ permissionKey: "students.view", scope: "all" }] },
    });
  });

  it("drops a screen's actions when the screen is switched off", async () => {
    // "Can edit a screen they cannot open" is not a state to leave saveable by accident.
    const mutateAsync = vi.fn().mockResolvedValue({});
    useUpdateRolePermissionsMock.mockReturnValue({ mutateAsync, isPending: false });
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue({
      data: {
        grants: [
          { permissionKey: "students.view", scope: "all" as const },
          { permissionKey: "students.edit", scope: "all" as const },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const user = userEvent.setup();
    renderMatrix();
    await user.click(screen.getByTestId("permission-toggle-students.view"));
    await user.click(screen.getByTestId("permission-matrix-save"));

    expect(mutateAsync).toHaveBeenCalledWith({ roleId: ROLE.id, body: { grants: [] } });
  });

  it("keeps actions a role holds without the view permission, and flags them", async () => {
    // The editor saves a FULL REPLACE, so a grant it declines to render is revoked, not
    // hidden. A role seeded with `students.edit` and no `students.view` must keep it.
    const mutateAsync = vi.fn().mockResolvedValue({});
    useUpdateRolePermissionsMock.mockReturnValue({ mutateAsync, isPending: false });
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue({
      data: { grants: [{ permissionKey: "students.edit", scope: "all" as const }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const user = userEvent.setup();
    renderMatrix();
    await openSection(user, "Students");

    expect(screen.getByTestId("permission-orphan-students.view")).toBeInTheDocument();
    // Shown and still on, rather than quietly discarded.
    expect(screen.getByTestId("permission-toggle-students.edit")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("permission-matrix-save")).toBeDisabled();
  });

  it("disables the toggle for a permission the editor only holds at a narrower scope", () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(noGrants);
    // Editor holds students.view only at "branch", can't grant it at "all".
    renderMatrix({ ...ME, permissions: [{ key: "students.view", scope: "branch" }] });

    expect(screen.getByTestId("permission-toggle-students.view")).toBeDisabled();
    expect(screen.getByTestId("permission-row-locked-students.view")).toHaveTextContent(/limited scope/i);
  });

  // The screen used to show only `students.view` + "View students", which does not tell
  // whoever is configuring a role what the toggle actually does.
  it("explains each permission behind an info icon", async () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);

    const user = userEvent.setup();
    renderMatrix();

    expect(screen.queryByText(/Opens the Students list/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "What does Directory mean?" }));
    expect(screen.getByText(/Opens the Students list/i)).toBeInTheDocument();
  });

  it("filters the tree by screen name, action or raw key", async () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);

    const user = userEvent.setup();
    renderMatrix();
    await user.type(screen.getByTestId("permission-matrix-search"), "students.delete");

    expect(screen.getByTestId("permission-toggle-students.delete")).toBeInTheDocument();
    expect(screen.queryByTestId("permission-toggle-students.edit")).not.toBeInTheDocument();
  });
});
