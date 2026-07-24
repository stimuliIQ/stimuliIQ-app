// Mentor data hooks (WS-1, docs/specs/phase-8-mentor.md) — mirrors
// use-faculty.ts; all TanStack Query usage + api-client calls for the
// Mentors module live here (CLAUDE.md §3: "no business logic in
// components"). Batch-assignment (WS-2) and completion-rollup/mark-complete
// (WS-3) hooks live in use-batch-mentors.ts/use-batch-completion.ts since
// those calls hang off a batch id, not a mentor id (mirrors batches.api.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateMentorRequest, ListMentorsQuery, UpdateMentorRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const MENTORS_QUERY_KEY = ["mentors"] as const;

export function mentorsListKey(query: ListMentorsQuery) {
  return [...MENTORS_QUERY_KEY, "list", query] as const;
}

export function mentorDetailKey(id: string) {
  return [...MENTORS_QUERY_KEY, "detail", id] as const;
}

export function useMentorsList(query: ListMentorsQuery) {
  return useQuery({
    queryKey: mentorsListKey(query),
    queryFn: () => apiClient.crm.mentors.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useMentor(id: string | undefined) {
  return useQuery({
    queryKey: mentorDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.mentors.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateMentors() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: MENTORS_QUERY_KEY });
  };
}

export function useCreateMentor() {
  const invalidate = useInvalidateMentors();
  return useMutation({
    mutationFn: (body: CreateMentorRequest) => apiClient.crm.mentors.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateMentor() {
  const invalidate = useInvalidateMentors();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMentorRequest }) =>
      apiClient.crm.mentors.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteMentor() {
  const invalidate = useInvalidateMentors();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.mentors.remove(id),
    onSuccess: invalidate,
  });
}

export function useRestoreMentor() {
  const invalidate = useInvalidateMentors();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.mentors.restore(id),
    onSuccess: invalidate,
  });
}
