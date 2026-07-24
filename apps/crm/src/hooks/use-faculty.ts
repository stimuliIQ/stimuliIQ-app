// Faculty data hooks — mirrors use-students.ts; all TanStack Query usage +
// api-client calls for the Faculty module live here (CLAUDE.md §3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateFacultyRequest, ListFacultyQuery, UpdateFacultyRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const FACULTY_QUERY_KEY = ["faculty"] as const;

export function facultyListKey(query: ListFacultyQuery) {
  return [...FACULTY_QUERY_KEY, "list", query] as const;
}

export function facultyDetailKey(id: string) {
  return [...FACULTY_QUERY_KEY, "detail", id] as const;
}

export function useFacultyList(query: ListFacultyQuery) {
  return useQuery({
    queryKey: facultyListKey(query),
    queryFn: () => apiClient.crm.faculty.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useFacultyMember(id: string | undefined) {
  return useQuery({
    queryKey: facultyDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.faculty.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateFaculty() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: FACULTY_QUERY_KEY });
  };
}

export function useCreateFaculty() {
  const invalidate = useInvalidateFaculty();
  return useMutation({
    mutationFn: (body: CreateFacultyRequest) => apiClient.crm.faculty.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateFaculty() {
  const invalidate = useInvalidateFaculty();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFacultyRequest }) =>
      apiClient.crm.faculty.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteFaculty() {
  const invalidate = useInvalidateFaculty();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.faculty.remove(id),
    onSuccess: invalidate,
  });
}

export function useRestoreFaculty() {
  const invalidate = useInvalidateFaculty();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.faculty.restore(id),
    onSuccess: invalidate,
  });
}

/** Rotates the faculty member's login password and re-sends a temp-password email (lost/bounced credentials). */
export function useResetFacultyPassword() {
  const invalidate = useInvalidateFaculty();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.faculty.resetPassword(id),
    onSuccess: invalidate,
  });
}
