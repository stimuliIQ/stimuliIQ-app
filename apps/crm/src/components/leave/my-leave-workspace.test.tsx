// Component tests for My Leave. Mocks the data hooks directly (CLAUDE.md §3.3: components
// hold no business logic, so these are rendering/gating tests).
//
// The cases that matter here are the ones where the screen would otherwise mislead somebody
// about their own entitlement: a balance that ignores pending requests, a Withdraw button on
// a request that cannot be withdrawn, and an apply button offered to a role that will be
// 403'd by the API.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { LeaveApplyContext, LeaveRequestSummary, MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { MyLeaveWorkspace } from "./my-leave-workspace";

const useLeaveApplyContextMock = vi.fn();
const useLeaveRequestsMock = vi.fn();
const useCancelLeaveRequestMock = vi.fn();
const useLeaveRequestMock = vi.fn();
const useApproveLeaveRequestMock = vi.fn();
const useRejectLeaveRequestMock = vi.fn();
const useCreateLeaveRequestMock = vi.fn();

vi.mock("../../hooks/use-leave", () => ({
  useLeaveApplyContext: (...args: unknown[]) => useLeaveApplyContextMock(...args),
  useLeaveRequests: (...args: unknown[]) => useLeaveRequestsMock(...args),
  useCancelLeaveRequest: (...args: unknown[]) => useCancelLeaveRequestMock(...args),
  useLeaveRequest: (...args: unknown[]) => useLeaveRequestMock(...args),
  useApproveLeaveRequest: (...args: unknown[]) => useApproveLeaveRequestMock(...args),
  useRejectLeaveRequest: (...args: unknown[]) => useRejectLeaveRequestMock(...args),
  useCreateLeaveRequest: (...args: unknown[]) => useCreateLeaveRequestMock(...args),
}));

const ME: MeResponse = {
  id: "user-1",
  tenantId: "tenant-1",
  email: "asha@example.com",
  name: "Asha",
  roles: ["counsellor"],
  permissions: [
    { key: "leave.view", scope: "own" },
    { key: "leave.request", scope: "own" },
  ],
} as unknown as MeResponse;

const ME_READ_ONLY: MeResponse = {
  ...ME,
  permissions: [{ key: "leave.view", scope: "own" }],
} as unknown as MeResponse;

const CONTEXT: LeaveApplyContext = {
  year: 2026,
  weeklyOffDays: [0],
  holidayDates: [],
  types: [
    {
      id: "type-casual",
      key: "casual",
      name: "Casual Leave",
      description: null,
      paid: true,
      allowHalfDay: true,
      active: true,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  balances: [
    {
      leaveTypeId: "type-casual",
      leaveTypeName: "Casual Leave",
      paid: true,
      allowHalfDay: true,
      entitledDays: 12,
      usedDays: 2,
      pendingDays: 1,
      remainingDays: 9,
    },
    {
      leaveTypeId: "type-unpaid",
      leaveTypeName: "Leave Without Pay",
      paid: false,
      allowHalfDay: true,
      entitledDays: null,
      usedDays: 0,
      pendingDays: 0,
      remainingDays: null,
    },
  ],
};

function makeRequest(overrides: Partial<LeaveRequestSummary> = {}): LeaveRequestSummary {
  return {
    id: "req-1",
    userId: "user-1",
    userName: "Asha",
    leaveTypeId: "type-casual",
    leaveTypeName: "Casual Leave",
    startDate: "2026-08-17",
    endDate: "2026-08-21",
    startDayPart: "full",
    endDayPart: "full",
    halfDays: 10,
    days: 5,
    status: "pending",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderWorkspace(me: MeResponse = ME) {
  return render(
    <ToastProvider>
      <MyLeaveWorkspace me={me} />
    </ToastProvider>,
  );
}

describe("MyLeaveWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLeaveApplyContextMock.mockReturnValue({ data: CONTEXT, isLoading: false, isError: false });
    useLeaveRequestsMock.mockReturnValue({
      data: { items: [makeRequest()], meta: { page: 1, pageSize: 25, total: 1, hasMore: false } },
      isLoading: false,
      isError: false,
    });
    useCancelLeaveRequestMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useLeaveRequestMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    useApproveLeaveRequestMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useRejectLeaveRequestMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useCreateLeaveRequestMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("renders a balance card per leave type", () => {
    renderWorkspace();
    expect(screen.getByTestId("leave-balance-type-casual")).toBeInTheDocument();
    expect(screen.getByTestId("leave-balance-type-unpaid")).toBeInTheDocument();
  });

  // Remaining already has pending deducted server-side. Showing the breakdown is what keeps
  // that from reading as an error the first time somebody applies for a week.
  it("shows what has been taken and what is still awaiting approval", () => {
    renderWorkspace();
    const card = screen.getByTestId("leave-balance-type-casual");
    expect(card).toHaveTextContent("9 days");
    expect(card).toHaveTextContent("2 days taken");
    expect(card).toHaveTextContent("1 day awaiting approval");
  });

  it("says unpaid leave has no allowance rather than showing a zero", () => {
    renderWorkspace();
    expect(screen.getByTestId("leave-balance-type-unpaid")).toHaveTextContent(
      "Not counted against an allowance",
    );
  });

  it("lists the requests with their dates and length", () => {
    renderWorkspace();
    expect(screen.getByText("17 – 21 Aug 2026")).toBeInTheDocument();
    expect(screen.getByText("5 days")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  });

  it("offers Withdraw on a pending request", () => {
    renderWorkspace();
    expect(screen.getByTestId("leave-withdraw-req-1")).toBeInTheDocument();
  });

  // A Withdraw button whose only possible outcome is an error message is worse than none.
  it.each(["rejected", "cancelled"] as const)("hides Withdraw on a %s request", (status) => {
    useLeaveRequestsMock.mockReturnValue({
      data: {
        items: [makeRequest({ status })],
        meta: { page: 1, pageSize: 25, total: 1, hasMore: false },
      },
      isLoading: false,
      isError: false,
    });
    renderWorkspace();
    expect(screen.queryByTestId("leave-withdraw-req-1")).not.toBeInTheDocument();
  });

  it("hides the apply button from someone who cannot apply", () => {
    renderWorkspace(ME_READ_ONLY);
    expect(screen.queryByTestId("leave-apply-open")).not.toBeInTheDocument();
  });

  it("shows the apply button to someone who can", () => {
    renderWorkspace();
    expect(screen.getByTestId("leave-apply-open")).toBeInTheDocument();
  });

  it("shows an empty state when there are no requests", () => {
    useLeaveRequestsMock.mockReturnValue({
      data: { items: [], meta: { page: 1, pageSize: 25, total: 0, hasMore: false } },
      isLoading: false,
      isError: false,
    });
    renderWorkspace();
    expect(screen.getByText("No leave requests yet")).toBeInTheDocument();
  });

  it("shows an error state instead of an empty table when the load fails", () => {
    useLeaveRequestsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderWorkspace();
    expect(screen.getByTestId("leave-requests-error")).toBeInTheDocument();
    expect(screen.queryByTestId("leave-requests-table")).not.toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderWorkspace();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
