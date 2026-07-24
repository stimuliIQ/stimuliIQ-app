// apps/api/src/common/middleware/csrf.middleware.spec.ts
//
// Unit coverage for the Wave 6 security-audit remediation (M-3): proves the double-submit
// compare still accepts matching tokens and rejects mismatches/missing tokens, including
// the case the plain `!==` version handled identically (different lengths) and the case
// most likely to regress when swapping to `timingSafeEqual` (equal-length mismatches,
// which `timingSafeEqual` itself can compare directly without throwing).

import { UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfMiddleware } from "./csrf.middleware";
import { CSRF_TOKEN_COOKIE } from "../../modules/auth/lib/cookies";

function buildRequest(overrides: {
  method?: string;
  originalUrl?: string;
  cookies?: Record<string, string>;
  header?: (name: string) => string | undefined;
}): Request {
  return {
    method: "POST",
    originalUrl: "/api/v1/auth/refresh",
    cookies: {},
    header: () => undefined,
    ...overrides,
  } as unknown as Request;
}

describe("CsrfMiddleware (timing-safe compare, M-3)", () => {
  let middleware: CsrfMiddleware;
  const next = jest.fn();
  const res = {} as Response;

  beforeEach(() => {
    middleware = new CsrfMiddleware();
    next.mockClear();
  });

  it("passes through when the header token equals the cookie token", () => {
    const token = "a".repeat(43);
    const req = buildRequest({
      cookies: { [CSRF_TOKEN_COOKIE]: token },
      header: (name: string) => (name === "X-CSRF-Token" ? token : undefined),
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects equal-length but differing tokens", () => {
    const cookieToken = "a".repeat(43);
    const headerToken = "b".repeat(43);
    const req = buildRequest({
      cookies: { [CSRF_TOKEN_COOKIE]: cookieToken },
      header: (name: string) => (name === "X-CSRF-Token" ? headerToken : undefined),
    });

    expect(() => middleware.use(req, res, next)).toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects differing-length tokens without throwing on the comparison itself", () => {
    const req = buildRequest({
      cookies: { [CSRF_TOKEN_COOKIE]: "short" },
      header: (name: string) => (name === "X-CSRF-Token" ? "a-much-longer-header-token" : undefined),
    });

    expect(() => middleware.use(req, res, next)).toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when the header token is missing", () => {
    const req = buildRequest({
      cookies: { [CSRF_TOKEN_COOKIE]: "a".repeat(43) },
      header: () => undefined,
    });

    expect(() => middleware.use(req, res, next)).toThrow(UnauthorizedException);
  });

  it("skips the check entirely for exempt auth-bootstrap routes", () => {
    const req = buildRequest({
      originalUrl: "/api/v1/auth/login",
      cookies: {},
      header: () => undefined,
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("skips the check entirely for safe methods (GET)", () => {
    const req = buildRequest({
      method: "GET",
      cookies: {},
      header: () => undefined,
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
