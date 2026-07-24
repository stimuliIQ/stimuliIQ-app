import { ExecutionContext, CallHandler } from "@nestjs/common";
import { of, throwError, firstValueFrom } from "rxjs";
import { MetricsInterceptor } from "./metrics.interceptor";
import { metricsRegistry } from "../../observability/metrics";

function buildContext(opts: { method?: string; routePath?: string; path?: string; statusCode?: number }): ExecutionContext {
  const req = { method: opts.method ?? "GET", route: opts.routePath ? { path: opts.routePath } : undefined, path: opts.path };
  const res = { statusCode: opts.statusCode ?? 200 };
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe("MetricsInterceptor", () => {
  afterEach(() => {
    metricsRegistry.reset();
  });

  it("records a request on success using the matched Express route pattern", async () => {
    const interceptor = new MetricsInterceptor();
    const context = buildContext({ method: "GET", routePath: "/crm/students/:id", statusCode: 200 });
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await firstValueFrom(interceptor.intercept(context, handler));

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain('http_requests_total{method="GET",route="/crm/students/:id",status="200"} 1');
  });

  it("records the error status and rethrows on failure", async () => {
    const interceptor = new MetricsInterceptor();
    const context = buildContext({ method: "POST", routePath: "/crm/exports", statusCode: 200 });
    const err = { getStatus: () => 403 };
    const handler: CallHandler = { handle: () => throwError(() => err) };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBe(err);

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain('http_requests_total{method="POST",route="/crm/exports",status="403"} 1');
  });

  it("defaults an unclassified error to status 500", async () => {
    const interceptor = new MetricsInterceptor();
    const context = buildContext({ method: "GET", routePath: "/boom" });
    const handler: CallHandler = { handle: () => throwError(() => new Error("kaboom")) };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toThrow("kaboom");

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain('http_requests_total{method="GET",route="/boom",status="500"} 1');
  });

  it("collapses unmatched-route ids (UUID/numeric) to avoid unbounded cardinality", async () => {
    const interceptor = new MetricsInterceptor();
    const context = buildContext({
      method: "GET",
      path: "/crm/students/550e8400-e29b-41d4-a716-446655440000/profile",
      statusCode: 404,
    });
    const handler: CallHandler = { handle: () => of(null) };

    await firstValueFrom(interceptor.intercept(context, handler));

    const text = metricsRegistry.renderPrometheusText();
    expect(text).toContain('route="/crm/students/:id/profile"');
    expect(text).not.toContain("550e8400");
  });

  it("skips non-HTTP execution contexts (e.g. RPC/WS) without throwing", async () => {
    const interceptor = new MetricsInterceptor();
    const context = { getType: () => "rpc" } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of("ok") };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).resolves.toBe("ok");
  });
});
