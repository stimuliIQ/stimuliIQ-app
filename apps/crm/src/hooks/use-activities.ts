// Activities hooks — log + complete tasks. Mirrors use-leads.ts conventions.
// Phase 2 Wave 5b (docs/plans/phase-2.md task #8).
//
// Activities are LOGGED RECORDS in P2 — `whatsapp`/`email` types are NOT
// sent (no MailProvider/WhatsAppProvider is wired; delivery is P6). Every
// hook here only persists a record for the timeline/tasks views.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompleteTaskRequest, CreateActivityRequest, ListActivitiesQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { LEADS_QUERY_KEY } from "./use-leads";

export const ACTIVITIES_QUERY_KEY = ["leads", "activities"] as const;

export function activitiesListKey(query: ListActivitiesQuery) {
  return [...ACTIVITIES_QUERY_KEY, "list", query] as const;
}

export function useActivitiesList(query: ListActivitiesQuery) {
  return useQuery({
    queryKey: activitiesListKey(query),
    queryFn: () => apiClient.crm.activities.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateActivities() {
  const queryClient = useQueryClient();
  return (leadId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ACTIVITIES_QUERY_KEY });
    // activityCount/bookingCount live on the lead detail — refresh it too.
    if (leadId) {
      void queryClient.invalidateQueries({ queryKey: [...LEADS_QUERY_KEY, "detail", leadId] });
    } else {
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    }
  };
}

export function useCreateActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: (body: CreateActivityRequest) => apiClient.crm.activities.create(body),
    onSuccess: (_data, variables) => invalidate(variables.leadId),
  });
}

export function useCompleteTask() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    // `leadId` isn't sent to the API (the backend already knows the task's
    // lead) — it's accepted here purely so callers can tell us which lead
    // detail cache to invalidate after completion.
    mutationFn: ({ id, body }: { id: string; body?: CompleteTaskRequest; leadId?: string }) =>
      apiClient.crm.activities.completeTask(id, body),
    onSuccess: (_data, variables) => invalidate(variables.leadId),
  });
}
