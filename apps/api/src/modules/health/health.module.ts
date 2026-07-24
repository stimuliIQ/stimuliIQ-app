import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { HealthRateLimitGuard } from "./guards/health-rate-limit.guard";

// PrismaService/RedisService are provided by the @Global() PrismaModule/RedisModule
// already imported once in AppModule — no need to re-import either module here.
@Module({
  controllers: [HealthController],
  providers: [HealthService, HealthRateLimitGuard],
})
export class HealthModule {}
