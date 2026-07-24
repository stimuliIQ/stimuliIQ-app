// Bookings hooks — CRM-side management (create/update/status move).
// Mirrors use-leads.ts conventions. Phase 2 Wave 5b (docs/plans/phase-2.md
// task #8). The public unauthenticated intake (`createPublic`) is not used
// here — that's the website's stub funnel (P5), not a CRM screen; the CRM
// only manages the bookings that result from it (or that staff create
// directly).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateBookingRequest, ListBookingsQuery, MoveBookingStatusRequest, UpdateBookingRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { LEADS_QUERY_KEY } from "./use-leads";

export const BOOKINGS_QUERY_KEY = ["leads", "bookings"] as const;

export function bookingsListKey(query: ListBookingsQuery) {
  return [...BOOKINGS_QUERY_KEY, "list", query] as const;
}

export function bookingDetailKey(id: string) {
  return [...BOOKINGS_QUERY_KEY, "detail", id] as const;
}

export function useBookingsList(query: ListBookingsQuery) {
  return useQuery({
    queryKey: bookingsListKey(query),
    queryFn: () => apiClient.crm.bookings.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: bookingDetailKey(id ?? ""),
    queryFn: () => apiClient.crm.bookings.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateBookings() {
  const queryClient = useQueryClient();
  return (bookingId?: string, leadId?: string) => {
    void queryClient.invalidateQueries({ queryKey: BOOKINGS_QUERY_KEY });
    if (bookingId) {
      void queryClient.invalidateQueries({ queryKey: bookingDetailKey(bookingId) });
    }
    if (leadId) {
      void queryClient.invalidateQueries({ queryKey: [...LEADS_QUERY_KEY, "detail", leadId] });
    }
  };
}

export function useCreateBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (body: CreateBookingRequest) => apiClient.crm.bookings.create(body),
    onSuccess: (_data, variables) => invalidate(undefined, variables.leadId),
  });
}

export function useUpdateBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBookingRequest }) =>
      apiClient.crm.bookings.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useMoveBookingStatus() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveBookingStatusRequest }) =>
      apiClient.crm.bookings.moveStatus(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
