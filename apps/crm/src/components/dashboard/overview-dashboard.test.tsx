// Component + a11y tests for OverviewDashboard (R12, docs/plans/phase-9-completion.md
// T41 — crm test infrastructure). Data hooks are mocked directly. Covers the
// HEADLINE requirement (per this component's own file header): "RBAC-aware: every
// section/query only renders if `me.permissions` already includes the matching key" —
// a role with NO matching permissions sees the empty state, never a query/card for a
// permission it doesn't hold; a role WITH a subset of permissions sees exactly that
// subset of cards, not the rest.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MeResponse } from "@repo/types";

import { OverviewDashboard } from "./overview-dashboard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const useRevenueReportMock = vi.fn();
const useEnrollmentTrendReportMock = vi.fn();
const useFunnelReportMock = vi.fn();
vi.mock("../../hooks/use-reports", () => ({
  useRevenueReport: (...args: unknown[]) => useRevenueReportMock(...args),
  useEnrollmentTrendReport: (...args: unknown[]) => useEnrollmentTrendReportMock(...args),
  useFunnelReport: (...args: unknown[]) => useFunnelReportMock(...args),
}));

const usePaymentsListMock = vi.fn();
vi.mock("../../hooks/use-payments", () => ({
  usePaymentsList: (...args: unknown[]) => usePaymentsListMock(...args),
}));

const useTicketsListMock = vi.fn();
vi.mock("../../hooks/use-tickets", () => ({
  useTicketsList: (...args: unknown[]) => useTicketsListMock(...args),
}));

const IDLE_QUERY = { data: undefined, isLoading: false, isError: false };

function meWithPermissions(keys: string[]): MeResponse {
  return {
    user: { id: "u-1", email: "staff@stimuliiq.test", name: "Staff Member", phone: null, avatar: null, status: "active", mustChangePassword: false },
    tenantId: "t-1",
    roles: ["admin"],
    permissions: keys.map((key) => ({ key, scope: "all" as const })),
  };
}

beforeEach(() => {
  useRevenueReportMock.mockReturnValue(IDLE_QUERY);
  useEnrollmentTrendReportMock.mockReturnValue(IDLE_QUERY);
  useFunnelReportMock.mockReturnValue(IDLE_QUERY);
  usePaymentsListMock.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
  useTicketsListMock.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
});

describe("OverviewDashboard — RBAC-aware rendering", () => {
  it("a role with NO matching permissions sees the empty state, no KPI cards, no queries fired", () => {
    render(<OverviewDashboard me={meWithPermissions([])} />);
    expect(screen.getByTestId("overview-dashboard-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-kpi-revenue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-pending-payments")).not.toBeInTheDocument();
  });

  it("a role with ONLY reports.revenue.view sees the revenue KPI card and NOTHING else", () => {
    render(<OverviewDashboard me={meWithPermissions(["reports.revenue.view"])} />);
    expect(screen.getByTestId("overview-kpi-revenue")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-kpi-enrollment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-kpi-funnel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-pending-payments")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-open-tickets")).not.toBeInTheDocument();
  });

  it("a full-access admin sees every KPI card and every operational list", () => {
    render(
      <OverviewDashboard
        me={meWithPermissions([
          "reports.revenue.view",
          "reports.enrollment.view",
          "reports.funnel.view",
          "payments.view",
          "tickets.view",
        ])}
      />,
    );
    expect(screen.getByTestId("overview-kpi-revenue")).toBeInTheDocument();
    expect(screen.getByTestId("overview-kpi-enrollment")).toBeInTheDocument();
    expect(screen.getByTestId("overview-kpi-funnel")).toBeInTheDocument();
    expect(screen.getByTestId("overview-pending-payments")).toBeInTheDocument();
    expect(screen.getByTestId("overview-open-tickets")).toBeInTheDocument();
  });

  it("an operational list in an error state renders an alert, not a crash", () => {
    useTicketsListMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<OverviewDashboard me={meWithPermissions(["tickets.view"])} />);
    expect(screen.getByTestId("overview-open-tickets")).toHaveTextContent(/couldn't load this list/i);
  });

  it("me undefined (still loading /me) renders the empty state, not a crash", () => {
    render(<OverviewDashboard me={undefined} />);
    expect(screen.getByTestId("overview-dashboard-empty")).toBeInTheDocument();
  });
});

describe("OverviewDashboard — a11y", () => {
  it("has no detectable a11y violations for a full-access admin", async () => {
    const { container } = render(
      <OverviewDashboard
        me={meWithPermissions([
          "reports.revenue.view",
          "reports.enrollment.view",
          "reports.funnel.view",
          "payments.view",
          "tickets.view",
        ])}
      />,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("has no detectable a11y violations in the empty state", async () => {
    const { container } = render(<OverviewDashboard me={meWithPermissions([])} />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
