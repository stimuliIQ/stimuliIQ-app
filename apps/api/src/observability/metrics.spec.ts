import { metricsRegistry } from "./metrics";

describe("metricsRegistry, RED/USE Prometheus text exposition", () => {
  afterEach(() => {
    metricsRegistry.reset();
  });

  it("renders a request_total counter line per method+route+status", () => {
    metricsRegistry.recordHttpRequest("GET", "/crm/students/:id", 200, 0.05);
    metricsRegistry.recordHttpRequest("GET", "/crm/students/:id", 200, 0.05);
    metricsRegistry.recordHttpRequest("GET", "/crm/students/:id", 500, 0.9);

    const text = metricsRegistry.renderPrometheusText();

    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{method="GET",route="/crm/students/:id",status="200"} 2');
    expect(text).toContain('http_requests_total{method="GET",route="/crm/students/:id",status="500"} 1');
  });

  it("renders duration histogram buckets, sum, and count", () => {
    metricsRegistry.recordHttpRequest("GET", "/health", 200, 0.02);

    const text = metricsRegistry.renderPrometheusText();

    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
    expect(text).toMatch(/http_request_duration_seconds_bucket\{method="GET",route="\/health",le="0.05"\} 1/);
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/health"} 1');
    expect(text).toContain('http_request_duration_seconds_sum{method="GET",route="/health"} 0.02');
  });

  it("tracks in-flight requests as a gauge", () => {
    metricsRegistry.incInFlight();
    metricsRegistry.incInFlight();
    metricsRegistry.decInFlight();

    const text = metricsRegistry.renderPrometheusText();

    expect(text).toContain("# TYPE http_requests_in_flight gauge");
    expect(text).toContain("http_requests_in_flight 1");
  });

  it("in-flight gauge never goes negative", () => {
    metricsRegistry.decInFlight();
    metricsRegistry.decInFlight();

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain("http_requests_in_flight 0");
  });

  it("escapes label values that contain quotes/backslashes", () => {
    metricsRegistry.recordHttpRequest("GET", '/weird"route', 200, 0.01);

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain('route="/weird\\"route"');
  });

  it("reset() clears all counters, no cross-test leakage", () => {
    metricsRegistry.recordHttpRequest("GET", "/x", 200, 0.01);
    metricsRegistry.reset();

    const text = metricsRegistry.renderPrometheusText();
    expect(text).not.toContain("http_requests_total{");
  });
});
