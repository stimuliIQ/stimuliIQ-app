// System Health data hook (super admin only, `system.health.view`). CLAUDE.md §3: no business
// logic in components. The API caches a snapshot for ~10 s and fans out to Postgres, Redis and
// three HTTP checks, so polling faster than that only re-reads the cache.
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../lib/api-client";

export const SYSTEM_HEALTH_QUERY_KEY = ["system-health"] as const;

/** How often the open page re-checks. Paused while the tab is hidden. */
export const SYSTEM_HEALTH_POLL_MS = 30_000;

export function useSystemHealth() {
  return useQuery({
    queryKey: SYSTEM_HEALTH_QUERY_KEY,
    queryFn: () => apiClient.crm.systemHealth.get(),
    refetchInterval: SYSTEM_HEALTH_POLL_MS,
    refetchIntervalInBackground: false,
    // A permission error will not fix itself on retry, and a down API is the very thing this
    // screen exists to report, so fail fast and show it.
    retry: false,
  });
}
