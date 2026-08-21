// apps/api/src/modules/auth/lib/scope-context.spec.ts
//
// Wave 6 security-audit hardening: proves the fail-closed contract on the scope-context
// ALS, a missing scope context must never be silently treated as unscoped/"all" access.

import {
  getScopeContext,
  requireScopeContext,
  scopeContextStorage,
  ScopeContextMissingError,
  type ScopeContext,
} from "./scope-context";

describe("scope-context (fail-closed contract, Wave 6)", () => {
  const ctx: ScopeContext = {
    permissionKey: "students.read",
    scope: "branch",
    actorId: "actor-1",
    tenantId: "tenant-1",
  };

  it("getScopeContext returns undefined outside any .run() scope", () => {
    expect(getScopeContext()).toBeUndefined();
  });

  it("getScopeContext returns the active context inside .run()", () => {
    scopeContextStorage.run(ctx, () => {
      expect(getScopeContext()).toEqual(ctx);
    });
  });

  it("requireScopeContext throws ScopeContextMissingError when no context is active (fail-closed)", () => {
    expect(() => requireScopeContext()).toThrow(ScopeContextMissingError);
  });

  it("requireScopeContext never returns a default/'all' scope when the context is missing", () => {
    let thrown: unknown;
    try {
      requireScopeContext();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScopeContextMissingError);
    // Explicitly assert there is no silent fallback object resembling an "all" scope.
    expect(thrown).not.toMatchObject({ scope: "all" });
  });

  it("requireScopeContext returns the active context when one is present", () => {
    scopeContextStorage.run(ctx, () => {
      expect(requireScopeContext()).toEqual(ctx);
    });
  });
});
