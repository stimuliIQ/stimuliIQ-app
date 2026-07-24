// Payments ledger hooks (the reconciliation source — docs/03 §20) + manual
// payment entry. Mirrors use-batches.ts conventions. Phase 2 Wave 5a
// (docs/plans/phase-2.md task #7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListPaymentsQuery, ManualPaymentRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ORDERS_QUERY_KEY } from "./use-orders";
import { ENROLLMENTS_QUERY_KEY } from "./use-enrollments";
import { STUDENTS_QUERY_KEY } from "./use-students";

export const PAYMENTS_QUERY_KEY = ["commerce", "payments"] as const;

export function paymentsListKey(query: ListPaymentsQuery) {
  return [...PAYMENTS_QUERY_KEY, "list", query] as const;
}

export function paymentDetailKey(id: string) {
  return [...PAYMENTS_QUERY_KEY, "detail", id] as const;
}

export function reconciliationKey(params: { from: string; to: string }) {
  return [...PAYMENTS_QUERY_KEY, "reconciliation", params] as const;
}

export function usePaymentsList(query: ListPaymentsQuery) {
  return useQuery({
    queryKey: paymentsListKey(query),
    queryFn: () => apiClient.commerce.payments.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: paymentDetailKey(id ?? ""),
    queryFn: () => apiClient.commerce.payments.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Receipt PDF signed download URL (T27/T40) — fetched on-demand (not eagerly
 * with the detail), mirroring `useInvoiceDownload`'s pattern. `ready: false`
 * while the async BullMQ render job is still queued/running — the caller
 * polls by re-enabling/refetching.
 */
export function usePaymentReceipt(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...PAYMENTS_QUERY_KEY, "receipt", id ?? ""] as const,
    queryFn: () => apiClient.commerce.payments.getReceiptUrl(id as string),
    enabled: Boolean(id) && enabled,
    refetchInterval: (query) => (query.state.data && !query.state.data.ready ? 4000 : false),
  });
}

/** Ledger reconciliation summary for a date range (docs/03 §20 invariant). */
export function useLedgerReconciliation(params: { from: string; to: string } | undefined) {
  return useQuery({
    queryKey: reconciliationKey(params ?? { from: "", to: "" }),
    queryFn: () => apiClient.commerce.payments.reconciliation(params as { from: string; to: string }),
    enabled: Boolean(params?.from && params?.to),
  });
}

export function useRecordManualPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualPaymentRequest) => apiClient.commerce.payments.recordManual(body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: orderDetailKeyFromVariables(variables) });
      // A captured manual payment enrolls the student and moves their derived
      // lifecycle stage (payment_pending → active_student) — refresh the Student
      // 360 (chip/stepper/directory) and the enrollments it just created.
      void queryClient.invalidateQueries({ queryKey: STUDENTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ENROLLMENTS_QUERY_KEY });
    },
  });
}

function orderDetailKeyFromVariables(body: ManualPaymentRequest) {
  return [...ORDERS_QUERY_KEY, "detail", body.orderId] as const;
}
