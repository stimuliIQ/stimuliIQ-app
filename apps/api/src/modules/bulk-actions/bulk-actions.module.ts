// apps/api/src/modules/bulk-actions/bulk-actions.module.ts
//
// Phase-9 Completion T30 — bulk actions (leads/students) + saved views
// (docs/plans/phase-9-completion.md).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LeadsModule } from "../leads/leads.module";
import { StudentsModule } from "../students/students.module";
import { BulkActionsController } from "./bulk-actions.controller";
import { BulkActionsService } from "./bulk-actions.service";
import { SavedViewsController } from "./saved-views.controller";
import { SavedViewsService } from "./saved-views.service";
import { SavedViewsRepository } from "./saved-views.repository";

@Module({
  imports: [AuthModule, LeadsModule, StudentsModule],
  controllers: [BulkActionsController, SavedViewsController],
  providers: [BulkActionsService, SavedViewsService, SavedViewsRepository],
})
export class BulkActionsModule {}
