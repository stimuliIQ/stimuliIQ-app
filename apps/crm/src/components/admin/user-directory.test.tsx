// Tests for the Delete action on Admin ▸ Users.
//
// Admin ▸ Users now carries two destructive row actions that look alike and are not:
// Deactivate (blocks the login, keeps the row) and Delete (removes the account). They ride
// on DIFFERENT permissions — `users.delete`, which admin holds, and `users.remove`, seeded
// for super_admin alone — so these tests pin the gating. The UI only hides what the API
// already forbids (CLAUDE.md §3.5), but a Delete button rendered for an admin is still a
// promise the product cannot keep, and reads as the permission split having collapsed.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, StaffUser } from "@repo/types";

import { UserDirectory } from "./user-directory";

const removeMock = vi.fn();
const useStaffUsersListMock = vi.fn();

vi.mock("../../hooks/use-staff-users", () => ({
  useStaffUsersList: (...args: unknown[]) => useStaffUsersListMock(...args),
  useDeactivateStaffUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveStaffUser: () => ({ mutateAsync: removeMock, isPending: false }),
  useClearStaffUserTwoFactor: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateStaffUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateStaffUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../../hooks/use-roles", () => ({
  useRolesList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

const ME_ID = "me-1";

function me(permissionKeys: string[]): MeResponse {
  return {
    user: {
      id: ME_ID,
      email: "admin@stimuliiq.test",
      name: "Admin",
      phone: null,
      avatar: null,
      status: "active",
      mustChangePassword: false,
    },
    tenantId: "t-1",
    roles: ["admin"],
    permissions: permissionKeys.map((key) => ({ key, scope: "all" as const })),
  };
}

const ADMIN_PERMISSIONS = ["users.view", "users.create", "users.edit", "users.delete"];
const SUPER_ADMIN_PERMISSIONS = [...ADMIN_PERMISSIONS, "users.remove"];

function staffUser(overrides: Partial<StaffUser> = {}): StaffUser {
  return {
    id: "user-1",
    name: "Priya Sharma",
    email: "priya@stimuliiq.test",
    phone: null,
    status: "active",
    roles: [],
    lastLoginAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as StaffUser;
}

function renderDirectory(permissionKeys: string[], rows: StaffUser[] = [staffUser()]) {
  useStaffUsersListMock.mockReturnValue({
    data: { items: rows, meta: { page: 1, pageSize: 20, total: rows.length, hasMore: false } },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <UserDirectory me={me(permissionKeys)} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  removeMock.mockReset().mockResolvedValue({ deleted: true });
});

describe("UserDirectory — delete", () => {
  it("offers Delete to a super admin", () => {
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    expect(screen.getByTestId("user-remove-row-button")).toBeInTheDocument();
  });

  // The point of the separate `users.remove` key: an admin can block a login, not erase an
  // account. If this ever renders, the split has collapsed.
  it("hides Delete from an admin who only holds users.delete", () => {
    renderDirectory(ADMIN_PERMISSIONS);
    expect(screen.queryByTestId("user-remove-row-button")).not.toBeInTheDocument();
    // …while Deactivate, which they DO hold, is still there.
    expect(screen.getByTestId("user-deactivate-row-button")).toBeInTheDocument();
  });

  // The API refuses self-removal, so offering it could only ever produce a 403.
  it("hides Delete on your own row", () => {
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ id: ME_ID, name: "Admin" })]);
    expect(screen.queryByTestId("user-remove-row-button")).not.toBeInTheDocument();
  });

  it("confirms before deleting, and names Deactivate as the softer option", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);

    await user.click(screen.getByTestId("user-remove-row-button"));

    const dialog = await screen.findByTestId("user-remove-confirm");
    expect(dialog).toHaveTextContent("Delete Priya Sharma?");
    // Most people reaching for Delete actually want Deactivate — say so before they commit.
    expect(dialog).toHaveTextContent(/use Deactivate instead/i);
    // And be honest that this is not an erasure of their history.
    expect(dialog).toHaveTextContent(/history[\s\S]*is kept/i);
    expect(removeMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete user" }));
    expect(removeMock).toHaveBeenCalledWith("user-1");
  });

  it("keeps Delete separate from Deactivate — both render for a super admin", () => {
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    expect(screen.getByTestId("user-deactivate-row-button")).toBeInTheDocument();
    expect(screen.getByTestId("user-remove-row-button")).toBeInTheDocument();
  });

  // Deactivate hides once the account is already deactivated; Delete must not, or a
  // deactivated test account could never be cleared out.
  it("still offers Delete for an already-deactivated account", () => {
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ status: "deactivated" })]);
    expect(screen.queryByTestId("user-deactivate-row-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-remove-row-button")).toBeInTheDocument();
  });
});
