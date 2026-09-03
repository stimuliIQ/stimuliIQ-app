// apps/api/src/modules/admin/scope-rank.ts
//
// How wide a data-scope is, as a number, so "is this grant broader than the one the
// actor holds?" is a comparison rather than a nest of conditionals.
//
// Shared by the two surfaces that can hand out authority — `RolesService` (editing or
// cloning a role's permission matrix) and `UsersAdminService` (assigning a role to a
// person). Both must apply the SAME rule, because assigning a role you could not have
// built is the same act as building it; keeping one definition is what stops the two
// doors from drifting apart.

import type { RolePermissionScope } from "@prisma/client";

export const SCOPE_RANK: Record<RolePermissionScope, number> = {
  all: 4,
  branch: 3,
  assigned: 2,
  own: 1,
};
