// apps/api/src/queues/queue-connection.ts
//
// Shared BullMQ connection options (docs/plans/phase-9-completion.md T18 / R1).
//
// WHY PLAIN OPTIONS, NOT A SHARED ioredis INSTANCE?
//   BullMQ ships its own vendored `ioredis` dependency. Passing an `ioredis.Redis`
//   instance constructed from THIS package's own `ioredis` import as `connection:`
//   requires the two `ioredis` module resolutions to be structurally identical, which
//   pnpm's per-package isolated node_modules cannot guarantee (a transitive version
//   bump on either side reintroduces a "Type 'Redis' is not assignable to type
//   'ConnectionOptions'" compile error). Passing plain connection OPTIONS (host/port/
//   password/db) instead avoids importing `ioredis` types into this file at all —
//   `ConnectionOptions` comes straight from the `bullmq` package, which BullMQ then
//   uses to construct its OWN internally-typed ioredis client. This is also BullMQ's
//   own documented default usage pattern (https://docs.bullmq.io/guide/connections).
//
// WHY A SEPARATE CONNECTION CONFIG FROM RedisService (apps/api/src/redis/redis.service.ts)?
//   BullMQ REQUIRES `maxRetriesPerRequest: null` for its blocking-command usage.
//   RedisService is configured with `maxRetriesPerRequest: 3` for the OTP-store/
//   rate-limiter use case — the wrong setting for BullMQ. Rather than changing
//   RedisService's config for every existing consumer, BullMQ gets its own dedicated
//   connection options, derived from the SAME REDIS_URL.
//
// LAZY BY DESIGN: getBullMqConnectionOptions() is called ONLY from the BullMq*Adapter
// factories (gated by QUEUE_DRIVER=bullmq) and from the worker entrypoint — never from
// a module that loads unconditionally. This guarantees the Jest unit suite
// (QUEUE_DRIVER=sync by default) never opens a Redis connection for queues.

import type { ConnectionOptions } from "bullmq";
import { validateEnv } from "../config/env";

/**
 * Parses REDIS_URL ("redis://[:password@]host:port[/db]") into the plain connection
 * options BullMQ's Queue/Worker/QueueEvents constructors accept.
 */
export function getBullMqConnectionOptions(): ConnectionOptions {
  const env = validateEnv();
  const url = new URL(env.REDIS_URL);

  const dbSegment = url.pathname.replace(/^\//, "");
  const db = dbSegment ? Number(dbSegment) : undefined;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db !== undefined && !Number.isNaN(db) ? { db } : {}),
    // Required by BullMQ for its blocking-command usage — see file header.
    maxRetriesPerRequest: null,
    // BullMQ manages reconnection/backoff itself; avoid ioredis's own ready-check
    // stalling job processing during a brief Redis blip.
    enableReadyCheck: false,
  };
}
