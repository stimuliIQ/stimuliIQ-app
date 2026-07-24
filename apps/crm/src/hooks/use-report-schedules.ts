// Report-schedule data hooks — Phase 7, Wave 3 (docs/plans/phase-7.md task
// #15). Recurring report-email CRUD; all TanStack Query usage + api-client
// calls centralized here (CLAUDE.md §3: no business logic in components).
//
// AC-37: a schedule's recipient scope is re-evaluated at SEND time from the
// recipient's live session — nothing here ever stores or edits a scope
// snapshot; `type`/`params` are immutable after creation (delete + recreate
// to change what's reported), so there is deliberately no `get(id)`/re-fetch
// — the edit surface works off the row already in the list.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateReportScheduleDto,
  ListReportSchedulesQuery,
  UpdateReportScheduleDto,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const REPORT_SCHEDULES_QUERY_KEY = ["reports", "schedules"] as const;

export function reportSchedulesListKey(query: ListReportSchedulesQuery) {
  return [...REPORT_SCHEDULES_QUERY_KEY, "list", query] as const;
}

export function useReportSchedulesList(query: ListReportSchedulesQuery) {
  return useQuery({
    queryKey: reportSchedulesListKey(query),
    queryFn: () => apiClient.crm.reportSchedules.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateReportSchedules() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: REPORT_SCHEDULES_QUERY_KEY });
  };
}

export function useCreateReportSchedule() {
  const invalidate = useInvalidateReportSchedules();
  return useMutation({
    mutationFn: (body: CreateReportScheduleDto) => apiClient.crm.reportSchedules.create(body),
    onSuccess: () => invalidate(),
  });
}

/** PATCH — cadence/recipient/active toggle only; `type`/`params`/`format` are immutable. */
export function useUpdateReportSchedule() {
  const invalidate = useInvalidateReportSchedules();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateReportScheduleDto }) =>
      apiClient.crm.reportSchedules.update(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteReportSchedule() {
  const invalidate = useInvalidateReportSchedules();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.reportSchedules.remove(id),
    onSuccess: () => invalidate(),
  });
}
