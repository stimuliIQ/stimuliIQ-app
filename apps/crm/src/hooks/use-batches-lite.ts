// Lightweight "all active batches" picker hook, mirrors use-branches.ts'
// `useAllBranches` — used by pickers (EMI plan order picker context, etc.)
// that just need a bounded list without pagination UI.
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../lib/api-client";
import { batchesListKey } from "./use-batches";

export function useAllBatches() {
  const query = { page: 1, pageSize: 200, status: "active" as const, includeDeleted: false };
  return useQuery({
    queryKey: batchesListKey(query),
    queryFn: () => apiClient.crm.batches.list(query),
    staleTime: 60_000,
  });
}
