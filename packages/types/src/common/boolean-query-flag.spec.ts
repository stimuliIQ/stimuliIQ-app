// Regression tests for BooleanQueryFlagSchema and the `includeDeleted` filters that use it.
//
// The bug this locks down: `z.coerce.boolean()` is `Boolean(value)`, and a query string
// only ever carries strings, so "false" parsed as `true`. `toQueryString`
// (@repo/api-client) always serializes the flag explicitly — `{ includeDeleted: false }`
// becomes `?includeDeleted=false` — so every CRM list request turned the soft-delete
// filter ON. Soft-deleted faculty/students/batches/courses/mentors were listed, while the
// matching detail route (which filters `deletedAt: null` unconditionally) answered 404 for
// the very same row a user had just clicked.
import { describe, expect, it } from "vitest";
import { BooleanQueryFlagSchema } from "./primitives.js";
import { ListFacultyQuerySchema } from "../crm/faculty.schemas.js";
import { ListStudentsQuerySchema } from "../crm/students.schemas.js";

describe("BooleanQueryFlagSchema", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["1", false],
    ["", false],
    ["yes", false],
  ])("parses the query string %j as %s", (input, expected) => {
    expect(BooleanQueryFlagSchema.parse(input)).toBe(expected);
  });

  it("passes real booleans through untouched", () => {
    expect(BooleanQueryFlagSchema.parse(true)).toBe(true);
    expect(BooleanQueryFlagSchema.parse(false)).toBe(false);
  });

  it("rejects non-string, non-boolean input rather than silently coercing", () => {
    expect(BooleanQueryFlagSchema.safeParse(1).success).toBe(false);
    expect(BooleanQueryFlagSchema.safeParse(null).success).toBe(false);
    expect(BooleanQueryFlagSchema.safeParse({}).success).toBe(false);
  });
});

describe("includeDeleted list filters", () => {
  const schemas = [
    ["faculty", ListFacultyQuerySchema],
    ["students", ListStudentsQuerySchema],
  ] as const;

  it.each(schemas)(
    "%s: ?includeDeleted=false does NOT include soft-deleted rows",
    (_name, schema) => {
      const parsed = schema.parse({ page: "1", pageSize: "20", includeDeleted: "false" });
      expect(parsed.includeDeleted).toBe(false);
    },
  );

  it.each(schemas)("%s: ?includeDeleted=true still opts in", (_name, schema) => {
    const parsed = schema.parse({ page: "1", pageSize: "20", includeDeleted: "true" });
    expect(parsed.includeDeleted).toBe(true);
  });

  it.each(schemas)("%s: omitting the flag defaults to false", (_name, schema) => {
    const parsed = schema.parse({ page: "1", pageSize: "20" });
    expect(parsed.includeDeleted).toBe(false);
  });
});
