// Support-desk data hooks (CRM/staff surface) — tickets, canned responses,
// KB articles. Phase 9 Completion T21/T38. Mirrors use-batches.ts conventions
// (CLAUDE.md §3: no business logic in components).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddTicketMessageRequest,
  CreateCannedResponseRequest,
  CreateKbArticleRequest,
  ListCannedResponsesQuery,
  ListKbArticlesQuery,
  ListTicketsQuery,
  UpdateCannedResponseRequest,
  UpdateKbArticleRequest,
  UpdateTicketRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Tickets ─────────────────────────────────────────────────────────────

export const TICKETS_QUERY_KEY = ["tickets"] as const;

export function ticketsListKey(query: ListTicketsQuery) {
  return [...TICKETS_QUERY_KEY, "list", query] as const;
}

export function ticketDetailKey(id: string) {
  return [...TICKETS_QUERY_KEY, "detail", id] as const;
}

export function useTicketsList(query: ListTicketsQuery, enabled = true) {
  return useQuery({
    queryKey: ticketsListKey(query),
    queryFn: () => apiClient.crm.tickets.list(query),
    placeholderData: (previousData) => previousData,
    /** False when the caller already knows the user lacks `tickets.view` — see usePaymentsList. */
    enabled,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ticketDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.tickets.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateTickets() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY });
    if (id) void queryClient.invalidateQueries({ queryKey: ticketDetailKey(id) });
  };
}

export function useUpdateTicket() {
  const invalidate = useInvalidateTickets();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTicketRequest }) =>
      apiClient.crm.tickets.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useAddTicketMessage() {
  const invalidate = useInvalidateTickets();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AddTicketMessageRequest }) =>
      apiClient.crm.tickets.addMessage(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

// ── Canned responses ────────────────────────────────────────────────────

export const CANNED_RESPONSES_QUERY_KEY = ["canned-responses"] as const;

export function cannedResponsesListKey(query: ListCannedResponsesQuery) {
  return [...CANNED_RESPONSES_QUERY_KEY, "list", query] as const;
}

export function useCannedResponsesList(query: ListCannedResponsesQuery) {
  return useQuery({
    queryKey: cannedResponsesListKey(query),
    queryFn: () => apiClient.crm.cannedResponses.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateCannedResponses() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: CANNED_RESPONSES_QUERY_KEY });
}

export function useCreateCannedResponse() {
  const invalidate = useInvalidateCannedResponses();
  return useMutation({
    mutationFn: (body: CreateCannedResponseRequest) => apiClient.crm.cannedResponses.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCannedResponse() {
  const invalidate = useInvalidateCannedResponses();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCannedResponseRequest }) =>
      apiClient.crm.cannedResponses.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCannedResponse() {
  const invalidate = useInvalidateCannedResponses();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.cannedResponses.remove(id),
    onSuccess: invalidate,
  });
}

// ── Knowledge-base articles ─────────────────────────────────────────────

export const KB_ARTICLES_QUERY_KEY = ["kb-articles"] as const;

export function kbArticlesListKey(query: ListKbArticlesQuery) {
  return [...KB_ARTICLES_QUERY_KEY, "list", query] as const;
}

export function useKbArticlesList(query: ListKbArticlesQuery) {
  return useQuery({
    queryKey: kbArticlesListKey(query),
    queryFn: () => apiClient.crm.kbArticles.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateKbArticles() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: KB_ARTICLES_QUERY_KEY });
}

export function useCreateKbArticle() {
  const invalidate = useInvalidateKbArticles();
  return useMutation({
    mutationFn: (body: CreateKbArticleRequest) => apiClient.crm.kbArticles.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateKbArticle() {
  const invalidate = useInvalidateKbArticles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateKbArticleRequest }) =>
      apiClient.crm.kbArticles.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteKbArticle() {
  const invalidate = useInvalidateKbArticles();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.kbArticles.remove(id),
    onSuccess: invalidate,
  });
}
