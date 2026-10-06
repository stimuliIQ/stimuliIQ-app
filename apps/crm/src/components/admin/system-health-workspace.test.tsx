// Tests for Admin ▸ System Health.
//
// What is worth pinning: the verdict is the first thing on the page, an outage reads as an
// outage (not a blank), the student headcount is visible, and the loading and error states
// exist, because this is the screen somebody opens when something is already wrong.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SystemHealthReport } from "@repo/types";

type HookState = {
  data: SystemHealthReport | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
};

let state: HookState;

vi.mock("../../hooks/use-system-health", () => ({
  SYSTEM_HEALTH_POLL_MS: 30_000,
  useSystemHealth: () => state,
}));

import { SystemHealthWorkspace } from "./system-health-workspace";

function report(over: Partial<SystemHealthReport> = {}): SystemHealthReport {
  return {
    checkedAt: "2026-10-06T10:00:00.000Z",
    overall: { status: "healthy", headline: "All systems operational", healthyCount: 3, degradedCount: 0, downCount: 0, unknownCount: 0 },
    components: [
      { key: "api", name: "API server", category: "application", status: "healthy", latencyMs: null, summary: "Running and serving requests.", details: [{ label: "Uptime", value: "3h 2m" }] },
      { key: "postgres", name: "PostgreSQL", category: "data", status: "healthy", latencyMs: 42, summary: "Accepting queries.", details: [] },
      { key: "lms", name: "Student portal (LMS)", category: "frontend", status: "healthy", latencyMs: 120, summary: "Reachable and serving pages.", details: [] },
      { key: "email", name: "Email (Resend)", category: "integration", status: "unknown", latencyMs: null, summary: "Switched off (no-op provider).", details: [] },
    ],
    students: { total: 1234, activeAccounts: 1200, signedInLast24h: 310, signedInLast7d: 800, neverSignedIn: 44, newLast7d: 20, newLast30d: 90, liveSessions: 55 },
    runtime: { nodeVersion: "v22.19.0", environment: "production", uptimeSeconds: 11_000, startedAt: "2026-10-06T07:00:00.000Z", memoryRssMb: 210, heapUsedMb: 80, heapLimitMb: 120, eventLoopMeanMs: 1.2, eventLoopP99Ms: 8, hostMemoryUsedPercent: 61, cpuCount: 4 },
    traffic: { totalRequests: 5000, clientErrors: 40, serverErrors: 5, serverErrorRatePercent: 0.1, averageResponseMs: 85, inFlight: 2 },
    ...over,
  };
}

beforeEach(() => {
  state = { data: report(), isLoading: false, isError: false, isFetching: false, dataUpdatedAt: Date.now(), refetch: vi.fn() };
});

describe("SystemHealthWorkspace", () => {
  it("leads with the overall verdict and shows the student headcount", () => {
    render(<SystemHealthWorkspace />);
    expect(within(screen.getByTestId("system-health-overall")).getByText("All systems operational")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-students-total")).getByText("1,234")).toBeTruthy();
  });

  it("shows each component with a status word, never colour alone", () => {
    render(<SystemHealthWorkspace />);
    expect(within(screen.getByTestId("health-postgres-status")).getByText("Healthy")).toBeTruthy();
    expect(within(screen.getByTestId("health-email-status")).getByText("Not in use")).toBeTruthy();
    expect(screen.getByText(/Responded in 42 ms/)).toBeTruthy();
  });

  it("tells the reader integrations are not pinged", () => {
    render(<SystemHealthWorkspace />);
    expect(screen.getByText(/not pinged/i)).toBeTruthy();
  });

  it("renders an outage as an outage", () => {
    state.data = report({
      overall: { status: "down", headline: "Outage: PostgreSQL", healthyCount: 2, degradedCount: 0, downCount: 1, unknownCount: 0 },
    });
    render(<SystemHealthWorkspace />);
    expect(within(screen.getByTestId("system-health-overall")).getByText("Outage: PostgreSQL")).toBeTruthy();
  });

  it("shows a loading state while the first check runs", () => {
    state = { ...state, data: undefined, isLoading: true };
    render(<SystemHealthWorkspace />);
    expect(screen.getByTestId("system-health-loading")).toBeTruthy();
  });

  it("treats a failed request as a result, with a retry, when there is nothing cached", () => {
    state = { ...state, data: undefined, isError: true };
    render(<SystemHealthWorkspace />);
    expect(screen.getByTestId("system-health-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the last good report and warns when a refresh fails", () => {
    state = { ...state, isError: true };
    render(<SystemHealthWorkspace />);
    expect(screen.getByTestId("system-health-stale")).toBeTruthy();
    expect(screen.getByTestId("system-health-overall")).toBeTruthy();
  });
});
