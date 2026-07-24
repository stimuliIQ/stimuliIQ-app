// Typed admin SDK — roles + permission matrix + branches, over
// /api/v1/crm/admin/*. The permission-matrix update endpoint is a
// full-replace PUT (see @repo/types crm/admin.schemas.ts file header).

import type {
  Role,
  ListRolesQuery,
  CreateRoleRequest,
  UpdateRoleRequest,
  PermissionMatrix,
  RolePermissions,
  UpdateRolePermissionsRequest,
  BranchDetail,
  ListBranchesQuery,
  CreateBranchRequest,
  UpdateBranchRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class RolesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/admin/roles */
  async list(query: ListRolesQuery) {
    return this.client.requestPaginated<Role>(
      "GET",
      `/api/v1/crm/admin/roles${toQueryString(query)}`,
    );
  }

  /** POST /api/v1/crm/admin/roles */
  async create(body: CreateRoleRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Role> {
    return this.client.request<Role>("POST", "/api/v1/crm/admin/roles", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/admin/roles/:id — non-system roles only. */
  async update(
    id: string,
    body: UpdateRoleRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Role> {
    return this.client.request<Role>("PATCH", `/api/v1/crm/admin/roles/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/admin/roles/:id — soft-deletes a non-system role. Returns the deleted role. */
  async delete(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<Role> {
    return this.client.request<Role>("DELETE", `/api/v1/crm/admin/roles/${id}`, { idempotencyKey });
  }

  /** GET /api/v1/crm/admin/permissions — full catalog grouped by module, for the matrix editor headers. */
  async getPermissionCatalog(): Promise<PermissionMatrix> {
    return this.client.request<PermissionMatrix>("GET", "/api/v1/crm/admin/permissions");
  }

  /** GET /api/v1/crm/admin/roles/:id/permissions — one role's current grants. */
  async getPermissions(roleId: string): Promise<RolePermissions> {
    return this.client.request<RolePermissions>("GET", `/api/v1/crm/admin/roles/${roleId}/permissions`);
  }

  /**
   * PUT /api/v1/crm/admin/roles/:id/permissions — full-replace the role's
   * grants. Owner/Admin only; server rejects grants broader than the
   * editor's own scope (privilege-escalation guard).
   */
  async updatePermissions(
    roleId: string,
    body: UpdateRolePermissionsRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<RolePermissions> {
    return this.client.request<RolePermissions>(
      "PUT",
      `/api/v1/crm/admin/roles/${roleId}/permissions`,
      { body, idempotencyKey },
    );
  }
}

export class BranchesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/admin/branches */
  async list(query: ListBranchesQuery) {
    return this.client.requestPaginated<BranchDetail>(
      "GET",
      `/api/v1/crm/admin/branches${toQueryString(query)}`,
    );
  }

  /** POST /api/v1/crm/admin/branches — Owner/Admin only. */
  async create(body: CreateBranchRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BranchDetail> {
    return this.client.request<BranchDetail>("POST", "/api/v1/crm/admin/branches", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/admin/branches/:id — Owner/Admin only. */
  async update(
    id: string,
    body: UpdateBranchRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BranchDetail> {
    return this.client.request<BranchDetail>("PATCH", `/api/v1/crm/admin/branches/${id}`, {
      body,
      idempotencyKey,
    });
  }
}
