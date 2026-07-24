// Global branch scope — one selection in the topbar that every branch-aware
// list/dashboard in the CRM follows (docs/03 §10). Batches, Faculty, Students,
// and the branch-filterable analytics dashboards all read `selectedBranchId`
// from here instead of holding their own local branch filter, so changing the
// branch anywhere (topbar or a page's own Branch select) moves the whole app.
//
// PRESENTATION ONLY: the NestJS `ScopeInterceptor` + `@RequirePermission`
// guard remain the real enforcement (CLAUDE.md §3.5). The switcher only appears
// for users who hold `branches.view`; for everyone else this is a no-op scope of
// "all branches" and the server still limits them to what they may see.
import * as React from "react";
import type { MeResponse } from "@repo/types";

import { useAllBranches } from "../hooks/use-branches";
import { hasPermission } from "../lib/permissions";

type BranchOption = NonNullable<ReturnType<typeof useAllBranches>["data"]>["items"][number];

const STORAGE_KEY = "crm.branchScope";

interface BranchScopeValue {
  /** Active branches for the switcher (empty when the user can't view branches). */
  branches: BranchOption[];
  /** Whether the current user may scope by branch (holds `branches.view`). */
  canFilterBranch: boolean;
  isLoading: boolean;
  /** Currently-selected branch id; `undefined` means "All branches". */
  selectedBranchId: string | undefined;
  setSelectedBranchId: (id: string | undefined) => void;
}

const BranchScopeContext = React.createContext<BranchScopeValue | null>(null);

function readStored(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function BranchScopeProvider({
  me,
  children,
}: {
  me: MeResponse | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const canFilterBranch = hasPermission(me?.permissions, "branches.view");
  const { data, isLoading } = useAllBranches(canFilterBranch);
  const branches = React.useMemo<BranchOption[]>(() => data?.items ?? [], [data]);

  const [selectedBranchId, setSelected] = React.useState<string | undefined>(readStored);

  const setSelectedBranchId = React.useCallback((id: string | undefined) => {
    setSelected(id);
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Clear a stored selection that no longer resolves to a branch the user can
  // scope to: either they lost `branches.view`, or the persisted id is stale
  // (branch deleted/renamed, different tenant in localStorage). Without this a
  // ghost id would silently filter every list to an empty result set.
  React.useEffect(() => {
    if (!canFilterBranch) {
      if (selectedBranchId !== undefined) setSelectedBranchId(undefined);
      return;
    }
    if (isLoading || selectedBranchId === undefined) return;
    if (!branches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(undefined);
    }
  }, [canFilterBranch, isLoading, branches, selectedBranchId, setSelectedBranchId]);

  const value = React.useMemo<BranchScopeValue>(
    () => ({ branches, canFilterBranch, isLoading, selectedBranchId, setSelectedBranchId }),
    [branches, canFilterBranch, isLoading, selectedBranchId, setSelectedBranchId],
  );

  return <BranchScopeContext.Provider value={value}>{children}</BranchScopeContext.Provider>;
}

export function useBranchScope(): BranchScopeValue {
  const ctx = React.useContext(BranchScopeContext);
  if (!ctx) {
    throw new Error("useBranchScope must be used within a <BranchScopeProvider>");
  }
  return ctx;
}
