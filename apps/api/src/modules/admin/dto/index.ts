// apps/api/src/modules/admin/dto/index.ts
//
// Re-exports the admin (roles/permission-matrix/branches) zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template). Never redeclare a shape here —
// single source of truth stays in the shared package.

export {
  CloneRoleRequestSchema,
  type CloneRoleRequest,
  CreateRoleRequestSchema,
  type CreateRoleRequest,
  UpdateRoleRequestSchema,
  type UpdateRoleRequest,
  ListRolesQuerySchema,
  type ListRolesQuery,
  type Role,
  PermissionActionSchema,
  type PermissionAction,
  type PermissionCatalogEntry,
  type RolePermissionCell,
  type PermissionMatrixModule,
  type PermissionMatrix,
  type RolePermissions,
  UpdateRolePermissionsRequestSchema,
  type UpdateRolePermissionsRequest,
  BranchStatusSchema,
  type BranchStatus,
  CreateBranchRequestSchema,
  type CreateBranchRequest,
  UpdateBranchRequestSchema,
  type UpdateBranchRequest,
  ListBranchesQuerySchema,
  type ListBranchesQuery,
  type BranchDetail,
} from "@repo/types";
