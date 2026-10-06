import { buildIntegrationComponents, parseRedisInfo, SystemHealthService } from "./system-health.service";
import type { SystemHealthRepository } from "./system-health.repository";
import type { RedisService } from "../../redis/redis.service";

type IntegrationEnv = Parameters<typeof buildIntegrationComponents>[0];

const baseEnv: IntegrationEnv = {
  NODE_ENV: "production",
  PAYMENT_PROVIDER: "razorpay",
  RAZORPAY_KEY_ID: "rzp_live_x",
  RAZORPAY_KEY_SECRET: "secret",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_x",
  SMS_PROVIDER: "msg91",
  MSG91_AUTH_KEY: "k",
  WHATSAPP_PROVIDER: "whatsapp_cloud",
  WHATSAPP_ACCESS_TOKEN: "t",
  STORAGE_PROVIDER: "r2",
  STORAGE_BUCKET: "bucket",
  VIDEO_PROVIDER: "cloudflare_stream",
  CAPTCHA_PROVIDER: "turnstile",
  SENTRY_DSN: "https://x@sentry.io/1",
  QUEUE_DRIVER: "sync",
};

const byKey = (env: IntegrationEnv, key: string) =>
  buildIntegrationComponents(env).find((c) => c.key === key)!;

describe("buildIntegrationComponents", () => {
  it("reports a fully configured production stack as healthy, and says it was not pinged", () => {
    const all = buildIntegrationComponents(baseEnv);
    expect(all.every((c) => c.status === "healthy")).toBe(true);
    expect(byKey(baseEnv, "payments").summary).toMatch(/not pinged/i);
  });

  it("flags a required integration switched off in production as degraded", () => {
    expect(byKey({ ...baseEnv, MAIL_PROVIDER: "noop" }, "email").status).toBe("degraded");
    expect(byKey({ ...baseEnv, PAYMENT_PROVIDER: "disabled" }, "payments").status).toBe("degraded");
    expect(byKey({ ...baseEnv, STORAGE_PROVIDER: "noop" }, "storage").status).toBe("degraded");
  });

  it("treats the same switch-off as a non-event outside production", () => {
    const dev = { ...baseEnv, NODE_ENV: "development" as const, MAIL_PROVIDER: "noop" as const };
    expect(byKey(dev, "email").status).toBe("unknown");
  });

  it("treats an optional integration being off as unknown, not a problem, even in production", () => {
    expect(byKey({ ...baseEnv, WHATSAPP_PROVIDER: "noop" }, "whatsapp").status).toBe("unknown");
  });

  it("flags an enabled provider with no credentials as degraded", () => {
    expect(byKey({ ...baseEnv, RESEND_API_KEY: undefined }, "email").status).toBe("degraded");
    expect(byKey({ ...baseEnv, RAZORPAY_KEY_SECRET: undefined }, "payments").status).toBe("degraded");
  });

  it("flags missing Sentry in production only", () => {
    expect(byKey({ ...baseEnv, SENTRY_DSN: undefined }, "monitoring").status).toBe("degraded");
    expect(byKey({ ...baseEnv, NODE_ENV: "development", SENTRY_DSN: undefined }, "monitoring").status).toBe(
      "unknown",
    );
  });

  it("never puts a credential value in the output", () => {
    const serialised = JSON.stringify(buildIntegrationComponents(baseEnv));
    for (const secret of ["rzp_live_x", "secret", "re_x", "https://x@sentry.io/1"]) {
      expect(serialised).not.toContain(secret);
    }
  });
});

describe("parseRedisInfo", () => {
  it("reads key:value lines and skips section headers and blanks", () => {
    const parsed = parseRedisInfo(
      "# Server\r\nredis_version:7.2.4\r\nuptime_in_seconds:90\r\n\r\n# Memory\r\nused_memory_human:1.02M\r\n",
    );
    expect(parsed).toEqual({ redis_version: "7.2.4", uptime_in_seconds: "90", used_memory_human: "1.02M" });
  });
});

describe("SystemHealthService", () => {
  function make(over: { ping?: () => Promise<void>; redisPing?: () => Promise<string> } = {}) {
    const repo = {
      ping: jest.fn(over.ping ?? (() => Promise.resolve())),
      databaseInfo: jest.fn().mockResolvedValue({ version: "16.4", sizeBytes: 5 * 1024 * 1024, connections: 3 }),
      studentCounts: jest.fn().mockResolvedValue({
        total: 120,
        activeAccounts: 110,
        signedInLast24h: 40,
        signedInLast7d: 90,
        neverSignedIn: 12,
        newLast7d: 8,
        newLast30d: 30,
      }),
      liveSessions: jest.fn().mockResolvedValue(17),
    };
    const redis = {
      client: {
        ping: jest.fn(over.redisPing ?? (() => Promise.resolve("PONG"))),
        info: jest.fn().mockResolvedValue("redis_version:7.2.4\r\nconnected_clients:4\r\n"),
      },
    };
    const service = new SystemHealthService(
      repo as unknown as SystemHealthRepository,
      redis as unknown as RedisService,
    );
    return { service, repo, redis };
  }

  // The frontends are fetched over HTTP; stub fetch so the suite never touches a network.
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, body: { cancel: () => Promise.resolve() } }) as never;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reports the student headcount and per-component status when everything answers", async () => {
    const { service } = make();
    const report = await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(report.students.total).toBe(120);
    expect(report.students.liveSessions).toBe(17);
    expect(report.components.find((c) => c.key === "postgres")?.status).toBe("healthy");
    expect(report.components.find((c) => c.key === "redis")?.status).toBe("healthy");
    expect(report.components.find((c) => c.key === "lms")?.status).toBe("healthy");
  });

  it("calls the platform an outage when Postgres is unreachable, without leaking the error", async () => {
    const { service } = make({
      ping: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")),
    });
    const report = await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(report.components.find((c) => c.key === "postgres")?.status).toBe("down");
    expect(report.overall.status).toBe("down");
    expect(report.overall.headline).toContain("PostgreSQL");
    expect(JSON.stringify(report)).not.toMatch(/hunter2|10\.0\.0\.5|ECONNREFUSED/);
  });

  it("marks Redis down and the overall verdict down when PING fails", async () => {
    const { service } = make({ redisPing: () => Promise.reject(new Error("boom")) });
    const report = await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(report.components.find((c) => c.key === "redis")?.status).toBe("down");
    expect(report.overall.status).toBe("down");
  });

  it("marks a frontend answering 5xx as down, and degrades rather than fails the overall verdict", async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 503, body: null }) as never;
    const { service } = make();
    const report = await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(report.components.find((c) => c.key === "web")?.status).toBe("down");
    expect(report.overall.status).toBe("degraded");
  });

  it("marks a frontend whose request throws as down, without leaking the host from the error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND internal.host")) as never;
    const { service } = make();
    const report = await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(report.components.find((c) => c.key === "crm")?.status).toBe("down");
    expect(JSON.stringify(report)).not.toContain("ENOTFOUND");
  });

  it("serves a cached snapshot inside the TTL instead of fanning out again", async () => {
    const { service, repo } = make();
    await service.getReport("tenant-1");
    await service.getReport("tenant-1");
    service.onModuleDestroy();

    expect(repo.ping).toHaveBeenCalledTimes(1);
    expect(repo.studentCounts).toHaveBeenCalledTimes(1);
  });

  it("does not hand one tenant a snapshot cached for another", async () => {
    const { service, repo } = make();
    await service.getReport("tenant-1");
    await service.getReport("tenant-2");
    service.onModuleDestroy();

    expect(repo.studentCounts).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent callers into one check", async () => {
    const { service, repo } = make();
    await Promise.all([service.getReport("tenant-1"), service.getReport("tenant-1"), service.getReport("tenant-1")]);
    service.onModuleDestroy();

    expect(repo.ping).toHaveBeenCalledTimes(1);
  });
});
