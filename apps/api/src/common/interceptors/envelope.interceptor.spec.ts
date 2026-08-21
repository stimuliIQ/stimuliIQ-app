import { ExecutionContext, CallHandler } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { of, firstValueFrom } from "rxjs";
import { EnvelopeInterceptor } from "./envelope.interceptor";
import { PaginatedResult, ResultWithMeta } from "../dto/paginated-result";

function buildContext(): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe("EnvelopeInterceptor", () => {
  it("wraps a plain DTO in {data, meta, error} by default", async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new EnvelopeInterceptor(reflector);
    const handler: CallHandler = { handle: () => of({ id: "abc" }) };

    const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

    expect(result).toEqual({ data: { id: "abc" }, meta: null, error: null });
  });

  it("unwraps a PaginatedResult into {data: items, meta}", async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new EnvelopeInterceptor(reflector);
    const paginated = new PaginatedResult([{ id: "1" }], { page: 1, pageSize: 20, total: 1, hasMore: false });
    const handler: CallHandler = { handle: () => of(paginated) };

    const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

    expect(result).toEqual({ data: [{ id: "1" }], meta: paginated.meta, error: null });
  });

  // Regression: GET /me/attendance used to return a hand-rolled `{ data, meta }`,
  // which this interceptor wrapped a SECOND time. The wire shape became
  // `data.data.summaries`, so the SDK read `summaries` as undefined and the LMS
  // /progress page crashed with "Cannot read properties of undefined (reading 'length')".
  it("unwraps a ResultWithMeta into {data: payload, meta} WITHOUT double-nesting", async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const interceptor = new EnvelopeInterceptor(reflector);
    const payload = { items: [{ id: "1" }], summaries: [{ enrollmentId: "e1", attendancePct: 80 }] };
    const meta = { page: 1, pageSize: 20, total: 1, hasMore: false };
    const handler: CallHandler = { handle: () => of(new ResultWithMeta(payload, meta)) };

    const result = (await firstValueFrom(
      interceptor.intercept(buildContext(), handler),
    )) as { data: typeof payload };

    expect(result).toEqual({ data: payload, meta, error: null });
    // The structured payload must sit directly under `data`, not `data.data`.
    expect(result.data.summaries).toHaveLength(1);
  });

  it("passes the return value through UNCHANGED when @SkipEnvelope() metadata is present", async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const interceptor = new EnvelopeInterceptor(reflector);
    const handler: CallHandler = { handle: () => of({ status: "ok" }) };

    const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

    expect(result).toEqual({ status: "ok" });
  });

  it("defaults to a real Reflector when constructed with no args (back-compat with `new EnvelopeInterceptor()`)", async () => {
    const interceptor = new EnvelopeInterceptor();
    const handler: CallHandler = { handle: () => of({ x: 1 }) };

    const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

    expect(result).toEqual({ data: { x: 1 }, meta: null, error: null });
  });
});
