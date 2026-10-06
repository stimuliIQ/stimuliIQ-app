import { describe, expect, it } from "vitest";
import { rollUpSystemHealth, type SystemHealthStatus } from "./system-health.schemas";

const c = (key: string, status: SystemHealthStatus, name = key) => ({ key, name, status });

describe("rollUpSystemHealth", () => {
  it("is healthy when everything is healthy or simply not in use", () => {
    const r = rollUpSystemHealth([c("api", "healthy"), c("postgres", "healthy"), c("sms", "unknown")]);
    expect(r.status).toBe("healthy");
    expect(r.headline).toBe("All systems operational");
    expect(r.unknownCount).toBe(1);
  });

  it("is an outage only when a critical component is down", () => {
    for (const key of ["api", "postgres", "redis"]) {
      expect(rollUpSystemHealth([c(key, "down", key.toUpperCase()), c("web", "healthy")]).status).toBe("down");
    }
  });

  it("is merely degraded when a non-critical component is down", () => {
    const r = rollUpSystemHealth([c("api", "healthy"), c("lms", "down", "LMS")]);
    expect(r.status).toBe("degraded");
    expect(r.headline).toBe("Degraded: LMS");
  });

  it("is degraded when a critical component is only slow", () => {
    expect(rollUpSystemHealth([c("postgres", "degraded", "PostgreSQL")]).status).toBe("degraded");
  });

  it("names every outage in the headline and counts each status", () => {
    const r = rollUpSystemHealth([
      c("postgres", "down", "PostgreSQL"),
      c("redis", "down", "Redis"),
      c("web", "degraded"),
    ]);
    expect(r.headline).toBe("Outage: PostgreSQL, Redis");
    expect(r).toMatchObject({ downCount: 2, degradedCount: 1, healthyCount: 0 });
  });

  it("reports healthy for an empty list rather than throwing", () => {
    expect(rollUpSystemHealth([]).status).toBe("healthy");
  });
});
