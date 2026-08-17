// Staff-user data hooks (Admin ▸ Users — staff-account credential management).
// Mirrors use-branches.ts conventions over `client.crm.admin.users.*`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateStaffUserRequest, ListStaffUsersQuery, UpdateStaffUserRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const STAFF_USERS_QUERY_KEY = ["staff-users"] as const;

export function staffUsersListKey(query: ListStaffUsersQuery) {
  return [...STAFF_USERS_QUERY_KEY, "list", query] as const;
}

export function useStaffUsersList(query: ListStaffUsersQuery) {
  return useQuery({
    queryKey: staffUsersListKey(query),
    queryFn: () => apiClient.crm.admin.users.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateStaffUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: STAFF_USERS_QUERY_KEY });
  };
}

export function useCreateStaffUser() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: (body: CreateStaffUserRequest) => apiClient.crm.admin.users.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateStaffUser() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStaffUserRequest }) => apiClient.crm.admin.users.update(id, body),
    onSuccess: invalidate,
  });
}

/**
 * Admin 2FA rescue — clears ANOTHER user's second factor (`twofa.reset`, super_admin/
 * admin only). For a user who lost both their authenticator and inbox access; everyone
 * else self-serves via the recovery link on the sign-in page.
 */
export function useClearStaffUserTwoFactor() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.crm.admin.users.clearTwoFactor(id, { reason }),
    onSuccess: invalidate,
  });
}

export function useDeactivateStaffUser() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.admin.users.deactivate(id),
    onSuccess: invalidate,
  });
}

/**
 * Remove a staff account from the CRM — `users.remove`, super_admin only.
 *
 * Not the same call as `useDeactivateStaffUser`: that blocks the login and leaves the row
 * on the list, this one takes the account out of the product. The server soft-deletes, so
 * audit history and lead ownership survive the removal.
 */
export function useRemoveStaffUser() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.admin.users.remove(id),
    onSuccess: invalidate,
  });
}

/**
 * Rotate a staff member's password — `users.reset_password`, super_admin only.
 *
 * Invalidates the list because the reset can change the row's visible state: an `invited`
 * account becomes `active` once it has a real credential to sign in with.
 */
export function useResetStaffUserPassword() {
  const invalidate = useInvalidateStaffUsers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.admin.users.resetPassword(id),
    onSuccess: invalidate,
  });
}
