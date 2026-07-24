// Mentor-facing dashboard hook (WS-4, docs/specs/phase-8-mentor.md). GET
// /api/v1/me/mentor/dashboard — scoped entirely server-side to the caller's
// own actively-assigned batches (LOCK-2/Rule M-1), re-checked live on every
// call (Rule M-4) — this hook takes no parameters and never caches a
// broader result set than the API returns. Exported query key is reused by
// use-batch-completion.ts's mark-complete mutation so a mentor's own
// dashboard refreshes after they (or CRM staff) mark one of their batches
// complete.
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";

import { apiClient } from "../lib/api-client";

export const MENTOR_DASHBOARD_QUERY_KEY = ["mentor-dashboard"] as const;

export function useMentorDashboard() {
  return useQuery({
    queryKey: MENTOR_DASHBOARD_QUERY_KEY,
    queryFn: () => apiClient.crm.mentorDashboard.get(),
    // A non-mentor (e.g. an admin whose wildcard grant includes
    // `mentor.dashboard.view` but who has no mentor profile) gets a 403 here
    // by design — a settled answer, not a transient failure. Don't retry 4xx
    // 3× and spam the console; still retry genuine 5xx/network blips.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 3,
    // Don't re-fire on every window refocus — a 403 (non-mentor) would otherwise
    // repeat on each tab switch, filling the network log with failing requests.
    // The dashboard stays fresh via the mark-complete mutation's invalidation.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
