// Courses/curriculum data hooks — programs CRUD + publish/unpublish +
// modules/lessons CRUD + reorder, all TanStack Query usage centralized here
// (CLAUDE.md §3: "no business logic in components").
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLessonRequest,
  CreateModuleRequest,
  CreateProgramRequest,
  ListProgramsQuery,
  ReorderLessonsRequest,
  ReorderModulesRequest,
  UpdateLessonRequest,
  UpdateModuleRequest,
  UpdateProgramRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const PROGRAMS_QUERY_KEY = ["programs"] as const;

export function programsListKey(query: ListProgramsQuery) {
  return [...PROGRAMS_QUERY_KEY, "list", query] as const;
}

export function programDetailKey(id: string) {
  return [...PROGRAMS_QUERY_KEY, "detail", id] as const;
}

export function curriculumKey(programId: string) {
  return [...PROGRAMS_QUERY_KEY, "curriculum", programId] as const;
}

export function useProgramsList(query: ListProgramsQuery) {
  return useQuery({
    queryKey: programsListKey(query),
    queryFn: () => apiClient.crm.courses.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useProgram(id: string | undefined) {
  return useQuery({
    queryKey: programDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.courses.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCurriculum(programId: string | undefined) {
  return useQuery({
    queryKey: curriculumKey(programId ?? ""),
    queryFn: () => apiClient.crm.courses.getCurriculum(programId as string),
    enabled: Boolean(programId),
  });
}

function useInvalidatePrograms() {
  const queryClient = useQueryClient();
  return (programId?: string) => {
    void queryClient.invalidateQueries({ queryKey: PROGRAMS_QUERY_KEY });
    if (programId) {
      void queryClient.invalidateQueries({ queryKey: curriculumKey(programId) });
      void queryClient.invalidateQueries({ queryKey: programDetailKey(programId) });
    }
  };
}

export function useCreateProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (body: CreateProgramRequest) => apiClient.crm.courses.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProgramRequest }) =>
      apiClient.crm.courses.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function usePublishProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.courses.publish(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useUnpublishProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.courses.unpublish(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useSetProgramVisibility() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      apiClient.crm.courses.setVisibility(id, { isPublic }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useCreateModule(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (body: CreateModuleRequest) => apiClient.crm.courses.createModule(programId, body),
    onSuccess: () => invalidate(programId),
  });
}

export function useUpdateModule(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ moduleId, body }: { moduleId: string; body: UpdateModuleRequest }) =>
      apiClient.crm.courses.updateModule(programId, moduleId, body),
    onSuccess: () => invalidate(programId),
  });
}

export function useReorderModules(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (body: ReorderModulesRequest) => apiClient.crm.courses.reorderModules(programId, body),
    onSuccess: () => invalidate(programId),
  });
}

export function useCreateLesson(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ moduleId, body }: { moduleId: string; body: CreateLessonRequest }) =>
      apiClient.crm.courses.createLesson(programId, moduleId, body),
    onSuccess: () => invalidate(programId),
  });
}

export function useUpdateLesson(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ moduleId, lessonId, body }: { moduleId: string; lessonId: string; body: UpdateLessonRequest }) =>
      apiClient.crm.courses.updateLesson(programId, moduleId, lessonId, body),
    onSuccess: () => invalidate(programId),
  });
}

export function useReorderLessons(programId: string) {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ moduleId, body }: { moduleId: string; body: ReorderLessonsRequest }) =>
      apiClient.crm.courses.reorderLessons(programId, moduleId, body),
    onSuccess: () => invalidate(programId),
  });
}
