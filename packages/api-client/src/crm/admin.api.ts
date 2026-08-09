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
  StaffUser,
  ListStaffUsersQuery,
  CreateStaffUserRequest,
  UpdateStaffUserRequest,
  AdminClearTwoFactorRequest,
  AdminClearTwoFactorResponse,
  DeleteStaffUserResponse,
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

export class StaffUsersApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/admin/users — staff accounts (non-student roles) only. */
  async list(query: ListStaffUsersQuery) {
    return this.client.requestPaginated<StaffUser>(
      "GET",
      `/api/v1/crm/admin/users${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/admin/users/:id */
  async get(id: string): Promise<StaffUser> {
    return this.client.request<StaffUser>("GET", `/api/v1/crm/admin/users/${id}`);
  }

  /** POST /api/v1/crm/admin/users — creates a staff login (name/email/password/roles). */
  async create(body: CreateStaffUserRequest, idempotencyKey: string = crypto.randomUUID()): Promise<StaffUser> {
    return this.client.request<StaffUser>("POST", "/api/v1/crm/admin/users", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/admin/users/:id — partial update; `password` resets the credential. */
  async update(
    id: string,
    body: UpdateStaffUserRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<StaffUser> {
    return this.client.request<StaffUser>("PATCH", `/api/v1/crm/admin/users/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/admin/users/:id — deactivates the account (blocks login), never a hard delete. */
  async deactivate(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<StaffUser> {
    return this.client.request<StaffUser>("DELETE", `/api/v1/crm/admin/users/${id}`, { idempotencyKey });
  }

  /**
   * DELETE /api/v1/crm/admin/users/:id/permanent — removes the account from the CRM.
   *
   * Distinct from `deactivate()` above in both effect and authority: that one blocks the
   * login and leaves the row in the list, this one takes the account out of the product and
   * requires `users.remove`, seeded for **super_admin alone**. The row is soft-deleted, so
   * audit history and lead ownership survive; re-adding the same email restores it.
   */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<DeleteStaffUserResponse> {
    return this.client.request<DeleteStaffUserResponse>("DELETE", `/api/v1/crm/admin/users/${id}/permanent`, {
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/admin/users/:id/two-factor/clear — admin rescue for a user who has
   * lost both their authenticator and inbox access. Requires `twofa.reset` (super_admin/
   * admin only). `reason` is mandatory and is recorded in the audit log.
   */
  async clearTwoFactor(
    id: string,
    body: AdminClearTwoFactorRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AdminClearTwoFactorResponse> {
    return this.client.request<AdminClearTwoFactorResponse>(
      "POST",
      `/api/v1/crm/admin/users/${id}/two-factor/clear`,
      { body, idempotencyKey },
    );
  }
}
