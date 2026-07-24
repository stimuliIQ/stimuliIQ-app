// Unit tests for the global branch scope (app/branch-scope.tsx). The switcher
// drives a shared client filter, so the invariants that matter are: it only
// activates for users who hold `branches.view`, it persists across reloads, and
// it never leaves a ghost selection pointing at a branch the user can't resolve.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { MeResponse } from "@repo/types";

import { BranchScopeProvider, useBranchScope } from "./branch-scope";

// The provider's only data dependency is useAllBranches — mock it so the tests
// are hermetic (no QueryClient / network) and can drive branch availability.
const useAllBranchesMock = vi.fn();
vi.mock("../hooks/use-branches", () => ({
  useAllBranches: (...args: unknown[]) => useAllBranchesMock(...args),
}));

const HYDERABAD = { id: "br-hyd", name: "Hyderabad Campus", city: "Hyderabad" };
const BENGALURU = { id: "br-blr", name: "Bengaluru Campus", city: "Bengaluru" };

function branchesLoaded(items: Array<{ id: string; name: string; city: string }>) {
  useAllBranchesMock.mockReturnValue({ data: { items, meta: {} }, isLoading: false });
}

function meWith(permissionKeys: string[]): MeResponse {
  return {
    user: { id: "u-1", email: "staff@stimuliiq.test", name: "Staff", phone: null, avatar: null, status: "active", mustChangePassword: false },
    tenantId: "t-1",
    roles: ["admin"],
    permissions: permissionKeys.map((key) => ({ key, scope: "all" as const })),
  };
}

/** Renders the current scope + buttons to drive it, for assertion by testid. */
function Harness(): React.JSX.Element {
  const { branches, canFilterBranch, selectedBranchId, setSelectedBranchId } = useBranchScope();
  return (
    <div>
      <span data-testid="selected">{selectedBranchId ?? "ALL"}</span>
      <span data-testid="can-filter">{String(canFilterBranch)}</span>
      <span data-testid="branch-count">{branches.length}</span>
      <button data-testid="pick-hyd" onClick={() => setSelectedBranchId("br-hyd")}>
        Hyderabad
      </button>
      <button data-testid="pick-all" onClick={() => setSelectedBranchId(undefined)}>
        All
      </button>
    </div>
  );
}

function renderScope(me: MeResponse | undefined) {
  return render(
    <BranchScopeProvider me={me}>
      <Harness />
    </BranchScopeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useAllBranchesMock.mockReset();
  branchesLoaded([HYDERABAD, BENGALURU]);
});

describe("BranchScopeProvider", () => {
  it("defaults to 'All branches' (undefined) for an admin with no stored selection", () => {
    renderScope(meWith(["branches.view"]));
    expect(screen.getByTestId("selected")).toHaveTextContent("ALL");
    expect(screen.getByTestId("can-filter")).toHaveTextContent("true");
    expect(screen.getByTestId("branch-count")).toHaveTextContent("2");
  });

  it("persists a selection to localStorage and exposes it", () => {
    renderScope(meWith(["branches.view"]));
    act(() => {
      screen.getByTestId("pick-hyd").click();
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("br-hyd");
    expect(window.localStorage.getItem("crm.branchScope")).toBe("br-hyd");
  });

  it("clearing the selection removes the persisted key", () => {
    window.localStorage.setItem("crm.branchScope", "br-hyd");
    renderScope(meWith(["branches.view"]));
    expect(screen.getByTestId("selected")).toHaveTextContent("br-hyd");
    act(() => {
      screen.getByTestId("pick-all").click();
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("ALL");
    expect(window.localStorage.getItem("crm.branchScope")).toBeNull();
  });

  it("hydrates the initial selection from localStorage", () => {
    window.localStorage.setItem("crm.branchScope", "br-blr");
    renderScope(meWith(["branches.view"]));
    expect(screen.getByTestId("selected")).toHaveTextContent("br-blr");
  });

  it("drops a stored branch id that no longer exists once branches load", () => {
    window.localStorage.setItem("crm.branchScope", "br-ghost");
    renderScope(meWith(["branches.view"]));
    expect(screen.getByTestId("selected")).toHaveTextContent("ALL");
    expect(window.localStorage.getItem("crm.branchScope")).toBeNull();
  });

  it("does not activate (and clears any stored id) for a user without branches.view", () => {
    window.localStorage.setItem("crm.branchScope", "br-hyd");
    branchesLoaded([]); // query disabled → no items for this user
    renderScope(meWith(["students.view"]));
    expect(screen.getByTestId("can-filter")).toHaveTextContent("false");
    expect(screen.getByTestId("branch-count")).toHaveTextContent("0");
    expect(screen.getByTestId("selected")).toHaveTextContent("ALL");
    expect(window.localStorage.getItem("crm.branchScope")).toBeNull();
  });
});

describe("useBranchScope", () => {
  it("throws when used outside a BranchScopeProvider", () => {
    // Silence the expected React error boundary console output for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow(/must be used within a <BranchScopeProvider>/);
    spy.mockRestore();
  });
});
