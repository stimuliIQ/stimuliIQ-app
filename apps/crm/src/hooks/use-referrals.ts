// Referrals/affiliate data hooks (CRM/staff oversight) — Phase 9 Completion T25/T39.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListReferralsQuery, UpdateReferralStatusRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const REFERRALS_QUERY_KEY = ["referrals"] as const;

export function referralsListKey(query: ListReferralsQuery) {
  return [...REFERRALS_QUERY_KEY, "list", query] as const;
}

export function useReferralsList(query: ListReferralsQuery) {
  return useQuery({
    queryKey: referralsListKey(query),
    queryFn: () => apiClient.crm.referrals.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useUpdateReferralStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateReferralStatusRequest }) =>
      apiClient.crm.referrals.updateStatus(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: REFERRALS_QUERY_KEY }),
  });
}
