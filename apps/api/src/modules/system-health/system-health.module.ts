import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";

import { SystemHealthController } from "./system-health.controller";
import { SystemHealthRepository } from "./system-health.repository";
import { SystemHealthService } from "./system-health.service";

// PrismaService/RedisService come from the @Global() PrismaModule/RedisModule imported once in
// AppModule. AuthModule supplies what JwtAuthGuard and PermissionsGuard need.
@Module({
  imports: [AuthModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService, SystemHealthRepository],
})
export class SystemHealthModule {}
