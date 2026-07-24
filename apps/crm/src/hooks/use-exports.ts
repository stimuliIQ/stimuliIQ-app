// Export jobs data hooks — Phase 7, Wave 3 (docs/plans/phase-7.md task #15).
// On-demand CSV/PDF export trigger + job history, all TanStack Query usage +
// api-client calls centralized here (CLAUDE.md §3: no business logic in
// components).
//
// AC-33: large exports run as a background job (queued -> running ->
// succeeded|failed). Rather than polling a single job by id, the list query
// itself re-fetches on an interval WHILE any job on the current page is
// still non-terminal, and stops the instant every visible job is terminal —
// this keeps the Export Jobs table live without a second polling loop, and
// without ever polling forever once nothing can still change.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateExportRequestDto, ExportJobStatus, ListExportJobsQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const EXPORTS_QUERY_KEY = ["reports", "exports"] as const;

export function exportJobsListKey(query: ListExportJobsQuery) {
  return [...EXPORTS_QUERY_KEY, "list", query] as const;
}

const NON_TERMINAL_STATUSES: ReadonlySet<ExportJobStatus> = new Set(["queued", "running"]);

/** Poll cadence while at least one visible job is queued/running. */
const EXPORT_POLL_INTERVAL_MS = 4000;

export function useExportJobsList(query: ListExportJobsQuery) {
  return useQuery({
    queryKey: exportJobsListKey(query),
    queryFn: () => apiClient.crm.exports.list(query),
    placeholderData: (previousData) => previousData,
    refetchInterval: (activeQuery) => {
      const items = activeQuery.state.data?.items ?? [];
      return items.some((job) => NON_TERMINAL_STATUSES.has(job.status)) ? EXPORT_POLL_INTERVAL_MS : false;
    },
  });
}

function useInvalidateExports() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: EXPORTS_QUERY_KEY });
  };
}

/**
 * POST /api/v1/crm/exports — trigger an on-demand export. Returns the job in
 * 'queued'/'running' state immediately (202); the Export Jobs list picks up
 * status/download-link changes via its own polling once invalidated here.
 */
export function useCreateExport() {
  const invalidate = useInvalidateExports();
  return useMutation({
    mutationFn: (body: CreateExportRequestDto) => apiClient.crm.exports.create(body),
    onSuccess: () => invalidate(),
  });
}
