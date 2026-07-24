import { HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { HealthController } from "./health.controller";
import type { HealthService } from "./health.service";

function buildController(health: Partial<HealthService>): HealthController {
  return new HealthController(health as HealthService);
}

function mockResponse(): Response {
  return { status: jest.fn().mockReturnThis() } as unknown as Response;
}

describe("HealthController", () => {
  describe("GET /health (liveness) — AC-41", () => {
    it("returns ONLY {status:'ok'} — no extra fields (Rule H-3 leak-safety)", () => {
      const controller = buildController({ liveness: () => ({ status: "ok" }) });

      const result = controller.liveness();

      expect(result).toEqual({ status: "ok" });
      expect(Object.keys(result)).toEqual(["status"]);
    });
  });

  describe("GET /health/ready (readiness) — AC-42", () => {
    it("returns HTTP 200 + status ok when DB and Redis are both healthy", async () => {
      const controller = buildController({
        readiness: async () => ({ healthy: true, body: { status: "ok", db: "ok", redis: "ok" } }),
      });
      const res = mockResponse();

      const body = await controller.readiness(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(body).toEqual({ status: "ok", db: "ok", redis: "ok" });
    });

    it("returns HTTP 503 when a dependency is down, and the body stays leak-safe", async () => {
      const controller = buildController({
        readiness: async () => ({ healthy: false, body: { status: "degraded", db: "down", redis: "ok" } }),
      });
      const res = mockResponse();

      const body = await controller.readiness(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body).toEqual({ status: "degraded", db: "down", redis: "ok" });

      // Rule H-3: never a package version, stack trace, hostname, connection string, or
      // env var name/value in the response body.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/version|stack|hostname|connection|DATABASE_URL|REDIS_URL/i);
    });

    it("returns HTTP 503 when BOTH dependencies are down", async () => {
      const controller = buildController({
        readiness: async () => ({ healthy: false, body: { status: "degraded", db: "down", redis: "down" } }),
      });
      const res = mockResponse();

      const body = await controller.readiness(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body).toEqual({ status: "degraded", db: "down", redis: "down" });
    });
  });
});
