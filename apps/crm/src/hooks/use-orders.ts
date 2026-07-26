// Orders ledger hooks — mirrors use-batches.ts; all TanStack Query usage +
// api-client calls for the Commerce/Orders module live here (CLAUDE.md §3:
// "no business logic in components"). Phase 2 Wave 5a (docs/plans/phase-2.md
// task #7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateOrderRequest, ListOrdersQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { STUDENTS_QUERY_KEY } from "./use-students";

export const ORDERS_QUERY_KEY = ["commerce", "orders"] as const;

export function ordersListKey(query: ListOrdersQuery) {
  return [...ORDERS_QUERY_KEY, "list", query] as const;
}

export function orderDetailKey(id: string) {
  return [...ORDERS_QUERY_KEY, "detail", id] as const;
}

export function useOrdersList(query: ListOrdersQuery) {
  return useQuery({
    queryKey: ordersListKey(query),
    queryFn: () => apiClient.commerce.orders.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderDetailKey(id ?? ""),
    queryFn: () => apiClient.commerce.orders.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Create an order for a student (program + batch, optional coupon) — the
 * "assign another program" action on the Student 360. Invalidates the student
 * queries too: a new open order moves the derived lifecycle stage to
 * payment_pending, so the chip/stepper must refetch.
 */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrderRequest) => apiClient.commerce.orders.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: STUDENTS_QUERY_KEY });
    },
  });
}

/**
 * Cancel an UNPAID order — un-assign a program opened by mistake. Invalidates
 * the student queries too: removing the open order moves the derived lifecycle
 * stage back, so the chip/stepper must refetch.
 */
export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => apiClient.commerce.orders.cancel(orderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: STUDENTS_QUERY_KEY });
    },
  });
}

/**
 * Mint a signed public payment link for an open order (lifecycle-redesign:
 * "send the student a link to pay"). No cache to invalidate — minting is
 * side-effect-free server-side (the link is derived, not stored).
 */
export function useCreatePaymentLink() {
  return useMutation({
    mutationFn: (orderId: string) => apiClient.commerce.orders.createPaymentLink(orderId),
  });
}
