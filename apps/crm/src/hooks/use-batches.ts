// Batches data hooks — mirrors use-students.ts/use-faculty.ts; all TanStack
// Query usage + api-client calls for the Batches module live here
// (CLAUDE.md §3: "no business logic in components").
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignBatchFacultyRequest,
  CreateBatchRequest,
  ListBatchesQuery,
  UpdateBatchRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const BATCHES_QUERY_KEY = ["batches"] as const;

export function batchesListKey(query: ListBatchesQuery) {
  return [...BATCHES_QUERY_KEY, "list", query] as const;
}

export function batchDetailKey(id: string) {
  return [...BATCHES_QUERY_KEY, "detail", id] as const;
}

export function batchRosterKey(id: string) {
  return [...BATCHES_QUERY_KEY, "roster", id] as const;
}

export function useBatchesList(query: ListBatchesQuery) {
  return useQuery({
    queryKey: batchesListKey(query),
    queryFn: () => apiClient.crm.batches.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useBatch(id: string | undefined) {
  return useQuery({
    queryKey: batchDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.batches.get(id as string),
    enabled: Boolean(id),
  });
}

export function useBatchRoster(id: string | undefined) {
  return useQuery({
    queryKey: batchRosterKey(id ?? ""),
    queryFn: () => apiClient.crm.batches.getRoster(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateBatches() {
  const queryClient = useQueryClient();
  return (batchId?: string) => {
    void queryClient.invalidateQueries({ queryKey: BATCHES_QUERY_KEY });
    if (batchId) {
      void queryClient.invalidateQueries({ queryKey: batchDetailKey(batchId) });
      void queryClient.invalidateQueries({ queryKey: batchRosterKey(batchId) });
    }
  };
}

export function useCreateBatch() {
  const invalidate = useInvalidateBatches();
  return useMutation({
    mutationFn: (body: CreateBatchRequest) => apiClient.crm.batches.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateBatch() {
  const invalidate = useInvalidateBatches();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBatchRequest }) =>
      apiClient.crm.batches.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteBatch() {
  const invalidate = useInvalidateBatches();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.batches.remove(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useRestoreBatch() {
  const invalidate = useInvalidateBatches();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.batches.restore(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useAssignBatchFaculty() {
  const invalidate = useInvalidateBatches();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignBatchFacultyRequest }) =>
      apiClient.crm.batches.assignFaculty(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
