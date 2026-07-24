// EMI plans + dunning data hooks (Finance/Admin) — Phase 9 Completion T24/T39.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateEmiPlanRequest, ListEmiPlansQuery, MarkEmiInstallmentPaidRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const EMI_PLANS_QUERY_KEY = ["emi-plans"] as const;

export function emiPlansListKey(query: ListEmiPlansQuery) {
  return [...EMI_PLANS_QUERY_KEY, "list", query] as const;
}

export function emiPlanDetailKey(id: string) {
  return [...EMI_PLANS_QUERY_KEY, "detail", id] as const;
}

export function useEmiPlansList(query: ListEmiPlansQuery) {
  return useQuery({
    queryKey: emiPlansListKey(query),
    queryFn: () => apiClient.crm.emiPlans.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useEmiPlan(id: string | undefined) {
  return useQuery({
    queryKey: emiPlanDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.emiPlans.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateEmiPlans() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: EMI_PLANS_QUERY_KEY });
    if (id) void queryClient.invalidateQueries({ queryKey: emiPlanDetailKey(id) });
  };
}

export function useCreateEmiPlan() {
  const invalidate = useInvalidateEmiPlans();
  return useMutation({
    mutationFn: (body: CreateEmiPlanRequest) => apiClient.crm.emiPlans.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useMarkEmiInstallmentPaid() {
  const invalidate = useInvalidateEmiPlans();
  return useMutation({
    mutationFn: ({
      id,
      installmentId,
      body,
    }: {
      id: string;
      installmentId: string;
      body?: MarkEmiInstallmentPaidRequest;
    }) => apiClient.crm.emiPlans.markInstallmentPaid(id, installmentId, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useTriggerEmiDunning() {
  const invalidate = useInvalidateEmiPlans();
  return useMutation({
    mutationFn: ({ id, installmentId }: { id: string; installmentId: string }) =>
      apiClient.crm.emiPlans.triggerDunning(id, installmentId),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
