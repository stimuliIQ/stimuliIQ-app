// Roles + permission-matrix data hooks (docs/03 §7.16/§9) — mirrors the rest
// of the Wave 4a hook pattern. The matrix editor reads the full permission
// catalog once (rarely changes) plus a selected role's current grants, and
// saves via a full-replace PUT (see @repo/types crm/admin.schemas.ts header).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateRoleRequest,
  ListRolesQuery,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const ROLES_QUERY_KEY = ["roles"] as const;
export const PERMISSION_CATALOG_QUERY_KEY = ["permission-catalog"] as const;

export function rolesListKey(query: ListRolesQuery) {
  return [...ROLES_QUERY_KEY, "list", query] as const;
}

export function rolePermissionsKey(roleId: string) {
  return [...ROLES_QUERY_KEY, "permissions", roleId] as const;
}

export function useRolesList(query: ListRolesQuery) {
  return useQuery({
    queryKey: rolesListKey(query),
    queryFn: () => apiClient.crm.admin.roles.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: PERMISSION_CATALOG_QUERY_KEY,
    queryFn: () => apiClient.crm.admin.roles.getPermissionCatalog(),
    staleTime: 5 * 60_000,
  });
}

export function useRolePermissions(roleId: string | undefined) {
  return useQuery({
    queryKey: rolePermissionsKey(roleId ?? ""),
    queryFn: () => apiClient.crm.admin.roles.getPermissions(roleId as string),
    enabled: Boolean(roleId),
  });
}

function useInvalidateRoles() {
  const queryClient = useQueryClient();
  return (roleId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    if (roleId) {
      void queryClient.invalidateQueries({ queryKey: rolePermissionsKey(roleId) });
    }
  };
}

export function useCreateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (body: CreateRoleRequest) => apiClient.crm.admin.roles.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleRequest }) =>
      apiClient.crm.admin.roles.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

/**
 * Soft-deletes a custom role. The server rejects system roles (403) and roles still
 * assigned to users (409) — those errors are surfaced by the caller's toast.
 */
export function useDeleteRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.admin.roles.delete(id),
    onSuccess: () => invalidate(),
  });
}

/**
 * Full-replace save of a role's permission grants. The SERVER is the only
 * real enforcement point for the privilege-escalation guard (an editor
 * cannot grant a permission/scope broader than their own) — this mutation
 * just forwards the request and surfaces whatever 403/validation error the
 * API returns; see roles-permission-matrix.tsx for how that's rendered.
 */
export function useUpdateRolePermissions() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ roleId, body }: { roleId: string; body: UpdateRolePermissionsRequest }) =>
      apiClient.crm.admin.roles.updatePermissions(roleId, body),
    onSuccess: (_data, variables) => invalidate(variables.roleId),
  });
}
