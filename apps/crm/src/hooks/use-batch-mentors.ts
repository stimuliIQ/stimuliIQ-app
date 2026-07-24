// Batch-mentor assignment hooks (WS-2, docs/specs/phase-8-mentor.md) —
// list/assign/remove mentors on a batch. Lives separately from
// use-mentors.ts because these calls hang off `client.crm.batches.*` (a
// batch id path), not a mentor id — mirrors batches.api.ts's own comment.
// Every guard (active-mentor-only, no-duplicate, batch-status,
// mentors.assign RBAC) is enforced server-side; these hooks just carry the
// request/response and invalidate the right caches (CLAUDE.md §3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssignMentorToBatchRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { batchDetailKey } from "./use-batches";

export function batchMentorsKey(batchId: string) {
  return ["batches", "mentors", batchId] as const;
}

export function useBatchMentors(batchId: string | undefined) {
  return useQuery({
    queryKey: batchMentorsKey(batchId ?? ""),
    queryFn: () => apiClient.crm.batches.listMentors(batchId as string),
    enabled: Boolean(batchId),
  });
}

function invalidateBatchMentors(queryClient: ReturnType<typeof useQueryClient>, batchId: string) {
  void queryClient.invalidateQueries({ queryKey: batchMentorsKey(batchId) });
  void queryClient.invalidateQueries({ queryKey: batchDetailKey(batchId) });
}

export function useAssignMentorToBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, body }: { batchId: string; body: AssignMentorToBatchRequest }) =>
      apiClient.crm.batches.assignMentor(batchId, body),
    onSuccess: (_data, variables) => invalidateBatchMentors(queryClient, variables.batchId),
  });
}

export function useRemoveMentorFromBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, mentorId }: { batchId: string; mentorId: string }) =>
      apiClient.crm.batches.removeMentor(batchId, mentorId),
    onSuccess: (_data, variables) => invalidateBatchMentors(queryClient, variables.batchId),
  });
}
