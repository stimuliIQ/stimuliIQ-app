// Tests for Organisation ▸ Teams.
//
// The properties worth pinning are the ones that make the org chart legible rather than
// merely present: an incomplete team must SHOW that it is incomplete (a missing lead
// silently reroutes that team's leave to HR, and the person looking at this list is the only
// one who can fix it), and every write affordance must be hidden from somebody without
// `org.teams.manage` — the API is the real gate, but a button that always 403s is its own
// bug. The banner is asserted too, because "a team decides who approves your leave" is the
// one thing somebody adding a member has to know before they do it.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, Team } from "@repo/types";

const deleteTeamMock = vi.fn();
let teams: Team[];

vi.mock("../../hooks/use-org", () => ({
  useTeamsList: () => ({
    data: { items: teams, meta: { page: 1, pageSize: 100, total: teams.length, hasMore: false } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDeleteTeam: () => ({ mutate: deleteTeamMock, isPending: false }),
  // The drawer is stubbed out — it has its own concerns and its own shared validator.
  useTeam: () => ({ data: undefined, isLoading: false }),
  useAssignableStaff: () => ({ data: [], isLoading: false }),
  useCreateTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetTeamMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TeamsWorkspace } from "./teams-workspace";

function team(over: Partial<Team> = {}): Team {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Sales",
    manager: { id: "m1", name: "Ravi", email: "ravi@x.test" },
    lead: { id: "l1", name: "Priya", email: "priya@x.test" },
    branchId: null,
    branchName: null,
    active: true,
    memberCount: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function me(permissions: Array<{ key: string; scope: string }>): MeResponse {
  return { permissions } as unknown as MeResponse;
}

const MANAGER_ME = me([
  { key: "org.teams.view", scope: "all" },
  { key: "org.teams.manage", scope: "all" },
]);
const VIEWER_ME = me([{ key: "org.teams.view", scope: "all" }]);

function renderWorkspace(viewer: MeResponse) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TeamsWorkspace me={viewer} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  deleteTeamMock.mockReset();
  teams = [team()];
});

describe("TeamsWorkspace", () => {
  it("lists a team with its manager and lead", () => {
    renderWorkspace(MANAGER_ME);

    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Ravi")).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });

  it("explains that a team decides who approves leave", () => {
    // Somebody adding a person to a team is changing who signs their absence off. That must
    // not be something they discover afterwards.
    renderWorkspace(MANAGER_ME);

    expect(screen.getByTestId("teams-purpose-note")).toBeInTheDocument();
  });

  it("flags a team with no lead rather than leaving the cell blank", () => {
    // A missing lead silently reroutes that team's leave to HR.
    teams = [team({ lead: null })];

    renderWorkspace(MANAGER_ME);

    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("flags a team with no manager too", () => {
    teams = [team({ manager: null })];

    renderWorkspace(MANAGER_ME);

    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("offers create and disband to somebody who may manage teams", () => {
    renderWorkspace(MANAGER_ME);

    expect(screen.getByTestId("team-create-button")).toBeInTheDocument();
    expect(screen.getByTestId(`delete-team-${teams[0]!.id}`)).toBeInTheDocument();
  });

  it("hides every write affordance from a viewer who may only read the chart", () => {
    renderWorkspace(VIEWER_ME);

    expect(screen.queryByTestId("team-create-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`delete-team-${teams[0]!.id}`)).not.toBeInTheDocument();
    // The chart itself is still readable — hiding the buttons must not hide the data.
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("tells a manager what to do when there are no teams yet", () => {
    teams = [];

    renderWorkspace(MANAGER_ME);

    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    expect(screen.getByText(/everyone's leave goes to HR/i)).toBeInTheDocument();
  });
});
