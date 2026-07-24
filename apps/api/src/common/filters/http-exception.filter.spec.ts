import { ArgumentsHost, HttpException, HttpStatus, InternalServerErrorException } from "@nestjs/common";
import { HttpExceptionFilter } from "./http-exception.filter";

jest.mock("../../observability/sentry", () => ({
  captureException: jest.fn(),
}));

const { captureException } = jest.requireMock("../../observability/sentry") as {
  captureException: jest.Mock;
};

function buildHost(reqId: string, opts: { originalUrl?: string } = {}): { host: ArgumentsHost; res: { status: jest.Mock; json: jest.Mock } } {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const req = { id: reqId, originalUrl: opts.originalUrl ?? "/api/v1/whatever" };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe("HttpExceptionFilter — AC-44/AC-45 (traceId + RFC-7807) + AC-43 (Sentry 5xx capture)", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("echoes req.id as `traceId` in the RFC-7807 body", () => {
    const filter = new HttpExceptionFilter();
    const { host, res } = buildHost("req-abc-123");

    filter.catch(new HttpException({ code: "auth.unauthenticated", title: "Auth required" }, HttpStatus.UNAUTHORIZED), host);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ traceId: "req-abc-123" }) }),
    );
  });

  it("returns a consistent RFC-7807 shape (type/title/status/detail/code) for any thrown error", () => {
    const filter = new HttpExceptionFilter();
    const { host, res } = buildHost("req-1");

    filter.catch(new InternalServerErrorException(), host);

    const body = res.json.mock.calls[0][0];
    expect(body.error).toEqual(
      expect.objectContaining({
        type: expect.any(String),
        title: expect.any(String),
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: expect.any(String),
      }),
    );
  });

  it("reports to Sentry when the response status is 5xx", () => {
    const filter = new HttpExceptionFilter();
    const { host } = buildHost("req-2");
    const err = new InternalServerErrorException();

    filter.catch(err, host);

    expect(captureException).toHaveBeenCalledWith(err);
  });

  it("does NOT report to Sentry for a 4xx client error", () => {
    const filter = new HttpExceptionFilter();
    const { host } = buildHost("req-3");

    filter.catch(new HttpException({ code: "auth.unauthenticated", title: "x" }, HttpStatus.UNAUTHORIZED), host);

    expect(captureException).not.toHaveBeenCalled();
  });

  it("also reports an unclassified (non-HttpException) thrown error, which maps to 500", () => {
    const filter = new HttpExceptionFilter();
    const { host, res } = buildHost("req-4");

    filter.catch(new Error("unexpected"), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captureException).toHaveBeenCalled();
  });
});
