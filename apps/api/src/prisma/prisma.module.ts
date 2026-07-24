// apps/api/src/prisma/prisma.module.ts
//
// Global module exposing `PrismaService` (extended client with soft-delete + audit
// behavior baked in). Import once in `AppModule` — backend-builder wires this in
// Wave 4 alongside the auth module. `@Global()` so feature modules can inject
// `PrismaService` without re-importing `PrismaModule` everywhere.

import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
