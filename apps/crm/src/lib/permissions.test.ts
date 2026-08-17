// Scope-aware permission gating.
//
// Holding a permission key is not the same as being able to use it. Faculty hold
// `courses.view` at scope `assigned`, but courses.service.ts serves only scope `all` and
// 403s the rest fail-closed, because `programs` has no author column to resolve "assigned"
// against. Gating the nav on the key alone put a Courses item in faculty's sidebar that
// could only ever lead to an error screen.
import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@repo/types";

import { hasPermission, hasPermissionAtScope } from "./permissions";

const FACULTY: PermissionGrant[] = [
  { key: "courses.view", scope: "assigned" },
  { key: "students.view", scope: "assigned" },
];

const ADMIN: PermissionGrant[] = [
  { key: "courses.view", scope: "all" },
  { key: "students.view", scope: "all" },
];

describe("hasPermissionAtScope", () => {
  it("accepts the key at a listed scope", () => {
    expect(hasPermissionAtScope(ADMIN, "courses.view", ["all"])).toBe(true);
  });

  // The exact case that produced the faculty 403s.
  it("rejects the key at a scope the module cannot serve", () => {
    expect(hasPermissionAtScope(FACULTY, "courses.view", ["all"])).toBe(false);
    // …while the plain check still passes, which is precisely why it was the wrong gate.
    expect(hasPermission(FACULTY, "courses.view")).toBe(true);
  });

  it("accepts any of several listed scopes", () => {
    expect(hasPermissionAtScope(FACULTY, "courses.view", ["all", "assigned"])).toBe(true);
  });

  it("is false for a key the user does not hold at all", () => {
    expect(hasPermissionAtScope(ADMIN, "courses.delete", ["all"])).toBe(false);
  });

  it("handles undefined permissions without throwing", () => {
    expect(hasPermissionAtScope(undefined, "courses.view", ["all"])).toBe(false);
  });

  it("does not match on scope alone", () => {
    expect(hasPermissionAtScope(ADMIN, "billing.view", ["all"])).toBe(false);
  });
});
