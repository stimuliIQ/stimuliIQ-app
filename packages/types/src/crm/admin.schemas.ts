// Admin contract (roles, permission matrix, branches) — Phase 1, Wave 2
// (docs/plans/phase-1.md task #2). Covers docs/03 §7.16 + §9.
//
// Permission-matrix update semantics (plan §"Risks #3"): the matrix is
// read/replaced PER ROLE — `UpdateRolePermissionsRequest` carries the full
// desired grant list for one `roleId`, not a single permission delta. The
// backend computes the diff against existing `role_permissions` rows,
// writes ONE audit-log row per matrix-update call (entity = `role`,
// before/after = the full grant list), and MUST reject (403) any attempt by
// an editor to grant a `permissionKey`+`scope` combination broader than the
// editor's own resolved grant for that module (privilege-escalation guard —
// security-reviewer task #9 verifies this explicitly). `isSystem` roles
// (seeded defaults) can have their permissions edited but not be deleted/
// renamed — enforced server-side, not encoded in this schema.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema, PermissionScopeSchema, PhoneSchema, PasswordSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/admin/roles */
export const CreateRoleRequestSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, "must be lowercase snake_case, e.g. `branch_manager`"),
    name: z.string().min(1).max(120),
  })
  .strict();
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

/** PATCH /api/v1/crm/admin/roles/:id — `name` only; `key` is immutable once created, `isSystem` roles cannot be renamed. */
export const UpdateRoleRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
  })
  .strict();
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const RoleSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type Role = z.infer<typeof RoleSchema>;

export const ListRolesQuerySchema = PageQuerySchema.strict();
export type ListRolesQuery = z.infer<typeof ListRolesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Permission matrix
// ─────────────────────────────────────────────────────────────────────────

/** Action vocabulary, per docs/03 §9 ("module × action: view/create/edit/delete/export/approve"). */
export const PermissionActionSchema = z.enum(["view", "create", "edit", "delete", "export", "approve"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

/** One catalog entry — a definable `module.action` permission key + display label. */
export const PermissionCatalogEntrySchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "must be `module.action`")
    .describe("e.g. `students.edit`."),
  module: z.string().min(1).max(60),
  action: PermissionActionSchema,
  label: z.string().min(1).max(160),
});
export type PermissionCatalogEntry = z.infer<typeof PermissionCatalogEntrySchema>;

/** A single role's grant for one permission key — `scope: null` means "not granted". */
export const RolePermissionCellSchema = z.object({
  permissionKey: z.string(),
  scope: PermissionScopeSchema.nullable(),
});
export type RolePermissionCell = z.infer<typeof RolePermissionCellSchema>;

/**
 * GET /api/v1/crm/admin/roles/:id/permissions — and the shape reused for
 * the full matrix view (GET /api/v1/crm/admin/permissions) grouped by
 * module so the editor can render a module×action grid per role.
 */
export const PermissionMatrixModuleSchema = z.object({
  module: z.string(),
  permissions: z.array(PermissionCatalogEntrySchema),
});
export type PermissionMatrixModule = z.infer<typeof PermissionMatrixModuleSchema>;

export const PermissionMatrixSchema = z.object({
  modules: z.array(PermissionMatrixModuleSchema),
});
export type PermissionMatrix = z.infer<typeof PermissionMatrixSchema>;

/** GET /api/v1/crm/admin/roles/:id/permissions — one role's current grants. */
export const RolePermissionsSchema = z.object({
  roleId: UuidSchema,
  grants: z.array(RolePermissionCellSchema),
});
export type RolePermissions = z.infer<typeof RolePermissionsSchema>;

/**
 * PUT /api/v1/crm/admin/roles/:id/permissions — full-replace semantics (see
 * file header). Permission keys omitted from `grants` are treated as
 * revoked.
 */
export const UpdateRolePermissionsRequestSchema = z
  .object({
    grants: z.array(
      z.object({
        permissionKey: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "must be `module.action`"),
        scope: PermissionScopeSchema,
      }),
    ),
  })
  .strict();
export type UpdateRolePermissionsRequest = z.infer<typeof UpdateRolePermissionsRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Branches
// ─────────────────────────────────────────────────────────────────────────

export const BranchStatusSchema = z.enum(["active", "inactive"]);
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

/** POST /api/v1/crm/admin/branches */
export const CreateBranchRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    city: z.string().min(1).max(120),
    address: z.string().max(500).optional(),
    status: BranchStatusSchema.default("active"),
  })
  .strict();
export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

/** PATCH /api/v1/crm/admin/branches/:id */
export const UpdateBranchRequestSchema = CreateBranchRequestSchema.partial().strict();
export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequestSchema>;

export const ListBranchesQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional(),
    status: BranchStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;

export const BranchDetailSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  city: z.string(),
  address: z.string().nullable(),
  status: BranchStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BranchDetail = z.infer<typeof BranchDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Staff users (Admin ▸ Users — staff-account credential management)
// ─────────────────────────────────────────────────────────────────────────
//
// CRUD over `users` rows that hold at least one NON-student role (staff:
// super_admin/admin/branch_manager/counsellor/finance/support/content_editor/
// faculty/mentor/custom roles). Students are deliberately excluded — their
// accounts are provisioned by the enrollment flow and managed on the Students
// screen, never here. Permission keys: users.view / users.create / users.edit /
// users.delete (super_admin + admin only, scope=all — seeded in a dedicated
// block like the page-builder keys).

export const StaffUserStatusSchema = z.enum(["active", "invited", "suspended", "deactivated"]);
export type StaffUserStatus = z.infer<typeof StaffUserStatusSchema>;

export const StaffUserSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: StaffUserStatusSchema,
  roles: z.array(z.object({ id: UuidSchema, key: z.string(), name: z.string() })),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type StaffUser = z.infer<typeof StaffUserSchema>;

/** GET /api/v1/crm/admin/users */
export const ListStaffUsersQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Match by name or email."),
    roleId: UuidSchema.optional(),
    status: StaffUserStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListStaffUsersQuery = z.infer<typeof ListStaffUsersQuerySchema>;

/**
 * POST /api/v1/crm/admin/users — creates a staff login. `password` is the
 * initial credential the admin hands to the person (min 10 chars, same
 * `PasswordSchema` the login form enforces); the account is created `active`.
 * `roleIds` must name at least one non-student role.
 */
export const CreateStaffUserRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    password: PasswordSchema,
    roleIds: z.array(UuidSchema).min(1).max(10),
  })
  .strict();
export type CreateStaffUserRequest = z.infer<typeof CreateStaffUserRequestSchema>;

/**
 * PATCH /api/v1/crm/admin/users/:id — partial update. `password`, when
 * present, RESETS the user's credential (server re-hashes; all refresh
 * sessions for the user are revoked). `roleIds`, when present, full-replaces
 * the user's role assignments. Email is immutable (it is the login identity
 * and appears in audit history).
 */
export const UpdateStaffUserRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    phone: PhoneSchema.nullable().optional(),
    status: StaffUserStatusSchema.optional(),
    password: PasswordSchema.optional(),
    roleIds: z.array(UuidSchema).min(1).max(10).optional(),
  })
  .strict();
export type UpdateStaffUserRequest = z.infer<typeof UpdateStaffUserRequestSchema>;
