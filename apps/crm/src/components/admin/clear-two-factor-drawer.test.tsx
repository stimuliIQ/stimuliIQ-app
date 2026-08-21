// Regression tests for ClearTwoFactorDrawer's reset-on-target-change.
//
// The drawer resets its `reason` with a RENDER-PHASE state update rather than an effect, so
// a justification written for one user can never be rendered against another. That idiom is
// legitimate React, but it only works if the guard condition CONVERGES, a render-phase
// update gets no eager bailout, so React re-runs the component and throws "Too many
// re-renders" after 25 passes if the condition still holds.
//
// It did not converge: `user?.id` is `undefined` with no user selected while `lastUserId`
// initialises to `null`, and `undefined !== null`. Because Admin ▸ Users renders this drawer
// unconditionally with `user={null}`, the whole page crashed on load. The first test below
// is that exact case, it fails with "Too many re-renders" against the old comparison.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { StaffUser } from "@repo/types";

import { ClearTwoFactorDrawer } from "./clear-two-factor-drawer";

vi.mock("../../hooks/use-staff-users", () => ({
  useClearStaffUserTwoFactor: () => ({ mutateAsync: vi.fn().mockResolvedValue({ cleared: true }), isPending: false }),
}));

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

function renderDrawer(user: StaffUser | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ClearTwoFactorDrawer user={user} onOpenChange={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClearTwoFactorDrawer", () => {
  // The crash case: closed is the default state of the parent screen.
  it("renders closed without looping when no user is selected", () => {
    expect(() => renderDrawer(null)).not.toThrow();
    expect(screen.queryByTestId("user-clear-2fa-drawer")).not.toBeInTheDocument();
  });

  it("opens for a selected user", () => {
    renderDrawer(staffUser());
    expect(screen.getByTestId("user-clear-2fa-drawer")).toBeInTheDocument();
    expect(screen.getByText(/Priya Sharma · priya@stimuliiq.test/)).toBeInTheDocument();
  });

  it("settles after opening, a render-phase reset must converge, not re-fire", () => {
    // Re-rendering with the SAME user must not restart the reset cycle.
    const user = staffUser();
    const { rerender } = renderDrawer(user);
    expect(() =>
      rerender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <ClearTwoFactorDrawer user={user} onOpenChange={() => {}} />
          </ToastProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });

  // The reason lands in another admin's audit row, so it must never carry across targets.
  it("clears the typed reason when the target user changes", async () => {
    const typist = userEvent.setup();
    const { rerender } = renderDrawer(staffUser());

    const reason = screen.getByTestId("user-clear-2fa-reason");
    await typist.type(reason, "Verified over a video call.");
    expect(reason).toHaveValue("Verified over a video call.");

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ClearTwoFactorDrawer user={staffUser({ id: "user-2", name: "Ravi Kumar" })} onOpenChange={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("user-clear-2fa-reason")).toHaveValue("");
  });

  it("blocks submission until the reason is long enough to be useful in an audit row", async () => {
    const typist = userEvent.setup();
    renderDrawer(staffUser());

    expect(screen.getByTestId("user-clear-2fa-submit")).toBeDisabled();
    await typist.type(screen.getByTestId("user-clear-2fa-reason"), "Lost phone, verified on a call.");
    expect(screen.getByTestId("user-clear-2fa-submit")).toBeEnabled();
  });
});
