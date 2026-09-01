// Team revenue, from the reader's side of the glass.
//
// The behaviour worth pinning is what the screen does with money that belongs to NO team.
// Those two tiles are the difference between a report the reader can trust and one that
// quietly under-counts: hidden when zero, they would leave somebody unable to tell
// "everything is attributed" from "this screen doesn't show me that".

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MeResponse, TeamRevenueReportDto } from "@repo/types";

const useTeamRevenueReportMock = vi.fn();
vi.mock("../../hooks/use-reports", () => ({
  useTeamRevenueReport: (...args: unknown[]) => useTeamRevenueReportMock(...args),
}));

import { TeamRevenueReport, formatPaiseCompact } from "./team-revenue-report";

const REPORT: TeamRevenueReportDto = {
  from: "2026-07-01",
  to: "2026-07-31",
  currency: "INR",
  rows: [
    {
      teamId: "team-1",
      teamName: "North",
      managerName: "Asha",
      leadName: "Vikram",
      staffCount: 3,
      membersOwned: 7,
      payingMembers: 3,
      revenuePaise: 350_000,
    },
    {
      teamId: "team-2",
      teamName: "South",
      managerName: null,
      leadName: null,
      staffCount: 1,
      membersOwned: 0,
      payingMembers: 0,
      revenuePaise: 0,
    },
  ],
  totalRevenuePaise: 500_000,
  unownedRevenuePaise: 100_000,
  unteamedRevenuePaise: 50_000,
};

const ME = {
  permissions: [{ key: "reports.revenue.view", scope: "all" }],
} as unknown as MeResponse;

function renderReport(data: TeamRevenueReportDto | undefined = REPORT) {
  useTeamRevenueReportMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  return render(<TeamRevenueReport me={ME} />);
}

describe("formatPaiseCompact", () => {
  it("renders paise as whole rupees in the Indian grouping", () => {
    expect(formatPaiseCompact(12_500_000, "INR")).toBe("₹1,25,000");
  });

  it("prefixes a non-INR currency rather than showing a rupee sign", () => {
    expect(formatPaiseCompact(100_000, "USD")).toBe("USD 1,000");
  });
});

describe("TeamRevenueReport", () => {
  beforeEach(() => {
    useTeamRevenueReportMock.mockReset();
  });

  it("shows each team's revenue", () => {
    renderReport();

    const table = screen.getByTestId("team-revenue-table");
    expect(within(table).getByText("North")).toBeInTheDocument();
    expect(within(table).getByText("₹3,500")).toBeInTheDocument();
  });

  it("keeps a team that took nothing, rather than omitting it", () => {
    // An absent row reads as "no such team"; a zero row reads as "this team took nothing",
    // which is the fact a manager needs.
    renderReport();

    expect(within(screen.getByTestId("team-revenue-table")).getByText("South")).toBeInTheDocument();
  });

  it("says so plainly when a team has no manager yet", () => {
    // A team is routinely created before it is staffed. An empty cell leaves the reader to
    // decide whether it is missing data or a vacant post.
    renderReport();

    expect(screen.getByText(/Manager: not set/)).toBeInTheDocument();
  });

  it("shows money from untagged members instead of dropping it", () => {
    renderReport();

    const tile = screen.getByTestId("team-revenue-unowned-kpi");
    expect(within(tile).getByText("₹1,000")).toBeInTheDocument();
    expect(within(tile).getByText(/needs tagging/i)).toBeInTheDocument();
  });

  it("shows money whose owner is on no team as a separate figure", () => {
    // Split from "untagged" on purpose: tagging a member and putting a colleague on a team
    // are different chores for different people.
    renderReport();

    const tile = screen.getByTestId("team-revenue-unteamed-kpi");
    expect(within(tile).getByText("₹500")).toBeInTheDocument();
  });

  it("still renders both unattributed tiles when they are zero", () => {
    // The load-bearing case. Hiding them at zero would make "fully attributed" and "this
    // screen doesn't tell me" look identical.
    renderReport({
      ...REPORT,
      unownedRevenuePaise: 0,
      unteamedRevenuePaise: 0,
      totalRevenuePaise: 350_000,
    });

    expect(screen.getByTestId("team-revenue-unowned-kpi")).toBeInTheDocument();
    expect(screen.getByTestId("team-revenue-unteamed-kpi")).toBeInTheDocument();
    expect(screen.queryByText(/needs tagging/i)).not.toBeInTheDocument();
  });

  it("adds up: team rows plus both buckets equal the total on screen", () => {
    // The arithmetic the reader is entitled to assume. Asserted on the fixture so a future
    // change to what the tiles show cannot quietly break the reconciliation the API
    // guarantees.
    const attributed = REPORT.rows.reduce((sum, row) => sum + row.revenuePaise, 0);
    expect(attributed + REPORT.unownedRevenuePaise + REPORT.unteamedRevenuePaise).toBe(
      REPORT.totalRevenuePaise,
    );

    renderReport();
    expect(
      within(screen.getByTestId("team-revenue-total-kpi")).getByText("₹5,000"),
    ).toBeInTheDocument();
  });
});
