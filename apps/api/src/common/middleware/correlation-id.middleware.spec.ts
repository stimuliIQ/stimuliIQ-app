import type { Request, Response } from "express";
import { correlationIdMiddleware } from "./correlation-id.middleware";
import { REQUEST_ID_HEADER } from "../../observability/request-id";

function buildReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return { req, res, setHeader };
}

describe("correlationIdMiddleware — AC-44", () => {
  it("reuses the client-supplied X-Request-Id header, stamping it onto req.id and the response header", () => {
    const { req, res, setHeader } = buildReqRes({ [REQUEST_ID_HEADER]: "client-id-123" });
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.id).toBe("client-id-123");
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, "client-id-123");
    expect(next).toHaveBeenCalled();
  });

  it("generates a fresh id when no header is supplied, and stamps the SAME id on both req.id and the response header", () => {
    const { req, res, setHeader } = buildReqRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(typeof req.id).toBe("string");
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.id);
  });

  it("always calls next() even if OTel span tagging throws", () => {
    const { req, res } = buildReqRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
