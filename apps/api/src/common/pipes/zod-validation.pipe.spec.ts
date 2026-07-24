// apps/api/src/common/pipes/zod-validation.pipe.spec.ts
//
// Unit coverage for the Phase 1 HIGH defect fix: a method-level `@UsePipes(new
// ZodValidationPipe(schema))` runs for every resolved parameter on the handler, including
// custom-decorator parameters such as `@CurrentUser()`. Those carry
// `metadata.type === "custom"` and must pass through unvalidated; `body`/`query`/`param`
// parameters must still be validated against the schema as before.

import type { ArgumentMetadata } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const CreateStudentRequestSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

function metadata(type: ArgumentMetadata["type"]): ArgumentMetadata {
  return { type, metatype: undefined, data: undefined };
}

describe("ZodValidationPipe", () => {
  it("passes a custom-decorator parameter (e.g. @CurrentUser()) through untouched", () => {
    const pipe = new ZodValidationPipe(CreateStudentRequestSchema);
    const requestUser = {
      id: "user-1",
      tenantId: "tenant-1",
      roles: ["admin"],
      permissions: ["students.create"],
    };

    const result = pipe.transform(requestUser, metadata("custom"));

    expect(result).toBe(requestUser);
  });

  it("validates a body parameter against the schema and returns the parsed value", () => {
    const pipe = new ZodValidationPipe(CreateStudentRequestSchema);
    const body = { name: "Asha Rao", email: "asha@example.com" };

    const result = pipe.transform(body, metadata("body"));

    expect(result).toEqual(body);
  });

  it("rejects an invalid body parameter with a BadRequestException", () => {
    const pipe = new ZodValidationPipe(CreateStudentRequestSchema);
    const body = { name: "Asha Rao", email: "not-an-email" };

    expect(() => pipe.transform(body, metadata("body"))).toThrow(BadRequestException);
  });

  it("still validates a query parameter against the schema (parameter-scoped usage)", () => {
    const ListQuerySchema = z.object({ page: z.coerce.number().int().min(1) });
    const pipe = new ZodValidationPipe(ListQuerySchema);

    const result = pipe.transform({ page: "2" }, metadata("query"));

    expect(result).toEqual({ page: 2 });
  });

  it("passes a @Param() path segment through untouched when bound at the method level alongside a body schema", () => {
    // Reproduces the second defect class: POST :id/modules combines a method-level
    // @UsePipes(CreateModuleRequestSchema) with @Param("id", new ParseUUIDPipe()) — the
    // path param's UUID string must never be run through the body schema.
    const pipe = new ZodValidationPipe(CreateStudentRequestSchema);
    const programId = "ab6c0b9d-3b3f-4c73-ade2-48efbf354afc";

    const result = pipe.transform(programId, metadata("param"));

    expect(result).toBe(programId);
  });

  it("would have rejected a @CurrentUser() payload as 'Unrecognized key(s)' before the fix (regression guard)", () => {
    // Sanity check that the schema itself is strict enough to reproduce the original bug
    // if the metadata.type guard were ever removed — i.e. this proves the test is
    // actually exercising the bug class, not a no-op schema.
    const strictSchema = CreateStudentRequestSchema.strict();
    const requestUser = {
      id: "user-1",
      tenantId: "tenant-1",
      roles: ["admin"],
      permissions: ["students.create"],
    };

    expect(strictSchema.safeParse(requestUser).success).toBe(false);

    const pipe = new ZodValidationPipe(strictSchema);
    expect(pipe.transform(requestUser, metadata("custom"))).toBe(requestUser);
  });
});
