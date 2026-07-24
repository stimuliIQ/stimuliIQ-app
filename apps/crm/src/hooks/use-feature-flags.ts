// Feature flags data hooks (admin) — Phase 9 Completion T23/T39.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListFeatureFlagsQuery, SetFeatureFlagRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const FEATURE_FLAGS_QUERY_KEY = ["feature-flags"] as const;

export function featureFlagsListKey(query: ListFeatureFlagsQuery) {
  return [...FEATURE_FLAGS_QUERY_KEY, "list", query] as const;
}

export function useFeatureFlagsList(query: ListFeatureFlagsQuery) {
  return useQuery({
    queryKey: featureFlagsListKey(query),
    queryFn: () => apiClient.crm.featureFlags.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useSetFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: SetFeatureFlagRequest }) =>
      apiClient.crm.featureFlags.set(key, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY }),
  });
}
