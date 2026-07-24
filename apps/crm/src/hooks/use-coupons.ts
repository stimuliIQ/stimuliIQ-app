// Coupons hooks — CRUD + validate. Mirrors use-batches.ts conventions.
// Phase 2 Wave 5a (docs/plans/phase-2.md task #7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateCouponRequest,
  ListCouponsQuery,
  UpdateCouponRequest,
  ValidateCouponRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const COUPONS_QUERY_KEY = ["commerce", "coupons"] as const;

export function couponsListKey(query: ListCouponsQuery) {
  return [...COUPONS_QUERY_KEY, "list", query] as const;
}

export function couponDetailKey(id: string) {
  return [...COUPONS_QUERY_KEY, "detail", id] as const;
}

export function useCouponsList(query: ListCouponsQuery) {
  return useQuery({
    queryKey: couponsListKey(query),
    queryFn: () => apiClient.commerce.coupons.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useCoupon(id: string | undefined) {
  return useQuery({
    queryKey: couponDetailKey(id ?? ""),
    queryFn: () => apiClient.commerce.coupons.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateCoupons() {
  const queryClient = useQueryClient();
  return (couponId?: string) => {
    void queryClient.invalidateQueries({ queryKey: COUPONS_QUERY_KEY });
    if (couponId) {
      void queryClient.invalidateQueries({ queryKey: couponDetailKey(couponId) });
    }
  };
}

export function useCreateCoupon() {
  const invalidate = useInvalidateCoupons();
  return useMutation({
    mutationFn: (body: CreateCouponRequest) => apiClient.commerce.coupons.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCoupon() {
  const invalidate = useInvalidateCoupons();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCouponRequest }) =>
      apiClient.commerce.coupons.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

/** Soft-delete via status update (`status: "inactive"`) — a lighter-weight alternative to full delete. */
export function useDeactivateCoupon() {
  const invalidate = useInvalidateCoupons();
  return useMutation({
    mutationFn: (id: string) => apiClient.commerce.coupons.update(id, { status: "inactive" }),
    onSuccess: (_data, id) => invalidate(id),
  });
}

/** Soft-delete via DELETE endpoint (`deleted_at` set server-side). */
export function useDeleteCoupon() {
  const invalidate = useInvalidateCoupons();
  return useMutation({
    mutationFn: (id: string) => apiClient.commerce.coupons.remove(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

/** Non-mutating discount preview — does not change the `used` counter. */
export function useValidateCoupon() {
  return useMutation({
    mutationFn: (body: ValidateCouponRequest) => apiClient.commerce.coupons.validate(body),
  });
}
