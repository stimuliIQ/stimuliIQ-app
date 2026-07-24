// apps/api/src/modules/bulk-actions/saved-views.service.ts
//
// Business logic for own-scope saved views (docs/plans/phase-9-completion.md T30).
// No Prisma here — delegates to SavedViewsRepository. userId always comes from the
// authenticated session (CurrentUser), never trusted from the client body.

import { Injectable, NotFoundException } from "@nestjs/common";
import { SavedViewsRepository, type SavedViewRow } from "./saved-views.repository";
import type { CreateSavedViewRequest, ListSavedViewsQuery, SavedView } from "./dto";

@Injectable()
export class SavedViewsService {
  constructor(private readonly repository: SavedViewsRepository) {}

  async create(tenantId: string, userId: string, body: CreateSavedViewRequest): Promise<SavedView> {
    const row = await this.repository.create(tenantId, userId, body.module, body.name, body.filters);
    return toDto(row);
  }

  async list(tenantId: string, userId: string, query: ListSavedViewsQuery): Promise<SavedView[]> {
    const rows = await this.repository.list(tenantId, userId, query.module);
    return rows.map(toDto);
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    // IDOR -> 404: an out-of-scope (not-this-user's) saved view is indistinguishable
    // from a nonexistent one.
    const existing = await this.repository.findOwnById(tenantId, userId, id);
    if (!existing) {
      throw new NotFoundException({ code: "saved_views.not_found", title: "Saved view not found" });
    }
    await this.repository.softDelete(id);
  }
}

function toDto(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    module: row.module,
    name: row.name,
    filters: row.filters,
    createdAt: row.createdAt.toISOString(),
  };
}
