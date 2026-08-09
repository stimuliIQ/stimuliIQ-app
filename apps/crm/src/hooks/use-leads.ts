// Leads hooks — CRUD + kanban stage move + owner assignment + convert.
// Mirrors use-batches.ts/use-orders.ts conventions (CLAUDE.md §3: "no
// business logic in components"). Phase 2 Wave 5b (docs/plans/phase-2.md
// task #8).
//
// KANBAN DATA APPROACH: the pipeline board needs "all leads in scope grouped
// by stage", not a single page of one stage. We fetch ONE page per render
// with a generous `pageSize` cap (see PIPELINE_PAGE_SIZE in
// components/leads/pipeline-board.tsx) using the *same* `useLeadsList` query
// hook the table view uses — the kanban and table share one cache entry, so
// switching views or moving a card never refetches twice. If a tenant has
// more in-scope leads than the cap, the board's filter bar (stage/owner/
// source/search) is the documented way to narrow the view — there is no
// infinite-scroll/virtualized kanban in P2 (out of gate; tracked as a
// follow-up if a tenant's per-stage volume grows past the cap).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignLeadOwnerRequest,
  ConvertLeadRequest,
  CreateLeadRequest,
  LeadDetail,
  ListLeadsQuery,
  MoveLeadStageRequest,
  UpdateLeadRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LEADS_QUERY_KEY = ["leads", "leads"] as const;

export function leadsListKey(query: ListLeadsQuery) {
  return [...LEADS_QUERY_KEY, "list", query] as const;
}

export function leadDetailKey(id: string) {
  return [...LEADS_QUERY_KEY, "detail", id] as const;
}

export function useLeadsList(query: ListLeadsQuery) {
  return useQuery({
    queryKey: leadsListKey(query),
    queryFn: () => apiClient.crm.leads.list(query),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * The staff a lead can be assigned to (owner pickers, bulk assign, filters).
 *
 * Cached for 5 minutes and kept OUT of `LEADS_QUERY_KEY` on purpose: it changes only
 * when staff are hired or deactivated, so invalidating it on every lead mutation would
 * refetch the whole team list each time somebody logs a call. `openLeadCount` does drift
 * within that window — it is a "who's busy" hint on the picker, not a number anyone acts
 * on precisely, and the performance report is the place to read real workload.
 */
export const ASSIGNABLE_USERS_QUERY_KEY = ["leads", "assignable-users"] as const;

export function useAssignableUsers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ASSIGNABLE_USERS_QUERY_KEY,
    queryFn: () => apiClient.crm.leads.listAssignableUsers(),
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: leadDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.leads.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateLeads() {
  const queryClient = useQueryClient();
  return (leadId?: string) => {
    void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    if (leadId) {
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) });
    }
  };
}

export function useCreateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (body: CreateLeadRequest) => apiClient.crm.leads.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLeadRequest }) =>
      apiClient.crm.leads.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.leads.remove(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

/**
 * Kanban stage move. Optimistic: patches the cached list entries' `stage`
 * immediately so the card animates to the new column without waiting on the
 * round-trip, then invalidates on settle (success or error) to reconcile
 * with the server's authoritative state — including the rare case the
 * backend rejects the transition (e.g. won→ already-converted), in which
 * case the invalidation snaps the card back to its real column.
 */
export function useMoveLeadStage() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLeads();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveLeadStageRequest }) =>
      apiClient.crm.leads.moveStage(id, body),
    onMutate: async ({ id, body }) => {
      // Scope the optimistic patch to LIST caches only. `LEADS_QUERY_KEY`
      // also matches `detail` entries (`useLead` → a `LeadDetail` with no
      // `items`), so patching by the bare key would run this updater against
      // a detail object and blow up on `data.items.map` (undefined) whenever
      // a lead drawer had been opened. The `[..., "list"]` prefix + the
      // Array.isArray guard keep the patch to the shapes that actually have
      // `items`.
      const listKey = [...LEADS_QUERY_KEY, "list"] as const;
      const previous = queryClient.getQueriesData<{ items: Array<{ id: string; stage: string }> }>({
        queryKey: listKey,
      });
      queryClient.setQueriesData<{ items: Array<{ id: string; stage: string }> } | undefined>(
        { queryKey: listKey },
        (data) => {
          if (!data || !Array.isArray(data.items)) return data;
          return {
            ...data,
            items: data.items.map((item) => (item.id === id ? { ...item, stage: body.stage } : item)),
          };
        },
      );
      // Also patch the DETAIL cache: the lead drawer's stage select is bound to
      // it, and its same-stage guard compares against it. Leaving it to the
      // settle-time invalidate means the dropdown shows the old stage for a
      // round-trip — long enough for a retry that the server then rejects
      // ("cannot move won → won").
      const detailKey = leadDetailKey(id);
      const previousDetail = queryClient.getQueryData<LeadDetail>(detailKey);
      if (previousDetail) {
        queryClient.setQueryData<LeadDetail>(detailKey, { ...previousDetail, stage: body.stage });
      }
      return { previous, previousDetail, detailKey };
    },
    onError: (_error, _variables, context) => {
      // Roll back the optimistic patches — the settle-time invalidate below
      // will then re-fetch the authoritative state anyway.
      context?.previous.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
      if (context?.previousDetail) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
    },
    onSuccess: (data, variables) => {
      // The endpoint returns the updated LeadDetail — make it authoritative
      // immediately instead of waiting on the invalidate refetch.
      queryClient.setQueryData(leadDetailKey(variables.id), data);
    },
    onSettled: (_data, _error, variables) => invalidate(variables.id),
  });
}

export function useAssignLeadOwner() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignLeadOwnerRequest }) =>
      apiClient.crm.leads.assignOwner(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useConvertLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConvertLeadRequest }) =>
      apiClient.crm.leads.convert(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
