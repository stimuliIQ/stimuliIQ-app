// Monthly marketing targets — data hooks (ADR-0067, docs/specs/marketing-targets.md).
// No business logic in components (CLAUDE.md §3.3): everything goes through
// `client.crm.marketingTargets.*`, never a hand-written fetch.
//
// TWO HOOKS, TWO PERMISSIONS, AND THE `enabled` FLAG IS LOAD-BEARING:
//   `useMyMarketingTarget` is for the person measured (`marketing_targets.view`).
//   `useMarketingTargetsList` is the super-admin report (`marketing_targets.manage`).
// Both take an explicit `enabled` so the caller gates on the permission BEFORE the request
// leaves the browser. Firing a query the API will 403 turns a hidden feature into a console
// full of red for every admin who opens the dashboard.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarketingTargetsQuery, UpsertMarketingTargetRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const MARKETING_TARGETS_QUERY_KEY = ["marketing-targets"] as const;

/**
 * Both hooks are invalidated together. Setting somebody's target changes the admin table AND
 * that person's own card, and while one browser session only ever holds one of the two, the
 * super admin editing their own row (or previewing) would otherwise see a stale card.
 */
function useInvalidateMarketingTargets() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: MARKETING_TARGETS_QUERY_KEY });
}

/** The signed-in person's own target + progress. `enabled` should be `marketing_targets.view`. */
export function useMyMarketingTarget(query: MarketingTargetsQuery = {}, enabled = true) {
  return useQuery({
    queryKey: [...MARKETING_TARGETS_QUERY_KEY, "mine", query] as const,
    queryFn: () => apiClient.crm.marketingTargets.mine(query),
    enabled,
  });
}

/** The whole team for a month. `enabled` should be `marketing_targets.manage`. */
export function useMarketingTargetsList(query: MarketingTargetsQuery = {}, enabled = true) {
  return useQuery({
    queryKey: [...MARKETING_TARGETS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.marketingTargets.list(query),
    enabled,
  });
}

export function useUpsertMarketingTarget() {
  const invalidate = useInvalidateMarketingTargets();
  return useMutation({
    mutationFn: (body: UpsertMarketingTargetRequest) => apiClient.crm.marketingTargets.upsert(body),
    onSuccess: invalidate,
  });
}

export function useDeleteMarketingTarget() {
  const invalidate = useInvalidateMarketingTargets();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.marketingTargets.remove(id),
    onSuccess: invalidate,
  });
}
