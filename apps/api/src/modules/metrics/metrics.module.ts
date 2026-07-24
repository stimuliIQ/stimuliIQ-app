import { Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsAuthGuard } from "./metrics-auth.guard";

@Module({
  controllers: [MetricsController],
  providers: [MetricsAuthGuard],
})
export class MetricsModule {}
