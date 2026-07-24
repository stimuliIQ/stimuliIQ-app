// apps/api/src/modules/faculty/faculty.module.ts
//
// Wires the faculty feature module (docs/04-trd-architecture.md §2.2 template). Imports
// AuthModule for the guards/interceptor it reuses (JwtAuthGuard, PermissionsGuard,
// ScopeInterceptor, AuthRepository, AuthIpRateLimitGuard) rather than redeclaring providers
// — single DI source per CLAUDE.md §3. MailProviderModule: for MAIL_PROVIDER, used by
// FacultyService.resetPassword's "your password has been reset" email.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { FacultyController } from "./faculty.controller";
import { FacultyService } from "./faculty.service";
import { FacultyRepository } from "./faculty.repository";

@Module({
  imports: [AuthModule, MailProviderModule],
  controllers: [FacultyController],
  providers: [FacultyService, FacultyRepository],
  exports: [FacultyRepository],
})
export class FacultyModule {}
