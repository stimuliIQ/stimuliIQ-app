// Tests for the row-action menu on Admin ▸ Users.
//
// Admin ▸ Users carries several row actions that look alike and are not: Deactivate (blocks
// the login, keeps the row) vs Delete (removes the account), and Reset password vs Clear
// two-factor. They ride on DIFFERENT permissions, `users.delete` and `twofa.reset`, which
// admin holds, against `users.remove` and `users.reset_password`, seeded for super_admin
// alone, so these tests pin the gating. The UI only hides what the API already forbids
// (CLAUDE.md §3.5), but an action rendered for an admin is still a promise the product
// cannot keep, and reads as the permission split having collapsed.
//
// They also pin the NAMING. These actions previously rendered as bare icons, and the key
// glyph that clears two-factor auth was reasonably read as a password reset. Every item
// carries its name now, and the credential action renames itself for an account that has
// never signed in, because there is no password there to "reset".

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, StaffUser } from "@repo/types";

import { UserDirectory } from "./user-directory";

const removeMock = vi.fn();
const resetPasswordMock = vi.fn();
const useStaffUsersListMock = vi.fn();

vi.mock("../../hooks/use-staff-users", () => ({
  useStaffUsersList: (...args: unknown[]) => useStaffUsersListMock(...args),
  useDeactivateStaffUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveStaffUser: () => ({ mutateAsync: removeMock, isPending: false }),
  useResetStaffUserPassword: () => ({ mutateAsync: resetPasswordMock, isPending: false }),
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
// `twofa.reset` is a separate module from `users.*` but is held by super_admin, so the
// fixture includes it, otherwise the menu renders four items and the naming test below
// silently stops covering the credential action it exists to disambiguate.
const SUPER_ADMIN_PERMISSIONS = [
  ...ADMIN_PERMISSIONS,
  "users.remove",
  "users.reset_password",
  "twofa.reset",
];

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
  resetPasswordMock.mockReset().mockResolvedValue({ email: "priya@stimuliiq.com" });
});

/** Row actions live behind a "⋯" menu, so every assertion has to open it first. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("user-row-actions"));
  // Radix portals the panel and moves focus into it, wait for that before asserting.
  await screen.findByRole("menu");
}

describe("UserDirectory, action menu", () => {
  // The whole reason the menu exists: an icon alone could not say which credential action
  // it performed, and the key glyph got read as "reset password" when it clears 2FA.
  it("names every action instead of relying on a glyph", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);

    for (const label of [
      "Edit",
      "Set new password",
      "Reset password",
      "Clear two-factor",
      "Deactivate",
      "Delete",
    ]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  // Twenty identical "Actions" buttons down a column tell a screen-reader user nothing
  // about which row they are on.
  it("names the trigger after the row's subject", () => {
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    expect(screen.getByRole("button", { name: "Actions for Priya Sharma" })).toBeInTheDocument();
  });

  it("renders no menu at all when the viewer can do nothing to the row", () => {
    renderDirectory(["users.view"]);
    expect(screen.queryByTestId("user-row-actions")).not.toBeInTheDocument();
  });
});

describe("UserDirectory, delete", () => {
  it("offers Delete to a super admin", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);
    expect(screen.getByTestId("user-row-actions-delete")).toBeInTheDocument();
  });

  // The point of the separate `users.remove` key: an admin can block a login, not erase an
  // account. If this ever renders, the split has collapsed.
  it("hides Delete from an admin who only holds users.delete", async () => {
    const user = userEvent.setup();
    renderDirectory(ADMIN_PERMISSIONS);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-delete")).not.toBeInTheDocument();
    // …while Deactivate, which they DO hold, is still there.
    expect(screen.getByTestId("user-row-actions-deactivate")).toBeInTheDocument();
  });

  // The API refuses self-removal, so offering it could only ever produce a 403.
  it("hides Delete on your own row", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ id: ME_ID, name: "Admin" })]);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-delete")).not.toBeInTheDocument();
  });

  it("confirms before deleting, and names Deactivate as the softer option", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);

    await user.click(screen.getByTestId("user-row-actions-delete"));

    const dialog = await screen.findByTestId("user-remove-confirm");
    expect(dialog).toHaveTextContent("Delete Priya Sharma?");
    // Most people reaching for Delete actually want Deactivate, say so before they commit.
    expect(dialog).toHaveTextContent(/use Deactivate instead/i);
    // And be honest that this is not an erasure of their history.
    expect(dialog).toHaveTextContent(/history[\s\S]*is kept/i);
    expect(removeMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete user" }));
    expect(removeMock).toHaveBeenCalledWith("user-1");
  });

  // Deactivate hides once the account is already deactivated; Delete must not, or a
  // deactivated test account could never be cleared out.
  it("still offers Delete for an already-deactivated account", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ status: "deactivated" })]);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-deactivate")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-row-actions-delete")).toBeInTheDocument();
  });
});

// ─── Reset password / resend invitation ─────────────────────────────────────
//
// `users.reset_password` is super_admin-only for the same reason `users.remove` is: an
// admin who can mint a super admin's credentials can take that account over through its
// inbox. If the item ever renders for a plain admin, that escalation path is open.
describe("UserDirectory, reset password", () => {
  it("offers Reset password to a super admin", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);
    expect(screen.getByTestId("user-row-actions-reset-password")).toBeInTheDocument();
  });

  it("hides Reset password from an admin who only holds users.edit", async () => {
    const user = userEvent.setup();
    renderDirectory(ADMIN_PERMISSIONS);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-reset-password")).not.toBeInTheDocument();
    // …while Edit, which they DO hold, is still there.
    expect(screen.getByTestId("user-row-actions-edit")).toBeInTheDocument();
  });

  // The API refuses self-reset (own password changes go through account settings, which
  // asks for the current one), so offering it could only ever produce a 403.
  it("hides Reset password on your own row", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ id: ME_ID, name: "Admin" })]);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-reset-password")).not.toBeInTheDocument();
  });

  it("confirms first, and warns that sessions die and the password is not shown here", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);

    await user.click(screen.getByTestId("user-row-actions-reset-password"));

    const dialog = await screen.findByTestId("user-reset-password-confirm");
    expect(dialog).toHaveTextContent("Reset password for Priya Sharma?");
    expect(dialog).toHaveTextContent(/signed out everywhere/i);
    // The operator never sees the credential, only the account holder does.
    expect(dialog).toHaveTextContent(/won't see the new password/i);
    expect(resetPasswordMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(resetPasswordMock).toHaveBeenCalledWith("user-1");
  });

  // An `invited` account has never had a working password, so there is nothing to "reset".
  // ONE action, named for what it does to THIS row, the same endpoint either way.
  it("calls the action Resend invitation for someone who never signed in", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ status: "invited" })]);
    await openRowMenu(user);

    const item = screen.getByTestId("user-row-actions-reset-password");
    expect(item).toHaveTextContent(/Resend invitation/i);
    expect(item).not.toHaveTextContent(/Reset password/i);
  });

  it("does not claim an invited user will be signed out, they have no session", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ status: "invited" })]);
    await openRowMenu(user);

    await user.click(screen.getByTestId("user-row-actions-reset-password"));

    const dialog = await screen.findByTestId("user-reset-password-confirm");
    expect(dialog).toHaveTextContent(/Send Priya Sharma their sign-in details\?/i);
    expect(dialog).not.toHaveTextContent(/signed out everywhere/i);
    // The one guarantee that holds in both cases.
    expect(dialog).toHaveTextContent(/won't see it/i);
  });
});

// ─── Set new password ───────────────────────────────────────────────────────
//
// Distinct from Reset password: the operator picks the value and therefore knows it. It
// rides `users.edit`, matching what PATCH /crm/admin/users/:id already enforces.
describe("UserDirectory, set new password", () => {
  it("offers Set new password to anyone who can edit users", async () => {
    const user = userEvent.setup();
    renderDirectory(ADMIN_PERMISSIONS);
    await openRowMenu(user);
    expect(screen.getByTestId("user-row-actions-set-password")).toBeInTheDocument();
  });

  // update() revokes every session for the target, so doing this to yourself signs you out
  // mid-action. Your own password belongs in account settings.
  it("hides Set new password on your own row", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS, [staffUser({ id: ME_ID, name: "Admin" })]);
    await openRowMenu(user);
    expect(screen.queryByTestId("user-row-actions-set-password")).not.toBeInTheDocument();
  });

  it("keeps it separate from Reset password, they are different acts", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);

    const setItem = screen.getByTestId("user-row-actions-set-password");
    // The distinction that matters: one is chosen by the operator, one is not.
    expect(setItem).toHaveTextContent(/you will know it/i);
    expect(screen.getByTestId("user-row-actions-reset-password")).toBeInTheDocument();
  });

  it("opens the dialog with both fields", async () => {
    const user = userEvent.setup();
    renderDirectory(SUPER_ADMIN_PERMISSIONS);
    await openRowMenu(user);

    await user.click(screen.getByTestId("user-row-actions-set-password"));

    expect(await screen.findByTestId("user-set-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("user-set-password-confirm-input")).toBeInTheDocument();
  });
});
