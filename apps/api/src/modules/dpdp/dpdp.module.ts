// apps/api/src/modules/dpdp/dpdp.module.ts
//
// Wires the DPDP erasure feature module (docs/04-trd-architecture.md §2.2 template).
// PrismaService is provided globally by PrismaModule (see prisma.module.ts) — no import
// needed here, matching every other feature module's convention (e.g. audit.module.ts).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DpdpController } from "./dpdp.controller";
import { DpdpService } from "./dpdp.service";
import { DpdpRepository } from "./dpdp.repository";

@Module({
  imports: [AuthModule],
  controllers: [DpdpController],
  providers: [DpdpService, DpdpRepository],
})
export class DpdpModule {}
