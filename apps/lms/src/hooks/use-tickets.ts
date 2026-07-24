// LMS support tickets hook (own-scope) — Phase 9 Completion, T7/T21/T36
// (docs/plans/phase-9-completion.md). Backs the /support ticket list + create +
// detail/reply/rate pages. Own-scope: IDOR->404 on another user's ticket, and
// isInternal staff notes are filtered server-side before reaching this client.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type {
  TicketSummary,
  TicketDetail,
  ListMyTicketsQuery,
  CreateTicketRequest,
  AddTicketMessageRequest,
  RateTicketRequest,
  OffsetPaginationMeta,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const TICKETS_QUERY_KEY = ["lms", "tickets"] as const;

export function ticketsListKey(query: ListMyTicketsQuery) {
  return [...TICKETS_QUERY_KEY, "list", query] as const;
}

export function ticketDetailKey(id: string) {
  return [...TICKETS_QUERY_KEY, "detail", id] as const;
}

// ---------------------------------------------------------------------------
// useMyTickets — list
// ---------------------------------------------------------------------------

export interface UseMyTicketsResult {
  tickets: TicketSummary[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  create: (body: CreateTicketRequest) => Promise<TicketDetail>;
  isCreating: boolean;
  createError: ApiError | null;
  refetch: () => void;
}

export function useMyTickets(query: ListMyTicketsQuery = { page: 1, pageSize: 20 }): UseMyTicketsResult {
  const queryClient = useQueryClient();

  const listQuery = useQuery<{ items: TicketSummary[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: ticketsListKey(query),
    queryFn: () => apiClient.lms.tickets.list(query),
    staleTime: 15_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const createMutation = useMutation<TicketDetail, ApiError, CreateTicketRequest>({
    mutationFn: (body) => apiClient.lms.tickets.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY });
    },
  });

  const isSignedOut = listQuery.error instanceof ApiError && listQuery.error.isUnauthenticated;

  return {
    tickets: listQuery.data?.items ?? [],
    isLoading: listQuery.isLoading,
    isSignedOut,
    isError: listQuery.isError && !isSignedOut,
    error: listQuery.error ?? null,
    create: (body) => createMutation.mutateAsync(body),
    isCreating: createMutation.isPending,
    createError: createMutation.error ?? null,
    refetch: () => void listQuery.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useTicketDetail — one ticket + reply + rate
// ---------------------------------------------------------------------------

export interface UseTicketDetailResult {
  ticket: TicketDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  /** 403/404 — not this student's ticket. */
  isForbidden: boolean;
  isError: boolean;
  error: ApiError | null;
  addMessage: (body: AddTicketMessageRequest) => Promise<TicketDetail>;
  isSending: boolean;
  rate: (body: RateTicketRequest) => Promise<TicketDetail>;
  isRating: boolean;
  refetch: () => void;
}

export function useTicketDetail(id: string | undefined): UseTicketDetailResult {
  const queryClient = useQueryClient();

  const query = useQuery<TicketDetail, ApiError>({
    queryKey: ticketDetailKey(id ?? ""),
    queryFn: () => apiClient.lms.tickets.get(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.isUnauthenticated || error.status === 403 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const addMessageMutation = useMutation<TicketDetail, ApiError, AddTicketMessageRequest>({
    mutationFn: (body) => apiClient.lms.tickets.addMessage(id as string, body),
    onSuccess: (updated) => {
      if (id) queryClient.setQueryData(ticketDetailKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY });
    },
  });

  const rateMutation = useMutation<TicketDetail, ApiError, RateTicketRequest>({
    mutationFn: (body) => apiClient.lms.tickets.rate(id as string, body),
    onSuccess: (updated) => {
      if (id) queryClient.setQueryData(ticketDetailKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY });
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;
  const isForbidden =
    query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  return {
    ticket: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isForbidden,
    isError: query.isError && !isSignedOut && !isForbidden,
    error: query.error ?? null,
    addMessage: (body) => addMessageMutation.mutateAsync(body),
    isSending: addMessageMutation.isPending,
    rate: (body) => rateMutation.mutateAsync(body),
    isRating: rateMutation.isPending,
    refetch: () => void query.refetch(),
  };
}
