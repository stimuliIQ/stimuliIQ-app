// Course-type data hooks (docs/specs/course-types.md, ADR-0068). CLAUDE.md §3: no business
// logic in components — every screen that shows a course type reads it from here.
//
// `useCourseTypeOptions()` is the one every PICKER uses: active options only, in the staff-
// chosen order, plus a `labelFor(key)` that resolves what an existing student is recorded
// as. A student may hold a key that has since been hidden or deleted (history is kept as it
// was recorded), so `labelFor` falls back to the raw key rather than rendering a blank.
//
// The list changes about as often as the company changes what it teaches, so it is cached
// for the session and refetched only when the management screen writes to it.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseTypeOption, CreateCourseTypeRequest, UpdateCourseTypeRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const COURSE_TYPES_QUERY_KEY = ["course-types"] as const;

/** Every option including hidden ones — the management screen's list. */
export function useCourseTypesList() {
  return useQuery({
    queryKey: [...COURSE_TYPES_QUERY_KEY, "list", "all"] as const,
    queryFn: () => apiClient.crm.courseTypes.list({ page: 1, pageSize: 100, activeOnly: false }),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * The picker's view: only options staff currently offer, plus a resolver for the value an
 * existing record already holds.
 */
export function useCourseTypeOptions() {
  const query = useQuery({
    queryKey: [...COURSE_TYPES_QUERY_KEY, "list", "active"] as const,
    queryFn: () => apiClient.crm.courseTypes.list({ page: 1, pageSize: 100, activeOnly: true }),
    staleTime: 5 * 60_000,
  });

  const options = useMemo<{ value: string; label: string }[]>(
    () => (query.data?.items ?? []).map((option) => ({ value: option.key, label: option.label })),
    [query.data],
  );

  const labelFor = useMemo(() => {
    const byKey = new Map(options.map((option) => [option.value, option.label]));
    return (key: string | null | undefined): string | null => {
      if (!key) return null;
      return byKey.get(key) ?? key;
    };
  }, [options]);

  return { options, labelFor, isLoading: query.isLoading, isError: query.isError };
}

function useInvalidateCourseTypes() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: COURSE_TYPES_QUERY_KEY });
}

export function useCreateCourseType() {
  const invalidate = useInvalidateCourseTypes();
  return useMutation({
    mutationFn: (body: CreateCourseTypeRequest) => apiClient.crm.courseTypes.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCourseType() {
  const invalidate = useInvalidateCourseTypes();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCourseTypeRequest }) =>
      apiClient.crm.courseTypes.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCourseType() {
  const invalidate = useInvalidateCourseTypes();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.courseTypes.remove(id),
    onSuccess: invalidate,
  });
}

export type { CourseTypeOption };
