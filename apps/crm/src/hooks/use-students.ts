// Students data hooks — all TanStack Query usage + the api-client calls for
// the Students module live here, never in components (CLAUDE.md §3: "no
// business logic in components"). Query keys are structured so the filter
// state is part of the cache key (`["students", "list", query]`) — every
// distinct filter/page/sort combination caches independently and refetches
// automatically when any of them changes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type {
  CreateStudentRequest,
  ListStudentsQuery,
  StudentDetail,
  UpdateStudentRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const STUDENTS_QUERY_KEY = ["students"] as const;

export function studentsListKey(query: ListStudentsQuery) {
  return [...STUDENTS_QUERY_KEY, "list", query] as const;
}

export function studentDetailKey(id: string) {
  return [...STUDENTS_QUERY_KEY, "detail", id] as const;
}

export function useStudentsList(query: ListStudentsQuery) {
  return useQuery({
    queryKey: studentsListKey(query),
    queryFn: () => apiClient.crm.students.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useStudent(id: string | undefined) {
  return useQuery({
    queryKey: studentDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.students.get(id as string),
    enabled: Boolean(id),
    // 4xx means "this record isn't visible to you" (404 gone/out-of-scope, 403
    // RBAC) — retrying can't change that and just spams the console; keep the
    // backoff retries for transient network/5xx failures only.
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status >= 400 && error.status < 500 ? false : failureCount < 2,
  });
}

function useInvalidateStudents() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: STUDENTS_QUERY_KEY });
  };
}

export function useCreateStudent() {
  const invalidate = useInvalidateStudents();
  return useMutation({
    mutationFn: (body: CreateStudentRequest) => apiClient.crm.students.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateStudent() {
  const invalidate = useInvalidateStudents();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStudentRequest }) =>
      apiClient.crm.students.update(id, body),
    onSuccess: (data: StudentDetail) => {
      invalidate();
      void data;
    },
  });
}

export function useDeleteStudent() {
  const invalidate = useInvalidateStudents();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.students.remove(id),
    onSuccess: invalidate,
  });
}

export function useRestoreStudent() {
  const invalidate = useInvalidateStudents();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.students.restore(id),
    onSuccess: invalidate,
  });
}

/** Rotates the student's LMS password + re-sends the welcome email (lost/bounced credentials). */
export function useResendCredentials() {
  const invalidate = useInvalidateStudents();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.students.resendCredentials(id),
    onSuccess: invalidate,
  });
}
