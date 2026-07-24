// Component + a11y tests for TicketDetailDrawer (R12, docs/plans/phase-9-completion.md
// T41 — crm test infrastructure). Data hooks are mocked directly (not the apiClient) so
// this is a pure component-level test of loading/error/empty/loaded states + the
// internal-note / status-editor RBAC gate (`canManage`).

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { TicketDetailDrawer } from "./ticket-detail-drawer";

const useTicketMock = vi.fn();
const useCannedResponsesListMock = vi.fn();
const useAddTicketMessageMock = vi.fn();
const useUpdateTicketMock = vi.fn();
const useFacultyListMock = vi.fn();

vi.mock("../../hooks/use-tickets", () => ({
  useTicket: (...args: unknown[]) => useTicketMock(...args),
  useCannedResponsesList: (...args: unknown[]) => useCannedResponsesListMock(...args),
  useAddTicketMessage: (...args: unknown[]) => useAddTicketMessageMock(...args),
  useUpdateTicket: (...args: unknown[]) => useUpdateTicketMock(...args),
}));

vi.mock("../../hooks/use-faculty", () => ({
  useFacultyList: (...args: unknown[]) => useFacultyListMock(...args),
}));

const AGENT_ME: MeResponse = {
  user: { id: "u-agent-1", email: "agent@stimuliiq.test", name: "Support Agent", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["support"],
  permissions: [{ key: "tickets.edit", scope: "all" }],
};

const READ_ONLY_ME: MeResponse = {
  ...AGENT_ME,
  user: { ...AGENT_ME.user, id: "u-readonly-1" },
  permissions: [{ key: "tickets.view", scope: "all" }],
};

const BASE_TICKET = {
  id: "tix-1",
  subject: "Refund not received",
  userId: "student-1",
  userName: "Jane Student",
  status: "open" as const,
  priority: "high" as const,
  assigneeId: null,
  slaDueAt: null,
  messages: [
    { id: "m-1", authorId: "student-1", authorName: "Jane Student", body: "Please check my refund status.", createdAt: "2026-01-01T00:00:00.000Z", isInternal: false },
  ],
};

function renderDrawer(props: { ticketId: string | null; me: MeResponse | undefined }) {
  return render(
    <ToastProvider>
      <TicketDetailDrawer ticketId={props.ticketId} onOpenChange={() => {}} me={props.me} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useTicketMock.mockReset();
  useCannedResponsesListMock.mockReturnValue({ data: { items: [] } });
  useAddTicketMessageMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateTicketMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useFacultyListMock.mockReturnValue({ data: { items: [] } });
});

describe("TicketDetailDrawer — loading / error / empty states", () => {
  it("shows a loading skeleton while the ticket is fetching", () => {
    useTicketMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderDrawer({ ticketId: "tix-1", me: AGENT_ME });
    expect(screen.getByTestId("ticket-detail-drawer")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-thread")).not.toBeInTheDocument();
  });

  it("shows a retry action when the ticket fetch fails", () => {
    useTicketMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderDrawer({ ticketId: "tix-1", me: AGENT_ME });
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("does not render the drawer content query surface at all when ticketId is null (Drawer closed)", () => {
    useTicketMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    renderDrawer({ ticketId: null, me: AGENT_ME });
    // Radix Dialog unmounts its content when closed — the thread/status editors are gone.
    expect(screen.queryByTestId("ticket-thread")).not.toBeInTheDocument();
  });
});

describe("TicketDetailDrawer — loaded ticket, RBAC-aware editing", () => {
  it("an agent WITH tickets.edit sees enabled status/priority/assignee editors + the message thread", async () => {
    useTicketMock.mockReturnValue({ data: BASE_TICKET, isLoading: false, isError: false, refetch: vi.fn() });
    renderDrawer({ ticketId: "tix-1", me: AGENT_ME });

    expect(await screen.findByTestId("ticket-thread")).toBeInTheDocument();
    expect(screen.getByText("Please check my refund status.")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-status-select")).not.toHaveAttribute("data-disabled");
  });

  it("a role WITHOUT tickets.edit sees the thread read-only (editors disabled)", async () => {
    useTicketMock.mockReturnValue({ data: BASE_TICKET, isLoading: false, isError: false, refetch: vi.fn() });
    renderDrawer({ ticketId: "tix-1", me: READ_ONLY_ME });

    await screen.findByTestId("ticket-thread");
    // Radix Select forwards `disabled` -> `data-disabled` on the trigger button.
    expect(screen.getByTestId("ticket-status-select")).toBeDisabled();
  });

  it("has no detectable a11y violations with a loaded ticket", async () => {
    useTicketMock.mockReturnValue({ data: BASE_TICKET, isLoading: false, isError: false, refetch: vi.fn() });
    const { container } = renderDrawer({ ticketId: "tix-1", me: AGENT_ME });
    await screen.findByTestId("ticket-thread");
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
