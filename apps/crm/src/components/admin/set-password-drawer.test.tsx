// Tests for Admin ▸ Users ▸ Set new password.
//
// This action is strictly more powerful than "Reset password": the operator chooses the
// value, so the operator knows it and can sign in as that user. These tests pin the two
// things that keep it from being a foot-gun, the confirmation field actually blocks a
// typo, and the dialog says out loud who ends up knowing the password.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { StaffUser } from "@repo/types";

import { SetPasswordDrawer } from "./set-password-drawer";

const updateMock = vi.fn();

vi.mock("../../hooks/use-staff-users", () => ({
  useUpdateStaffUser: () => ({ mutateAsync: updateMock, isPending: false }),
}));

const USER: StaffUser = {
  id: "user-1",
  name: "Priya Sharma",
  email: "priya@stimuliiq.test",
  phone: null,
  status: "active",
  roles: [],
  lastLoginAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
} as StaffUser;

function renderDrawer(user: StaffUser | null = USER) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SetPasswordDrawer user={user} onOpenChange={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const VALID = "Sup3rSecret!x";

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ id: "user-1" });
});

describe("SetPasswordDrawer", () => {
  it("submits the new password once it is confirmed", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), VALID);
    await user.type(screen.getByTestId("user-set-password-confirm-input"), VALID);
    await user.click(screen.getByTestId("user-set-password-submit"));

    expect(updateMock).toHaveBeenCalledWith({ id: "user-1", body: { password: VALID } });
  });

  // The entire reason for a second field. A typo here locks someone out of their account
  // with a password nobody knows.
  it("refuses to submit when the two fields differ", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), VALID);
    await user.type(screen.getByTestId("user-set-password-confirm-input"), "Sup3rSecret!y");

    expect(screen.getByTestId("user-set-password-submit")).toBeDisabled();
    expect(screen.getByText("Both passwords must match")).toBeInTheDocument();
  });

  it("does not nag about a mismatch before anything is typed in the confirm field", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), VALID);

    expect(screen.queryByText("Both passwords must match")).not.toBeInTheDocument();
  });

  // The checklist and the submit gate both come from checkPasswordRules, the same source
  // PasswordSchema validates with, so the UI cannot promise what the API rejects.
  it("blocks a password that fails the policy even when both fields agree", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), "short1");
    await user.type(screen.getByTestId("user-set-password-confirm-input"), "short1");

    expect(screen.getByTestId("user-set-password-submit")).toBeDisabled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("shows which rule is still unmet while typing", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), "abcdefghijk");

    // Long enough and has letters, but no digit.
    expect(screen.getByTestId("password-requirements-length")).toHaveAttribute("data-met", "true");
    expect(screen.getByTestId("password-requirements-digit")).toHaveAttribute("data-met", "false");
  });

  // Presenting this as interchangeable with "Reset password" is exactly how a credential
  // action gets misused.
  it("warns that the operator will know the password", () => {
    renderDrawer();
    expect(screen.getByText(/You will know this password/i)).toBeInTheDocument();
    expect(screen.getByText(/signed out everywhere/i)).toBeInTheDocument();
  });

  it("renders closed when no user is selected", () => {
    renderDrawer(null);
    expect(screen.queryByTestId("user-set-password-input")).not.toBeInTheDocument();
  });
});

// Sign-in requires a non-empty hash AND status "active". Setting a password on an invited
// account without promoting it produces a credential that cannot be used.
describe("SetPasswordDrawer, invited accounts", () => {
  it("promotes an invited account to active so the new password actually works", async () => {
    const user = userEvent.setup();
    renderDrawer({ ...USER, status: "invited" } as StaffUser);

    await user.type(screen.getByTestId("user-set-password-input"), VALID);
    await user.type(screen.getByTestId("user-set-password-confirm-input"), VALID);
    await user.click(screen.getByTestId("user-set-password-submit"));

    expect(updateMock).toHaveBeenCalledWith({
      id: "user-1",
      body: { password: VALID, status: "active" },
    });
  });

  // Someone disabled that login on purpose; a password change must not undo it.
  it("does NOT reactivate a deactivated account", async () => {
    const user = userEvent.setup();
    renderDrawer({ ...USER, status: "deactivated" } as StaffUser);

    await user.type(screen.getByTestId("user-set-password-input"), VALID);
    await user.type(screen.getByTestId("user-set-password-confirm-input"), VALID);
    await user.click(screen.getByTestId("user-set-password-submit"));

    expect(updateMock).toHaveBeenCalledWith({ id: "user-1", body: { password: VALID } });
  });

  it("leaves an already-active account's status alone", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("user-set-password-input"), VALID);
    await user.type(screen.getByTestId("user-set-password-confirm-input"), VALID);
    await user.click(screen.getByTestId("user-set-password-submit"));

    expect(updateMock).toHaveBeenCalledWith({ id: "user-1", body: { password: VALID } });
  });
});
