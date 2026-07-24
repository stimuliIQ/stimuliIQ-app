// apps/api/src/modules/auth/guards/must-change-password.guard.spec.ts
//
// Unit tests for MustChangePasswordGuard (gap-closing pass — server-side enforcement of
// the first-login "must change password" gate, registered globally via APP_GUARD in
// app.module.ts). Mirrors the ExecutionContext-mocking style of
// auth-ip-rate-limit.guard.spec.ts.

import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { MustChangePasswordGuard } from "./must-change-password.guard";
import type { RequestUser } from "../lib/request-user";

function buildContext(opts: { user?: RequestUser } = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: opts.user }) }),
    getHandler: () => function handler() {},
    getClass: () => ({ name: "SomeController" }),
  } as unknown as ExecutionContext;
}

function baseUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return { id: "u1", tenantId: "t1", roles: ["student"], permissions: [], mustChangePassword: false, ...overrides };
}

describe("MustChangePasswordGuard", () => {
  it("allows when req.user is undefined (unauthenticated route / guard hasn't run yet)", () => {
    const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
    const guard = new MustChangePasswordGuard(reflector);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it("allows when req.user.mustChangePassword is false", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new MustChangePasswordGuard(reflector);

    expect(guard.canActivate(buildContext({ user: baseUser({ mustChangePassword: false }) }))).toBe(true);
  });

  it("allows when mustChangePassword is true but @SkipPasswordGate() metadata is present", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const guard = new MustChangePasswordGuard(reflector);

    expect(guard.canActivate(buildContext({ user: baseUser({ mustChangePassword: true }) }))).toBe(true);
  });

  it("blocks (403 auth.password_change_required) when mustChangePassword is true and NOT skipped", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new MustChangePasswordGuard(reflector);

    expect(() => guard.canActivate(buildContext({ user: baseUser({ mustChangePassword: true }) }))).toThrow(
      ForbiddenException,
    );

    try {
      guard.canActivate(buildContext({ user: baseUser({ mustChangePassword: true }) }));
      fail("expected ForbiddenException");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: "auth.password_change_required",
        title: "Password change required",
      });
    }
  });
});
