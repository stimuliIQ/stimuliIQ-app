// Regression test for the permission key pattern (see PERMISSION_KEY_PATTERN in
// common/primitives.ts).
//
// THE BUG THIS PINS DOWN: the key regex demanded EXACTLY `module.action`, but the seeded
// catalog has always contained three-segment keys. The CRM permission matrix renders those
// as ordinary toggles, and the save is a full replace of the role's grant set — so turning
// a single one of them on made the whole PUT 400 ("Couldn't save permissions — one or more
// fields failed validation") and the role could not be saved at all until it was toggled
// back off. Nothing named the offending field, on screen or in the API log.
//
// The deep keys below are copied from prisma/seed.ts and the phase seeds (leave, careers,
// onboarding); they are the exact keys the matrix offers.
import { describe, expect, it } from "vitest";

import { PermissionGrantSchema } from "../common/primitives.js";
import { PermissionCatalogEntrySchema, UpdateRolePermissionsRequestSchema } from "./admin.schemas.js";

const TWO_SEGMENT_KEYS = ["students.view", "students.edit", "course_types.manage", "submissions.grade"];

const THREE_SEGMENT_KEYS = [
  "reports.revenue.view",
  "reports.lead_performance.view",
  "leave.calendar.view",
  "careers.openings.manage",
  "onboarding.fields.manage",
  "mentor.dashboard.view",
  "dpdp.erasure.execute",
];

describe("UpdateRolePermissionsRequestSchema", () => {
  it("accepts the deep catalog keys the matrix lets an admin toggle", () => {
    for (const permissionKey of [...TWO_SEGMENT_KEYS, ...THREE_SEGMENT_KEYS]) {
      const result = UpdateRolePermissionsRequestSchema.safeParse({
        grants: [{ permissionKey, scope: "all" }],
      });
      expect(result.success, `${permissionKey} should be a valid permission key`).toBe(true);
    }
  });

  it("saves a whole grant set mixing two- and three-segment keys", () => {
    const result = UpdateRolePermissionsRequestSchema.safeParse({
      grants: [...TWO_SEGMENT_KEYS, ...THREE_SEGMENT_KEYS].map((permissionKey) => ({
        permissionKey,
        scope: "all" as const,
      })),
    });
    expect(result.success).toBe(true);
  });

  it("still rejects keys that are not dotted lowercase segments", () => {
    for (const permissionKey of ["students", "Students.view", "students..view", "students.view.", ".students.view"]) {
      const result = UpdateRolePermissionsRequestSchema.safeParse({
        grants: [{ permissionKey, scope: "all" }],
      });
      expect(result.success, `${permissionKey} should be rejected`).toBe(false);
    }
  });

  it("still rejects unknown fields (full-replace bodies are strict)", () => {
    const result = UpdateRolePermissionsRequestSchema.safeParse({
      grants: [{ permissionKey: "students.view", scope: "all" }],
      replaceAll: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("permission key shape, shared by the catalog and /me", () => {
  it("accepts a three-segment key in a catalog entry", () => {
    const result = PermissionCatalogEntrySchema.safeParse({
      key: "reports.revenue.view",
      module: "reports",
      action: "view",
      label: "View revenue reports",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a three-segment key in a resolved /me grant", () => {
    expect(PermissionGrantSchema.safeParse({ key: "leave.calendar.view", scope: "all" }).success).toBe(true);
  });
});
