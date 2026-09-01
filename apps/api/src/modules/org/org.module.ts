// apps/api/src/modules/org/org.module.ts
//
// The org hierarchy — teams, managers, team leads (docs/specs/org-teams.md, ADR-0069).
//
// Imports AuthModule only (guards). Exports OrgService because it is the ONE definition of
// who reports to whom: LeaveModule depends on it to resolve an approval chain, and the
// reporting modules will depend on it to narrow to "my team". That dependency is strictly
// one-way — nothing here knows what leave or a marketing target is.
//
// The alternative — each module resolving team membership its own way — is exactly the
// mistake `listCallerBranchIds` made: the same six-line query copied into six repositories,
// with no single place to change what a scope means.
import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";

import { OrgController } from "./org.controller";
import { OrgRepository } from "./org.repository";
import { OrgService } from "./org.service";

@Module({
  imports: [AuthModule],
  controllers: [OrgController],
  providers: [OrgService, OrgRepository],
  exports: [OrgService],
})
export class OrgModule {}
