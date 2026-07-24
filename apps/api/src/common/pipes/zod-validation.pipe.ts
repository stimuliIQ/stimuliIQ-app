// apps/api/src/common/pipes/zod-validation.pipe.ts
//
// Global validation boundary (CLAUDE.md §3.2: "validation at every boundary with zod").
// Applied per-route via `@UsePipes(new ZodValidationPipe(SomeRequestSchema))` (Nest's
// built-in ValidationPipe is class-validator-based and not used here — every DTO in
// @repo/types is a zod schema, so this pipe is the one true validator). On failure,
// throws a BadRequestException whose response body already matches the `errors` field
// shape ProblemDetailsSchema expects, so the global exception filter can pass it through
// with no shape translation.
//
// IMPORTANT: when this pipe is bound at the METHOD level via `@UsePipes(...)`, Nest runs
// it for EVERY resolved parameter on the handler (in addition to any parameter-scoped
// pipes that parameter also carries) — not just the one parameter the schema was written
// for. Two parameter kinds are affected:
//   - Custom param decorators (e.g. `@CurrentUser()`) carry `metadata.type === "custom"`.
//     Running these through a body/create DTO schema is the bug class that caused every
//     create route mixing `@UsePipes` + `@CurrentUser()` to 400 with "Unrecognized
//     key(s) ... 'id','tenantId','roles','permissions'".
//   - `@Param(...)` arguments carry `metadata.type === "param"`. Routes that combine a
//     method-level create-body `@UsePipes` with a path param (e.g.
//     `POST :id/modules` → `@Param("id", new ParseUUIDPipe())` + a method-level
//     `@UsePipes(new ZodValidationPipe(CreateModuleRequestSchema))`) would otherwise run
//     the path param's UUID string through the *body* schema first (Nest concatenates
//     method-level pipes before parameter-level ones — see
//     `RouterExecutionContext.createPipesFn`), which always fails since a UUID string is
//     never a valid `CreateModuleRequestSchema` object — this is a second, related defect
//     class, not just `@CurrentUser()`.
// Every method-level `@UsePipes(new ZodValidationPipe(...))` usage in this codebase
// targets a `@Body()` create-request schema (confirmed by grep across
// apps/api/src/modules) — none target `query`/`param` at the method level, and no
// `@Param()` anywhere uses `ZodValidationPipe` directly. So the correct, durable
// discriminator is: only validate `body`-type parameters; pass through `custom` AND
// `param` untouched. `query`-type parameters validated via the (already
// parameter-scoped) `@Query(new ZodValidationPipe(...))` pattern continue to work
// unchanged, since that usage's `metadata.type` is also `"query"`, not the case we skip.

import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Custom param decorators (e.g. @CurrentUser()) and @Param() path segments must pass
    // through untouched when this pipe runs at the method level — neither is the
    // body/query payload this schema is meant to validate. See file header for why
    // `query` is intentionally NOT in this skip list.
    if (metadata.type === "custom" || metadata.type === "param") {
      return value;
    }

    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      throw new BadRequestException({
        code: "validation.failed",
        title: "Validation failed",
        detail: "One or more fields failed validation.",
        errors,
      });
    }

    return result.data;
  }
}
