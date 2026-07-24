// Refunds hooks — request/approve/reject approval workflow. Mirrors
// use-batches.ts conventions. Phase 2 Wave 5a (docs/plans/phase-2.md task #7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveRefundRequest,
  ListRefundsQuery,
  RejectRefundRequest,
  RequestRefundRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";
import { PAYMENTS_QUERY_KEY } from "./use-payments";

export const REFUNDS_QUERY_KEY = ["commerce", "refunds"] as const;

export function refundsListKey(query: ListRefundsQuery) {
  return [...REFUNDS_QUERY_KEY, "list", query] as const;
}

export function refundDetailKey(id: string) {
  return [...REFUNDS_QUERY_KEY, "detail", id] as const;
}

export function useRefundsList(query: ListRefundsQuery) {
  return useQuery({
    queryKey: refundsListKey(query),
    queryFn: () => apiClient.commerce.refunds.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useRefund(id: string | undefined) {
  return useQuery({
    queryKey: refundDetailKey(id ?? ""),
    queryFn: () => apiClient.commerce.refunds.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateRefunds() {
  const queryClient = useQueryClient();
  return (refundId?: string) => {
    void queryClient.invalidateQueries({ queryKey: REFUNDS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
    if (refundId) {
      void queryClient.invalidateQueries({ queryKey: refundDetailKey(refundId) });
    }
  };
}

export function useRequestRefund() {
  const invalidate = useInvalidateRefunds();
  return useMutation({
    mutationFn: (body: RequestRefundRequest) => apiClient.commerce.refunds.request(body),
    onSuccess: () => invalidate(),
  });
}

export function useApproveRefund() {
  const invalidate = useInvalidateRefunds();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: ApproveRefundRequest }) =>
      apiClient.commerce.refunds.approve(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useRejectRefund() {
  const invalidate = useInvalidateRefunds();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectRefundRequest }) =>
      apiClient.commerce.refunds.reject(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
