// Lesson resource (PDF / slides / dataset) hooks — staff authoring surface.
// A lesson has MANY resources, so these are list/add/remove rather than replace.
// CLAUDE.md §3: all api-client calls for this feature live here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLessonResourceRequest, LessonResourceUploadUrlRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LESSON_RESOURCES_QUERY_KEY = ["lesson-resources"] as const;

export function lessonResourcesKey(lessonId: string) {
  return [...LESSON_RESOURCES_QUERY_KEY, lessonId] as const;
}

export function useLessonResources(lessonId: string | undefined | null) {
  return useQuery({
    queryKey: lessonResourcesKey(lessonId ?? ""),
    queryFn: () => apiClient.crm.courses.listLessonResources(lessonId as string),
    enabled: Boolean(lessonId),
  });
}

/**
 * Mints the signed PUT URL. Not cached (`useMutation`): the URL is a short-TTL
 * credential and must be minted per upload.
 */
export function useResourceUploadUrl() {
  return useMutation({
    mutationFn: ({ lessonId, body }: { lessonId: string; body: LessonResourceUploadUrlRequest }) =>
      apiClient.crm.courses.resourceUploadUrl(lessonId, body),
  });
}

export function useCreateLessonResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, body }: { lessonId: string; body: CreateLessonResourceRequest }) =>
      apiClient.crm.courses.createLessonResource(lessonId, body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: lessonResourcesKey(vars.lessonId) });
    },
  });
}

export function useDeleteLessonResource() {
  const queryClient = useQueryClient();
  return useMutation({
    // lessonId is carried only so the right list can be invalidated on success.
    mutationFn: ({ resourceId }: { resourceId: string; lessonId: string }) =>
      apiClient.crm.courses.deleteLessonResource(resourceId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: lessonResourcesKey(vars.lessonId) });
    },
  });
}
