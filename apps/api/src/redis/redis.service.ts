// apps/api/src/redis/redis.service.ts
//
// NestJS-injectable ioredis client. Connects lazily; `onModuleDestroy` closes the
// connection cleanly on app shutdown. Consumers (e.g. auth's OTP store, rate
// limiter) inject `RedisService` and use `.client` — never construct a second
// Redis connection elsewhere in the app.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { validateEnv } from "../config/env";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor() {
    const env = validateEnv();
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log("Redis connected");
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
