// Batch completion rollup + mark-complete hooks (WS-3,
// docs/specs/phase-8-mentor.md). Reuses `client.crm.batches.*` — the
// rollup/mark-complete endpoints hang off a batch id (see batches.api.ts).
// LOCK-4: no parallel progress computation lives here — this is a pure read
// (+ pagination for the per-student breakdown) plus a single state-transition
// mutation. Used by both the CRM staff batch-detail Completion tab and the
// mentor-facing dashboard's mark-complete affordance (AC-53 — same endpoint,
// same permission, not a separate mentor-only mechanism).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListBatchCompletionStudentsQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { batchDetailKey } from "./use-batches";
import { MENTOR_DASHBOARD_QUERY_KEY } from "./use-mentor-dashboard";

export function batchCompletionKey(batchId: string) {
  return ["batches", "completion", batchId] as const;
}

export function batchCompletionStudentsKey(batchId: string, query: ListBatchCompletionStudentsQuery) {
  return ["batches", "completion", batchId, "students", query] as const;
}

export function useBatchCompletion(batchId: string | undefined) {
  return useQuery({
    queryKey: batchCompletionKey(batchId ?? ""),
    queryFn: () => apiClient.crm.batches.getCompletion(batchId as string),
    enabled: Boolean(batchId),
  });
}

export function useBatchCompletionStudents(
  batchId: string | undefined,
  query: ListBatchCompletionStudentsQuery,
) {
  return useQuery({
    queryKey: batchCompletionStudentsKey(batchId ?? "", query),
    queryFn: () => apiClient.crm.batches.listCompletionStudents(batchId as string, query),
    enabled: Boolean(batchId),
    placeholderData: (previousData) => previousData,
  });
}

export function useMarkBatchComplete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => apiClient.crm.batches.markComplete(batchId),
    onSuccess: (_data, batchId) => {
      void queryClient.invalidateQueries({ queryKey: batchCompletionKey(batchId) });
      void queryClient.invalidateQueries({ queryKey: batchDetailKey(batchId) });
      void queryClient.invalidateQueries({ queryKey: ["batches"] });
      void queryClient.invalidateQueries({ queryKey: MENTOR_DASHBOARD_QUERY_KEY });
    },
  });
}
