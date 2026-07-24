// apps/api/src/redis/redis.module.ts
//
// Global Redis client module (CLAUDE.md §1: "Redis for cache + sessions").
// Used by the auth module for OTP code storage (hashed, TTL) and per-phone/IP
// rate-limit counters. A single ioredis client per process; never instantiate
// Redis directly in a feature module — inject `RedisService`.

import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
