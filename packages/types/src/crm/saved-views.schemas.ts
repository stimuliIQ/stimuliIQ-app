// packages/types/src/crm/saved-views.schemas.ts
//
// Shared contract for CRM saved (filter) views (Phase 9 Completion T30) — PROMOTED
// from the STOPGAP local schema at
// apps/api/src/modules/bulk-actions/dto/bulk-actions.schemas.ts (see that file's
// header for the full original rationale). This package is now the canonical shared
// contract; the backend controller/service currently still import their own local
// copy — the two shapes MUST stay structurally identical.
//
// Own-scope only: a staff user manages ONLY their own saved filter sets; `userId` is
// always taken from the authenticated session server-side, never accepted from the
// client body.
//
// Endpoints:
//   POST   /api/v1/crm/saved-views      — authenticated only (see PERMISSION NOTE below)
//   GET    /api/v1/crm/saved-views      — authenticated only
//   DELETE /api/v1/crm/saved-views/:id  — authenticated only, IDOR->404 on another user's view
//
// PERMISSION NOTE: no dedicated `saved_views.*` permission key exists in the catalog.
// A saved view is an opaque, per-user named filter-set (never interpreted
// server-side) over data the caller must ALREADY separately hold `leads.view`/
// `students.view` to actually query; it carries no additional data-access surface of
// its own — so these routes rely on authentication alone (JwtAuthGuard), not a
// `@RequirePermission` guard.
//
// `filters` is intentionally `z.record(string, unknown)` — an opaque bag echoed back
// verbatim, never validated/interpreted against a resource's actual filter shape.

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const SavedViewModuleSchema = z.enum(["leads", "students"]);
export type SavedViewModule = z.infer<typeof SavedViewModuleSchema>;

/** POST /api/v1/crm/saved-views */
export const CreateSavedViewRequestSchema = z
  .object({
    module: SavedViewModuleSchema,
    name: z.string().min(1).max(80),
    filters: z
      .record(z.string(), z.unknown())
      .describe("Opaque filter-set. Echoed back verbatim, never interpreted server-side."),
  })
  .strict();
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequestSchema>;

/**
 * GET /api/v1/crm/saved-views
 *
 * NOTE: `page`/`pageSize` are accepted (merged from the shared `PageQuerySchema` for
 * structural consistency with every other CRM list query) but are NOT applied
 * server-side today — the backend returns the caller's FULL own-scope set
 * unconditionally (a per-user saved-view list is small by construction). Mirrors the
 * backend's `ListSavedViewsQuerySchema` exactly; do not assume the response is
 * actually paginated.
 */
export const ListSavedViewsQuerySchema = z
  .object({
    module: SavedViewModuleSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListSavedViewsQuery = z.infer<typeof ListSavedViewsQuerySchema>;

export const SavedViewSchema = z.object({
  id: UuidSchema,
  module: SavedViewModuleSchema,
  name: z.string(),
  filters: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;
