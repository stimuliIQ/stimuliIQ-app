// apps/api/src/modules/admin/admin.module.ts
//
// Wires the admin feature module (roles + permission matrix + branches) (docs/04-trd-
// architecture.md §2.2 template). Imports AuthModule for both the shared guards/
// interceptor AND `AuthRepository` (used by RolesService's privilege-escalation guard to
// resolve the editing user's own effective permission grants).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";
import { RolesRepository } from "./roles.repository";
import { BranchesController } from "./branches.controller";
import { BranchesService } from "./branches.service";
import { BranchesRepository } from "./branches.repository";

@Module({
  imports: [AuthModule],
  controllers: [RolesController, BranchesController],
  providers: [RolesService, RolesRepository, BranchesService, BranchesRepository],
  exports: [RolesRepository, BranchesRepository],
})
export class AdminModule {}
