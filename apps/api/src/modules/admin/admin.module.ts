// apps/api/src/modules/admin/admin.module.ts
//
// Wires the admin feature module (roles + permission matrix + branches) (docs/04-trd-
// architecture.md §2.2 template). Imports AuthModule for both the shared guards/
// interceptor AND `AuthRepository` (used by RolesService's privilege-escalation guard to
// resolve the editing user's own effective permission grants).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
// MailProviderModule: for MAIL_PROVIDER, used by UsersAdminService.resetPassword's
// "your password has been reset" email (same wiring as FacultyModule).
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";
import { RolesRepository } from "./roles.repository";
import { BranchesController } from "./branches.controller";
import { BranchesService } from "./branches.service";
import { BranchesRepository } from "./branches.repository";
import { UsersAdminController } from "./users.controller";
import { UsersAdminService } from "./users.service";
import { UsersAdminRepository } from "./users.repository";

@Module({
  imports: [AuthModule, MailProviderModule],
  controllers: [RolesController, BranchesController, UsersAdminController],
  providers: [RolesService, RolesRepository, BranchesService, BranchesRepository, UsersAdminService, UsersAdminRepository],
  exports: [RolesRepository, BranchesRepository],
})
export class AdminModule {}
