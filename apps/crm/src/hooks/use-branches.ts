// Branches data hooks (docs/03 §7.16) — mirrors use-students.ts. Also the
// data source for branch pickers used by Batches/Faculty.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateBranchRequest, ListBranchesQuery, UpdateBranchRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const BRANCHES_QUERY_KEY = ["branches"] as const;

export function branchesListKey(query: ListBranchesQuery) {
  return [...BRANCHES_QUERY_KEY, "list", query] as const;
}

export function useBranchesList(query: ListBranchesQuery) {
  return useQuery({
    queryKey: branchesListKey(query),
    queryFn: () => apiClient.crm.admin.branches.list(query),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Convenience hook for pickers that just need "all active branches" without
 * pagination UI. `enabled` gates the fetch so callers that only have access to
 * branches behind `branches.view` (e.g. the global branch-scope provider) don't
 * fire a request that would 403 for roles lacking that permission.
 */
export function useAllBranches(enabled = true) {
  return useQuery({
    queryKey: branchesListKey({ page: 1, pageSize: 200, status: "active" }),
    queryFn: () => apiClient.crm.admin.branches.list({ page: 1, pageSize: 200, status: "active" }),
    staleTime: 60_000,
    enabled,
  });
}

function useInvalidateBranches() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: BRANCHES_QUERY_KEY });
  };
}

export function useCreateBranch() {
  const invalidate = useInvalidateBranches();
  return useMutation({
    mutationFn: (body: CreateBranchRequest) => apiClient.crm.admin.branches.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateBranch() {
  const invalidate = useInvalidateBranches();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBranchRequest }) =>
      apiClient.crm.admin.branches.update(id, body),
    onSuccess: invalidate,
  });
}
