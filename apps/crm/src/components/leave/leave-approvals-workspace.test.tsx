// Component tests for the leave approval queue and the decision drawer.
//
// The two cases that carry the most weight: a reviewer without `leave.approve` must not be
// shown Approve/Turn down buttons the API would 403 (the UI only hides what the server
// already forbids), and turning a request down must be impossible without a reason, that
// text is emailed to the applicant verbatim, and an empty rejection is what makes somebody
// re-apply for the same dates next week.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { LeaveRequestDetail, LeaveRequestSummary, MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { LeaveApprovalsWorkspace } from "./leave-approvals-workspace";

const useLeaveRequestsMock = vi.fn();
const useLeaveTypesMock = vi.fn();
const useLeaveRequestMock = vi.fn();
const approveMutate = vi.fn();
const rejectMutate = vi.fn();

vi.mock("../../hooks/use-leave", () => ({
  useLeaveRequests: (...args: unknown[]) => useLeaveRequestsMock(...args),
  useLeaveTypes: (...args: unknown[]) => useLeaveTypesMock(...args),
  useLeaveRequest: (...args: unknown[]) => useLeaveRequestMock(...args),
  useApproveLeaveRequest: () => ({ mutateAsync: approveMutate, isPending: false }),
  useRejectLeaveRequest: () => ({ mutateAsync: rejectMutate, isPending: false }),
}));

const SUPER_ADMIN: MeResponse = {
  id: "admin-1",
  tenantId: "tenant-1",
  email: "owner@example.com",
  name: "Owner",
  roles: ["super_admin"],
  permissions: [
    { key: "leave.view", scope: "all" },
    { key: "leave.approve", scope: "all" },
  ],
} as unknown as MeResponse;

const PLAIN_ADMIN: MeResponse = {
  ...SUPER_ADMIN,
  roles: ["admin"],
  permissions: [{ key: "leave.view", scope: "all" }],
} as unknown as MeResponse;

const SUMMARY: LeaveRequestSummary = {
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
};

const DETAIL: LeaveRequestDetail = {
  ...SUMMARY,
  userEmail: "asha@example.com",
  reason: "Family wedding",
  reviewedById: null,
  reviewedByName: null,
  reviewedAt: null,
  reviewNote: null,
  cancelledAt: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderWorkspace(me: MeResponse = SUPER_ADMIN) {
  return render(
    <ToastProvider>
      <LeaveApprovalsWorkspace me={me} />
    </ToastProvider>,
  );
}

describe("LeaveApprovalsWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLeaveRequestsMock.mockReturnValue({
      data: { items: [SUMMARY], meta: { page: 1, pageSize: 25, total: 1, hasMore: false } },
      isLoading: false,
      isError: false,
    });
    useLeaveTypesMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    useLeaveRequestMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  // The queue exists to answer "what is waiting on me?", opening it on decided requests
  // buries the rows that need action.
  it("defaults to the pending filter", () => {
    renderWorkspace();
    expect(useLeaveRequestsMock).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
  });

  it("lists who is asking, for what, and how long", () => {
    renderWorkspace();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("Casual Leave")).toBeInTheDocument();
    expect(screen.getByText("5 days")).toBeInTheDocument();
  });

  it("tells a viewer without leave.approve that they cannot decide", () => {
    renderWorkspace(PLAIN_ADMIN);
    expect(screen.getByTestId("leave-approvals-readonly")).toBeInTheDocument();
  });

  it("does not show that banner to a super admin", () => {
    renderWorkspace();
    expect(screen.queryByTestId("leave-approvals-readonly")).not.toBeInTheDocument();
  });

  it("shows a reassuring empty state when nothing is waiting", () => {
    useLeaveRequestsMock.mockReturnValue({
      data: { items: [], meta: { page: 1, pageSize: 25, total: 0, hasMore: false } },
      isLoading: false,
      isError: false,
    });
    renderWorkspace();
    expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderWorkspace();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  describe("the decision drawer", () => {
    beforeEach(() => {
      useLeaveRequestMock.mockReturnValue({ data: DETAIL, isLoading: false, isError: false });
    });

    async function openDrawer(me: MeResponse = SUPER_ADMIN) {
      const user = userEvent.setup();
      renderWorkspace(me);
      await user.click(screen.getByText("Asha"));
      return user;
    }

    it("shows the applicant's reason, which is the point of opening it", async () => {
      await openDrawer();
      expect(await screen.findByText("Family wedding")).toBeInTheDocument();
    });

    it("offers Approve and Turn down to a super admin", async () => {
      await openDrawer();
      expect(await screen.findByTestId("leave-approve-start")).toBeInTheDocument();
      expect(screen.getByTestId("leave-reject-start")).toBeInTheDocument();
    });

    // The UI only hides what the API already forbids, but it must actually hide it.
    it("offers neither to a viewer without leave.approve", async () => {
      await openDrawer(PLAIN_ADMIN);
      expect(await screen.findByText("Family wedding")).toBeInTheDocument();
      expect(screen.queryByTestId("leave-approve-start")).not.toBeInTheDocument();
      expect(screen.queryByTestId("leave-reject-start")).not.toBeInTheDocument();
    });

    it("refuses to turn a request down with no reason", async () => {
      const user = await openDrawer();
      await user.click(await screen.findByTestId("leave-reject-start"));
      await user.click(screen.getByTestId("leave-reject-confirm"));

      expect(rejectMutate).not.toHaveBeenCalled();
      expect(screen.getByText("Tell them why, they'll see this.")).toBeInTheDocument();
    });

    it("sends the reason when one is given", async () => {
      approveMutate.mockResolvedValue(DETAIL);
      rejectMutate.mockResolvedValue(DETAIL);

      const user = await openDrawer();
      await user.click(await screen.findByTestId("leave-reject-start"));
      await user.type(screen.getByTestId("leave-decision-note"), "Too many people out that week");
      await user.click(screen.getByTestId("leave-reject-confirm"));

      expect(rejectMutate).toHaveBeenCalledWith({
        id: "req-1",
        body: { reason: "Too many people out that week" },
      });
    });

    // Approving needs no justification, so the note stays optional and empty means null.
    it("approves with an optional note", async () => {
      approveMutate.mockResolvedValue(DETAIL);

      const user = await openDrawer();
      await user.click(await screen.findByTestId("leave-approve-start"));
      await user.click(screen.getByTestId("leave-approve-confirm"));

      expect(approveMutate).toHaveBeenCalledWith({ id: "req-1", body: { note: null } });
    });

    it("offers no decision on a request that has already been decided", async () => {
      useLeaveRequestMock.mockReturnValue({
        data: { ...DETAIL, status: "approved", reviewedByName: "Owner" },
        isLoading: false,
        isError: false,
      });
      await openDrawer();
      expect(await screen.findByText("Family wedding")).toBeInTheDocument();
      expect(screen.queryByTestId("leave-approve-start")).not.toBeInTheDocument();
    });
  });
});
