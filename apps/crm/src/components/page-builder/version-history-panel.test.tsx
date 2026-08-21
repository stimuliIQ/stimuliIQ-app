// Regression test for QA D2: version rows must NEVER show a "Current"/live badge, and
// revert must be enabled on EVERY row (including the newest), save-before-apply means no
// version snapshot ever equals the live page, so there is no row to correctly disable.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@repo/ui";

import { VersionHistoryPanel } from "./version-history-panel";

const useContentPageVersionsListMock = vi.fn();
const useContentPageVersionMock = vi.fn();
const useRevertContentPageVersionMock = vi.fn();

vi.mock("../../hooks/use-page-builder", () => ({
  useContentPageVersionsList: (...args: unknown[]) => useContentPageVersionsListMock(...args),
  useContentPageVersion: (...args: unknown[]) => useContentPageVersionMock(...args),
  useRevertContentPageVersion: (...args: unknown[]) => useRevertContentPageVersionMock(...args),
}));

const VERSIONS = [
  { version: 2, title: "About us", createdBy: { id: "u-1", name: "Owner" }, createdAt: "2026-07-18T00:00:00.000Z" },
  { version: 1, title: "About us", createdBy: { id: "u-1", name: "Owner" }, createdAt: "2026-07-17T00:00:00.000Z" },
];

function renderPanel(currentVersion: number) {
  return render(
    <ToastProvider>
      <VersionHistoryPanel open pageId="page-1" currentVersion={currentVersion} onReverted={() => {}} onOpenChange={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useContentPageVersionsListMock.mockReset();
  useContentPageVersionMock.mockReset();
  useRevertContentPageVersionMock.mockReset();
  useContentPageVersionsListMock.mockReturnValue({ data: { items: VERSIONS }, isLoading: false, isError: false, refetch: vi.fn() });
  useContentPageVersionMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  useRevertContentPageVersionMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("VersionHistoryPanel, QA D2 (no 'Current' concept; every version revertible)", () => {
  it("never renders a 'Current' badge on any row, even when a version number equals currentVersion", () => {
    // `currentVersion=2` mirrors the OLD (buggy) comparison target, must have NO effect now.
    renderPanel(2);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("labels only the newest (first, list-position) row 'Before last save', not by comparing to currentVersion", () => {
    renderPanel(2);
    const rows = screen.getAllByText("Before last save");
    expect(rows).toHaveLength(1);
    // It's attached to version 2's row (the newest / first in the newest-first list).
    expect(screen.getByTestId("page-builder-version-row-2")).toHaveTextContent("Before last save");
    expect(screen.getByTestId("page-builder-version-row-1")).not.toHaveTextContent("Before last save");
  });

  it("enables the revert button on the NEWEST row (undo-my-last-edit must be possible)", () => {
    renderPanel(2);
    expect(screen.getByTestId("page-builder-version-revert-2")).not.toBeDisabled();
  });

  it("enables the revert button on every other row too", () => {
    renderPanel(2);
    expect(screen.getByTestId("page-builder-version-revert-1")).not.toBeDisabled();
  });

  it("still shows 'Before last save' on the newest row even when currentVersion is stale/mismatched (0, e.g. before the first load resolves)", () => {
    renderPanel(0);
    expect(screen.getByTestId("page-builder-version-row-2")).toHaveTextContent("Before last save");
    expect(screen.getByTestId("page-builder-version-revert-2")).not.toBeDisabled();
  });
});
