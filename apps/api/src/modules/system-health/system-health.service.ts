// apps/api/src/modules/system-health/system-health.service.ts
//
// Builds the super-admin System Health snapshot. Controller → service → repository
// (CLAUDE.md §3.3); the controller only authorises and returns this.
//
// WHAT IS LIVE-CHECKED AND WHAT IS NOT, because the screen says "healthy" and has to mean it:
//   live      — this API process, Postgres (SELECT 1), Redis (PING), and the web/LMS/CRM frontends
//               (an HTTP GET to the URL in env).
//   not live  — third-party providers (Razorpay, Resend, MSG91, WhatsApp, R2…). Pinging them on
//               every refresh would spend quota and rate-limit headroom, and a "healthy" from a
//               credentials-present check is reported as exactly that, never as reachability.
//
// LEAK-SAFE (same rule as HealthService, Rule H-3): a driver error can contain a hostname, a port
// or a connection string, so failures are logged server-side and the response carries only a
// short sentence this file wrote.
//
// CACHED for CACHE_TTL_MS and single-flighted: the page auto-refreshes, several super admins may
// have it open, and each snapshot fans out to Postgres, Redis and three HTTP calls.

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as os from "node:os";
import { getHeapStatistics } from "node:v8";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import {
  rollUpSystemHealth,
  type SystemHealthComponent,
  type SystemHealthReport,
  type SystemHealthStatus,
} from "@repo/types";
import { validateEnv, type Env } from "../../config/env";
import { RedisService } from "../../redis/redis.service";
import { metricsRegistry } from "../../observability/metrics";
import { SystemHealthRepository } from "./system-health.repository";

const CACHE_TTL_MS = 10_000;
const DEPENDENCY_TIMEOUT_MS = 3_000;
const FRONTEND_TIMEOUT_MS = 5_000;
/** Above this a reachable dependency is reported as degraded rather than healthy. */
const SLOW_DEPENDENCY_MS = 500;
const SLOW_FRONTEND_MS = 3_000;
/** Don't judge an error RATE on a handful of requests. */
const MIN_REQUESTS_FOR_ERROR_RATE = 20;
const ERROR_RATE_DEGRADED_PERCENT = 5;
const EVENT_LOOP_P99_DEGRADED_MS = 250;
const HEAP_DEGRADED_PERCENT = 90;

const MB = 1024 * 1024;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const startedAt = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - startedAt) };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${round1(bytes / 1024 ** 3)} GB`;
  return `${round1(bytes / MB)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Parses the `key:value` lines of Redis `INFO`. */
export function parseRedisInfo(info: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

type IntegrationEnv = Pick<
  Env,
  | "NODE_ENV"
  | "PAYMENT_PROVIDER"
  | "RAZORPAY_KEY_ID"
  | "RAZORPAY_KEY_SECRET"
  | "MAIL_PROVIDER"
  | "RESEND_API_KEY"
  | "SMS_PROVIDER"
  | "MSG91_AUTH_KEY"
  | "WHATSAPP_PROVIDER"
  | "WHATSAPP_ACCESS_TOKEN"
  | "STORAGE_PROVIDER"
  | "STORAGE_BUCKET"
  | "VIDEO_PROVIDER"
  | "CAPTCHA_PROVIDER"
  | "SENTRY_DSN"
  | "QUEUE_DRIVER"
>;

interface IntegrationSpec {
  key: string;
  name: string;
  provider: string;
  /** Provider values that mean "switched off". */
  off: readonly string[];
  /** Whether the credentials this provider needs are all present. */
  credentialsPresent: boolean;
  /** In production, being off is a problem and not a choice. */
  requiredInProduction: boolean;
}

/**
 * Integrations are judged on configuration alone (see the file header). Exported and pure so the
 * rules are testable without a database, a network or an env file.
 */
export function buildIntegrationComponents(env: IntegrationEnv): SystemHealthComponent[] {
  const isProd = env.NODE_ENV === "production";
  const specs: IntegrationSpec[] = [
    {
      key: "payments",
      name: "Payments (Razorpay)",
      provider: env.PAYMENT_PROVIDER,
      off: ["disabled"],
      credentialsPresent: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
      requiredInProduction: true,
    },
    {
      key: "email",
      name: "Email (Resend)",
      provider: env.MAIL_PROVIDER,
      off: ["noop"],
      credentialsPresent: Boolean(env.RESEND_API_KEY),
      requiredInProduction: true,
    },
    {
      key: "sms",
      name: "SMS / OTP (MSG91)",
      provider: env.SMS_PROVIDER,
      off: ["noop", "disabled"],
      credentialsPresent: Boolean(env.MSG91_AUTH_KEY),
      requiredInProduction: false,
    },
    {
      key: "whatsapp",
      name: "WhatsApp",
      provider: env.WHATSAPP_PROVIDER,
      off: ["noop", "disabled"],
      credentialsPresent: Boolean(env.WHATSAPP_ACCESS_TOKEN),
      requiredInProduction: false,
    },
    {
      key: "storage",
      name: "File storage (R2 / S3)",
      provider: env.STORAGE_PROVIDER,
      off: ["noop"],
      credentialsPresent: env.STORAGE_PROVIDER === "local" || Boolean(env.STORAGE_BUCKET),
      requiredInProduction: true,
    },
    {
      key: "video",
      name: "Video streaming",
      provider: env.VIDEO_PROVIDER,
      off: ["noop", "disabled"],
      credentialsPresent: true,
      requiredInProduction: false,
    },
    {
      key: "captcha",
      name: "Bot protection (Turnstile)",
      provider: env.CAPTCHA_PROVIDER,
      off: ["noop"],
      credentialsPresent: true,
      requiredInProduction: false,
    },
  ];

  const components: SystemHealthComponent[] = specs.map((spec) => {
    const isOff = spec.off.includes(spec.provider);
    let status: SystemHealthStatus;
    let summary: string;
    if (isOff) {
      status = isProd && spec.requiredInProduction ? "degraded" : "unknown";
      summary =
        isProd && spec.requiredInProduction
          ? "Switched off in production, so this feature is not working."
          : "Switched off (no-op provider).";
    } else if (!spec.credentialsPresent) {
      status = "degraded";
      summary = "Enabled but its credentials are missing.";
    } else {
      status = "healthy";
      summary = "Configured with credentials. Not pinged, so reachability is not confirmed.";
    }
    return {
      key: spec.key,
      name: spec.name,
      category: "integration" as const,
      status,
      latencyMs: null,
      summary,
      details: [{ label: "Provider", value: spec.provider }],
    };
  });

  components.push({
    key: "monitoring",
    name: "Error monitoring (Sentry)",
    category: "integration",
    status: env.SENTRY_DSN ? "healthy" : isProd ? "degraded" : "unknown",
    latencyMs: null,
    summary: env.SENTRY_DSN
      ? "Configured. Not pinged, so delivery is not confirmed."
      : isProd
        ? "Not configured, so production errors are not being reported."
        : "Not configured.",
    details: [],
  });

  components.push({
    key: "queue",
    name: "Background jobs",
    category: "integration",
    status: "healthy",
    latencyMs: null,
    summary:
      env.QUEUE_DRIVER === "bullmq"
        ? "Jobs run on BullMQ workers."
        : "Jobs run inline in the API process (sync driver).",
    details: [{ label: "Driver", value: env.QUEUE_DRIVER }],
  });

  return components;
}

@Injectable()
export class SystemHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthService.name);
  private readonly startedAt = new Date(Date.now() - Math.round(process.uptime() * 1000));
  private readonly eventLoop: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });

  private cache: { at: number; tenantId: string; report: SystemHealthReport } | null = null;
  private inFlight: { tenantId: string; promise: Promise<SystemHealthReport> } | null = null;

  constructor(
    private readonly repository: SystemHealthRepository,
    private readonly redis: RedisService,
  ) {
    this.eventLoop.enable();
  }

  onModuleDestroy(): void {
    this.eventLoop.disable();
  }

  async getReport(tenantId: string): Promise<SystemHealthReport> {
    if (this.cache && this.cache.tenantId === tenantId && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.report;
    }
    if (this.inFlight && this.inFlight.tenantId === tenantId) return this.inFlight.promise;

    const promise = this.build(tenantId)
      .then((report) => {
        this.cache = { at: Date.now(), tenantId, report };
        return report;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = { tenantId, promise };
    return promise;
  }

  private async build(tenantId: string): Promise<SystemHealthReport> {
    const env = validateEnv();
    const now = new Date();

    const [postgres, redis, web, lms, crm, students, liveSessions] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkFrontend("web", "Marketing website", env.WEB_APP_URL),
      this.checkFrontend("lms", "Student portal (LMS)", env.LMS_APP_URL),
      this.checkFrontend("crm", "Admin CRM", env.CRM_APP_URL),
      this.repository.studentCounts(tenantId, now),
      this.repository.liveSessions(tenantId, now),
    ]);

    const runtime = this.runtime(env);
    const traffic = this.traffic();
    const api = this.apiComponent(runtime, traffic);

    const components: SystemHealthComponent[] = [
      api,
      postgres,
      redis,
      web,
      lms,
      crm,
      ...buildIntegrationComponents(env),
    ];

    return {
      checkedAt: now.toISOString(),
      overall: rollUpSystemHealth(components),
      components,
      students: { ...students, liveSessions },
      runtime,
      traffic,
    };
  }

  // ── Application ───────────────────────────────────────────────────────────

  private runtime(env: Env): SystemHealthReport["runtime"] {
    const mem = process.memoryUsage();
    const toMs = (ns: number) => (Number.isFinite(ns) ? round1(ns / 1e6) : 0);
    const mean = toMs(this.eventLoop.mean);
    const p99 = toMs(this.eventLoop.percentile(99));
    this.eventLoop.reset();
    const totalMem = os.totalmem();

    return {
      nodeVersion: process.version,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: this.startedAt.toISOString(),
      memoryRssMb: round1(mem.rss / MB),
      heapUsedMb: round1(mem.heapUsed / MB),
      // The V8 heap LIMIT, not heapTotal: heapTotal is only what has been allocated so far, so
      // used/total sits near 90% on a perfectly healthy process and would flag it constantly.
      heapLimitMb: round1(getHeapStatistics().heap_size_limit / MB),
      eventLoopMeanMs: mean,
      eventLoopP99Ms: p99,
      hostMemoryUsedPercent: totalMem > 0 ? round1(((totalMem - os.freemem()) / totalMem) * 100) : 0,
      cpuCount: os.cpus().length,
    };
  }

  private traffic(): SystemHealthReport["traffic"] {
    const snap = metricsRegistry.snapshot();
    return {
      totalRequests: snap.totalRequests,
      clientErrors: snap.clientErrors,
      serverErrors: snap.serverErrors,
      serverErrorRatePercent:
        snap.totalRequests > 0 ? round1((snap.serverErrors / snap.totalRequests) * 100) : 0,
      averageResponseMs: snap.totalRequests > 0 ? Math.round((snap.totalSeconds / snap.totalRequests) * 1000) : 0,
      inFlight: snap.inFlight,
    };
  }

  private apiComponent(
    runtime: SystemHealthReport["runtime"],
    traffic: SystemHealthReport["traffic"],
  ): SystemHealthComponent {
    const problems: string[] = [];
    if (traffic.totalRequests >= MIN_REQUESTS_FOR_ERROR_RATE && traffic.serverErrorRatePercent >= ERROR_RATE_DEGRADED_PERCENT) {
      problems.push(`${traffic.serverErrorRatePercent}% of requests are failing with a server error`);
    }
    if (runtime.eventLoopP99Ms >= EVENT_LOOP_P99_DEGRADED_MS) {
      problems.push(`the server is slow to respond (event loop delay ${runtime.eventLoopP99Ms} ms)`);
    }
    const heapPercent = runtime.heapLimitMb > 0 ? (runtime.heapUsedMb / runtime.heapLimitMb) * 100 : 0;
    if (heapPercent >= HEAP_DEGRADED_PERCENT) {
      problems.push(`memory is nearly full (${round1(heapPercent)}% of heap)`);
    }

    return {
      key: "api",
      name: "API server",
      category: "application",
      // This request is being served by the process, so "down" is not reachable from here.
      status: problems.length > 0 ? "degraded" : "healthy",
      latencyMs: null,
      summary: problems.length > 0 ? `Running, but ${problems.join("; ")}.` : "Running and serving requests.",
      details: [
        { label: "Uptime", value: formatUptime(runtime.uptimeSeconds) },
        { label: "Node", value: runtime.nodeVersion },
        { label: "Memory (RSS)", value: `${runtime.memoryRssMb} MB` },
        { label: "Heap", value: `${runtime.heapUsedMb} / ${runtime.heapLimitMb} MB` },
        { label: "Event loop (p99)", value: `${runtime.eventLoopP99Ms} ms` },
      ],
    };
  }

  // ── Data stores ───────────────────────────────────────────────────────────

  private async checkPostgres(): Promise<SystemHealthComponent> {
    const base = { key: "postgres", name: "PostgreSQL", category: "data" as const };
    try {
      const { ms } = await timed(() => withTimeout(this.repository.ping(), DEPENDENCY_TIMEOUT_MS));
      const info = await withTimeout(this.repository.databaseInfo(), DEPENDENCY_TIMEOUT_MS).catch(() => ({
        version: null,
        sizeBytes: null,
        connections: null,
      }));
      const details = [];
      if (info.version) details.push({ label: "Version", value: info.version });
      if (info.sizeBytes !== null) details.push({ label: "Database size", value: formatBytes(info.sizeBytes) });
      if (info.connections !== null) details.push({ label: "Open connections", value: String(info.connections) });
      const slow = ms >= SLOW_DEPENDENCY_MS;
      return {
        ...base,
        status: slow ? "degraded" : "healthy",
        latencyMs: ms,
        summary: slow ? `Reachable but slow (${ms} ms for a trivial query).` : "Accepting queries.",
        details,
      };
    } catch (err) {
      this.logger.warn(`System health: Postgres check failed · ${err instanceof Error ? err.message : "unknown"}`);
      return {
        ...base,
        status: "down",
        latencyMs: null,
        summary: "Not responding. Logins and every page that reads data will fail.",
        details: [],
      };
    }
  }

  private async checkRedis(): Promise<SystemHealthComponent> {
    const base = { key: "redis", name: "Redis", category: "data" as const };
    try {
      const { ms } = await timed(() => withTimeout(this.redis.client.ping(), DEPENDENCY_TIMEOUT_MS));
      const info = parseRedisInfo(
        await withTimeout(this.redis.client.info(), DEPENDENCY_TIMEOUT_MS).catch(() => ""),
      );
      const details = [];
      if (info.redis_version) details.push({ label: "Version", value: info.redis_version });
      if (info.used_memory_human) details.push({ label: "Memory used", value: info.used_memory_human });
      if (info.connected_clients) details.push({ label: "Connected clients", value: info.connected_clients });
      if (info.uptime_in_seconds) {
        details.push({ label: "Uptime", value: formatUptime(Number(info.uptime_in_seconds)) });
      }
      const slow = ms >= SLOW_DEPENDENCY_MS;
      return {
        ...base,
        status: slow ? "degraded" : "healthy",
        latencyMs: ms,
        summary: slow ? `Reachable but slow (${ms} ms for a PING).` : "Responding to commands.",
        details,
      };
    } catch (err) {
      this.logger.warn(`System health: Redis check failed · ${err instanceof Error ? err.message : "unknown"}`);
      return {
        ...base,
        status: "down",
        latencyMs: null,
        summary: "Not responding. Sign-in fails closed and rate limiting stops working.",
        details: [],
      };
    }
  }

  // ── Frontends ─────────────────────────────────────────────────────────────

  /**
   * One GET to the app's public URL (taken from validated env, never from a request, so this is
   * not an SSRF vector). Redirects are not followed: an LMS that answers 307 → /login is up. Any
   * answer below 500 counts as reachable; the body is discarded unread.
   */
  private async checkFrontend(key: string, name: string, url: string): Promise<SystemHealthComponent> {
    const base = { key, name, category: "frontend" as const };
    const host = new URL(url).host;
    try {
      const { result: status, ms } = await timed(async () => {
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(FRONTEND_TIMEOUT_MS),
        });
        await res.body?.cancel().catch(() => undefined);
        return res.status;
      });
      const details = [
        { label: "URL", value: host },
        { label: "HTTP status", value: String(status) },
      ];
      if (status >= 500) {
        return { ...base, status: "down", latencyMs: ms, summary: `Answering with a server error (HTTP ${status}).`, details };
      }
      if (ms >= SLOW_FRONTEND_MS) {
        return { ...base, status: "degraded", latencyMs: ms, summary: `Reachable but slow (${ms} ms).`, details };
      }
      return { ...base, status: "healthy", latencyMs: ms, summary: "Reachable and serving pages.", details };
    } catch (err) {
      this.logger.warn(`System health: ${key} check failed · ${err instanceof Error ? err.message : "unknown"}`);
      return {
        ...base,
        status: "down",
        latencyMs: null,
        summary: "Not reachable from the API server (no answer, or it took longer than 5 seconds).",
        details: [{ label: "URL", value: host }],
      };
    }
  }
}
