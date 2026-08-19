// Staff-leave data hooks. All I/O goes through `client.crm.leave.*`; components hold no
// business logic (CLAUDE.md §3.3).
//
// Three query families, invalidated together on any write: requests, balances and the
// calendar are three views of the same rows, so approving something has to move all three.
// Anything narrower would leave an approver looking at a queue that says "pending" next to a
// balance that has already been debited.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveLeaveRequestRequest,
  CreateHolidayRequest,
  CreateLeaveRequestRequest,
  CreateLeaveTypeRequest,
  GetLeaveBalancesQuery,
  GetLeaveCalendarQuery,
  ListLeaveRequestsQuery,
  RejectLeaveRequestRequest,
  SaveLeaveQuotasRequest,
  UpdateHolidayRequest,
  UpdateLeaveSettingRequest,
  UpdateLeaveTypeRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LEAVE_QUERY_KEY = ["leave"] as const;
export const LEAVE_REQUESTS_QUERY_KEY = ["leave", "requests"] as const;
export const LEAVE_BALANCES_QUERY_KEY = ["leave", "balances"] as const;
export const LEAVE_CALENDAR_QUERY_KEY = ["leave", "calendar"] as const;
export const LEAVE_SETUP_QUERY_KEY = ["leave", "setup"] as const;

/**
 * Invalidate everything under `["leave"]`.
 *
 * Deliberately blunt. A leave decision changes the request list, the applicant's balance and
 * the team calendar at once, and the cost of refetching three small staff-sized lists is far
 * below the cost of one of them being stale on screen next to the other two.
 */
function useInvalidateLeave() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_KEY });
}

// ── Requests ──────────────────────────────────────────────────────────────

export function useLeaveRequests(query: ListLeaveRequestsQuery) {
  return useQuery({
    queryKey: [...LEAVE_REQUESTS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.leave.requests.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useLeaveRequest(id: string | null) {
  return useQuery({
    queryKey: [...LEAVE_REQUESTS_QUERY_KEY, "detail", id] as const,
    queryFn: () => apiClient.crm.leave.requests.get(id as string),
    enabled: Boolean(id),
  });
}

/** Working week, holidays, types and balances in one call — see the SDK for why. */
export function useLeaveApplyContext(year?: number) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEY, "apply-context", year ?? null] as const,
    queryFn: () => apiClient.crm.leave.requests.applyContext(year ? { year } : {}),
  });
}

export function useLeaveBalances(query: GetLeaveBalancesQuery = {}) {
  return useQuery({
    queryKey: [...LEAVE_BALANCES_QUERY_KEY, query] as const,
    queryFn: () => apiClient.crm.leave.requests.balances(query),
  });
}

export function useLeaveCalendar(query: GetLeaveCalendarQuery) {
  return useQuery({
    queryKey: [...LEAVE_CALENDAR_QUERY_KEY, query] as const,
    queryFn: () => apiClient.crm.leave.requests.calendar(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useCreateLeaveRequest() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: CreateLeaveRequestRequest) => apiClient.crm.leave.requests.create(body),
    onSuccess: invalidate,
  });
}

export function useCancelLeaveRequest() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.leave.requests.cancel(id),
    onSuccess: invalidate,
  });
}

// ── Decisions ─────────────────────────────────────────────────────────────

export function useApproveLeaveRequest() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: ApproveLeaveRequestRequest }) =>
      apiClient.crm.leave.approvals.approve(id, body ?? {}),
    onSuccess: invalidate,
  });
}

export function useRejectLeaveRequest() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectLeaveRequestRequest }) =>
      apiClient.crm.leave.approvals.reject(id, body),
    onSuccess: invalidate,
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────

export function useLeaveTypes(activeOnly = true) {
  return useQuery({
    queryKey: [...LEAVE_SETUP_QUERY_KEY, "types", activeOnly] as const,
    queryFn: () => apiClient.crm.leave.setup.listTypes({ activeOnly }),
  });
}

export function useCreateLeaveType() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: CreateLeaveTypeRequest) => apiClient.crm.leave.setup.createType(body),
    onSuccess: invalidate,
  });
}

export function useUpdateLeaveType() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLeaveTypeRequest }) =>
      apiClient.crm.leave.setup.updateType(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteLeaveType() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.leave.setup.deleteType(id),
    onSuccess: invalidate,
  });
}

export function useLeaveQuotas(year: number) {
  return useQuery({
    queryKey: [...LEAVE_SETUP_QUERY_KEY, "quotas", year] as const,
    queryFn: () => apiClient.crm.leave.setup.listQuotas({ year }),
  });
}

export function useSaveLeaveQuotas() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: SaveLeaveQuotasRequest) => apiClient.crm.leave.setup.saveQuotas(body),
    onSuccess: invalidate,
  });
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: [...LEAVE_SETUP_QUERY_KEY, "holidays", year] as const,
    queryFn: () => apiClient.crm.leave.setup.listHolidays({ year }),
  });
}

export function useCreateHoliday() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: CreateHolidayRequest) => apiClient.crm.leave.setup.createHoliday(body),
    onSuccess: invalidate,
  });
}

export function useUpdateHoliday() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateHolidayRequest }) =>
      apiClient.crm.leave.setup.updateHoliday(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteHoliday() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.leave.setup.deleteHoliday(id),
    onSuccess: invalidate,
  });
}

export function useLeaveSettings() {
  return useQuery({
    queryKey: [...LEAVE_SETUP_QUERY_KEY, "settings"] as const,
    queryFn: () => apiClient.crm.leave.setup.getSettings(),
  });
}

export function useUpdateLeaveSettings() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: UpdateLeaveSettingRequest) => apiClient.crm.leave.setup.updateSettings(body),
    onSuccess: invalidate,
  });
}
