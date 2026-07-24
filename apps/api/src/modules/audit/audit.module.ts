// apps/api/src/modules/audit/audit.module.ts
//
// Wires the audit (read-only) feature module (docs/04-trd-architecture.md §2.2 template).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";
import { AuditRepository } from "./audit.repository";

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
})
export class AuditModule {}
