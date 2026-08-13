// Bulk actions + saved (filter) views data hooks — Phase 9 Completion T30
// follow-up/T40. `client.crm.bulk.*` mutations reuse the same already-scope-
// checked single-row services the equivalent single-item endpoint uses
// (IDOR-safe by construction — see @repo/types file header). `client.crm.
// savedViews.*` is own-scope, no dedicated permission key.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BulkAssignLeadsRequest,
  BulkMoveLeadsStageRequest,
  BulkUpdateStudentsStatusRequest,
  CreateSavedViewRequest,
  ListSavedViewsQuery,
} from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ASSIGNABLE_USERS_QUERY_KEY, LEADS_QUERY_KEY } from "./use-leads";
import { STUDENTS_QUERY_KEY } from "./use-students";

// ── Bulk actions ─────────────────────────────────────────────────────────

export function useBulkAssignLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkAssignLeadsRequest) => apiClient.crm.bulk.assignLeads(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      // The picker's "N open" counts are cached 5 minutes (use-leads.ts) — stale right
      // when a manager is mid load-balancing, so a bulk handover invalidates it too.
      void queryClient.invalidateQueries({ queryKey: ASSIGNABLE_USERS_QUERY_KEY });
    },
  });
}

export function useBulkMoveLeadsStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkMoveLeadsStageRequest) => apiClient.crm.bulk.moveLeadsStage(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY }),
  });
}

export function useBulkUpdateStudentsStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkUpdateStudentsStatusRequest) => apiClient.crm.bulk.updateStudentsStatus(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: STUDENTS_QUERY_KEY }),
  });
}

// ── Saved views ──────────────────────────────────────────────────────────

export const SAVED_VIEWS_QUERY_KEY = ["saved-views"] as const;

export function useSavedViewsList(query: Partial<ListSavedViewsQuery> = {}) {
  return useQuery({
    queryKey: [...SAVED_VIEWS_QUERY_KEY, query] as const,
    queryFn: () => apiClient.crm.savedViews.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateSavedViews() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: SAVED_VIEWS_QUERY_KEY });
}

export function useCreateSavedView() {
  const invalidate = useInvalidateSavedViews();
  return useMutation({
    mutationFn: (body: CreateSavedViewRequest) => apiClient.crm.savedViews.create(body),
    onSuccess: invalidate,
  });
}

export function useDeleteSavedView() {
  const invalidate = useInvalidateSavedViews();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.savedViews.remove(id),
    onSuccess: invalidate,
  });
}
