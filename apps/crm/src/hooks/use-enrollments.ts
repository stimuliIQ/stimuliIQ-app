// Enrollments data hooks — the batch-roster join (docs/03 §7.5). P1 scope
// only: enroll/move/withdraw, no commerce side (CLAUDE.md §3: "no business
// logic in components"). Mutations invalidate both the enrollments list and
// the affected batches' roster/detail caches (capacity counts live there).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEnrollmentRequest,
  ListEnrollmentsQuery,
  MoveEnrollmentRequest,
  WithdrawEnrollmentRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";
import { BATCHES_QUERY_KEY, batchDetailKey, batchRosterKey } from "./use-batches";

export const ENROLLMENTS_QUERY_KEY = ["enrollments"] as const;

export function enrollmentsListKey(query: ListEnrollmentsQuery) {
  return [...ENROLLMENTS_QUERY_KEY, "list", query] as const;
}

export function useEnrollmentsList(query: ListEnrollmentsQuery, enabled = true) {
  return useQuery({
    queryKey: enrollmentsListKey(query),
    queryFn: () => apiClient.crm.enrollments.list(query),
    enabled,
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateEnrollments() {
  const queryClient = useQueryClient();
  return (batchIds: Array<string | undefined>) => {
    void queryClient.invalidateQueries({ queryKey: ENROLLMENTS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: BATCHES_QUERY_KEY });
    for (const batchId of batchIds) {
      if (!batchId) continue;
      void queryClient.invalidateQueries({ queryKey: batchRosterKey(batchId) });
      void queryClient.invalidateQueries({ queryKey: batchDetailKey(batchId) });
    }
  };
}

export function useCreateEnrollment() {
  const invalidate = useInvalidateEnrollments();
  return useMutation({
    mutationFn: (body: CreateEnrollmentRequest) => apiClient.crm.enrollments.create(body),
    onSuccess: (_data, variables) => invalidate([variables.batchId]),
  });
}

export function useMoveEnrollment() {
  const invalidate = useInvalidateEnrollments();
  return useMutation({
    mutationFn: ({
      id,
      body,
      fromBatchId,
    }: {
      id: string;
      body: MoveEnrollmentRequest;
      /** Source batch id, so its roster cache is invalidated alongside the destination. */
      fromBatchId?: string;
    }) => apiClient.crm.enrollments.move(id, body),
    onSuccess: (_data, variables) => invalidate([variables.fromBatchId, variables.body.toBatchId]),
  });
}

export function useWithdrawEnrollment() {
  const invalidate = useInvalidateEnrollments();
  return useMutation({
    mutationFn: ({
      id,
      body,
      batchId,
    }: {
      id: string;
      body?: WithdrawEnrollmentRequest;
      batchId?: string;
    }) => apiClient.crm.enrollments.withdraw(id, body),
    onSuccess: (_data, variables) => invalidate([variables.batchId]),
  });
}
