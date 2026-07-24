// Landing pages data hooks (admin) — Phase 9 Completion T33/T40.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLandingPageRequest, ListLandingPagesQuery, UpdateLandingPageRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LANDING_PAGES_QUERY_KEY = ["landing-pages"] as const;

export function landingPagesListKey(query: ListLandingPagesQuery) {
  return [...LANDING_PAGES_QUERY_KEY, "list", query] as const;
}

export function useLandingPagesList(query: ListLandingPagesQuery) {
  return useQuery({
    queryKey: landingPagesListKey(query),
    queryFn: () => apiClient.crm.landingPages.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateLandingPages() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: LANDING_PAGES_QUERY_KEY });
}

export function useCreateLandingPage() {
  const invalidate = useInvalidateLandingPages();
  return useMutation({
    mutationFn: (body: CreateLandingPageRequest) => apiClient.crm.landingPages.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateLandingPage() {
  const invalidate = useInvalidateLandingPages();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLandingPageRequest }) =>
      apiClient.crm.landingPages.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteLandingPage() {
  const invalidate = useInvalidateLandingPages();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.landingPages.remove(id),
    onSuccess: invalidate,
  });
}
