import type { Response } from "express";
import { MetricsController } from "./metrics.controller";
import { metricsRegistry } from "../../observability/metrics";

describe("MetricsController", () => {
  afterEach(() => metricsRegistry.reset());

  it("serves the registry's Prometheus text with the correct content type", () => {
    metricsRegistry.recordHttpRequest("GET", "/health", 200, 0.01);
    const controller = new MetricsController();
    const send = jest.fn();
    const type = jest.fn().mockReturnValue({ send });
    const status = jest.fn().mockReturnValue({ type });
    const res = { status } as unknown as Response;

    controller.scrape(res);

    expect(status).toHaveBeenCalledWith(200);
    expect(type).toHaveBeenCalledWith("text/plain; version=0.0.4; charset=utf-8");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("http_requests_total"));
  });
});
