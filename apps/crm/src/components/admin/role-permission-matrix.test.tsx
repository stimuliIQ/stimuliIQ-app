// Regression test for RolePermissionMatrix (docs/03 §7.16). The headline bug:
// the `hasChanges` useMemo used to sit AFTER the isLoading/isError early
// returns, so switching roles — which flips the component through its loading
// state — changed the hook count between renders and threw "rendered more hooks
// than during the previous render". This test drives exactly that loading ->
// loaded transition and asserts the component survives it.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  permissions: [{ key: "students.view", scope: "all" }],
};

const CATALOG = {
  modules: [{ module: "students", permissions: [{ key: "students.view", label: "View students" }] }],
};
const GRANTS = { grants: [{ permissionKey: "students.view", scope: "all" as const }] };

const loadingQuery = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
const catalogLoaded = { data: CATALOG, isLoading: false, isError: false, refetch: vi.fn() };
const grantsLoaded = { data: GRANTS, isLoading: false, isError: false, refetch: vi.fn() };

function renderMatrix() {
  return render(
    <ToastProvider>
      <RolePermissionMatrix role={ROLE} me={ME} />
    </ToastProvider>,
  );
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

    // Data arrives — this rerender is where the extra useMemo used to appear and throw.
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);
    expect(() =>
      rerender(
        <ToastProvider>
          <RolePermissionMatrix role={ROLE} me={ME} />
        </ToastProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("permission-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("permission-matrix-save")).toBeDisabled();
  });

  it("renders an on/off toggle per permission (no scope picker)", () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue(grantsLoaded);
    renderMatrix();
    expect(screen.getByTestId("permission-matrix")).toBeInTheDocument();
    // The row is a plain toggle now — the scope <Select> is gone entirely.
    expect(screen.getByTestId("permission-toggle-students.view")).toBeInTheDocument();
    expect(screen.queryByTestId("permission-scope-students.view")).not.toBeInTheDocument();
  });

  it("saves a newly-toggled permission at 'all' scope", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useUpdateRolePermissionsMock.mockReturnValue({ mutateAsync, isPending: false });
    // Catalog has a permission this role does NOT yet hold; the editor holds it at "all".
    usePermissionCatalogMock.mockReturnValue({
      data: { modules: [{ module: "students", permissions: [{ key: "students.view", label: "View students" }] }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRolePermissionsMock.mockReturnValue({ data: { grants: [] }, isLoading: false, isError: false, refetch: vi.fn() });

    const user = userEvent.setup();
    renderMatrix();
    await user.click(screen.getByTestId("permission-toggle-students.view"));
    await user.click(screen.getByTestId("permission-matrix-save"));

    expect(mutateAsync).toHaveBeenCalledWith({
      roleId: ROLE.id,
      body: { grants: [{ permissionKey: "students.view", scope: "all" }] },
    });
  });

  it("disables the toggle for a permission the editor only holds at a narrower scope", () => {
    usePermissionCatalogMock.mockReturnValue(catalogLoaded);
    useRolePermissionsMock.mockReturnValue({ data: { grants: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    // Editor holds students.view only at "branch" — can't grant it at "all".
    const branchOnlyMe: MeResponse = { ...ME, permissions: [{ key: "students.view", scope: "branch" }] };
    render(
      <ToastProvider>
        <RolePermissionMatrix role={ROLE} me={branchOnlyMe} />
      </ToastProvider>,
    );
    expect(screen.getByTestId("permission-toggle-students.view")).toBeDisabled();
    expect(screen.getByTestId("permission-row-locked-students.view")).toHaveTextContent(/limited scope/i);
  });
});
