# ADR 0011: ZodValidationPipe metadata-type discriminator to skip custom/param arguments

## Status
Accepted

## Context
Phase-1 introduced NestJS modules with multiple route argument types per handler:
`@Body()` (the DTO to validate), `@Param()` (path parameters like `:id`), and
`@CurrentUser()` (a custom decorator that extracts the authenticated user from the
request object populated by a guard). All three appear in the same controller method
signature.

The Phase-0 implementation of `ZodValidationPipe` was registered at the **method
level** (via `@UsePipes`) or at the **global level** with the intent of validating
only the request body. During Phase-1 integration testing, a HIGH defect was found:
the pipe was also being invoked for `@Param` arguments (string path segments) and
`@CurrentUser` arguments (the user object from the guard) — neither of which should
be run through a Zod schema. The result was that all `POST /students`, `POST /faculty`,
and other create routes returned validation errors immediately, regardless of the
request body content.

## Decision
`ZodValidationPipe` reads `ArgumentMetadata.type` before attempting validation:
- `type === 'body'` → validate against the provided Zod schema. Throw `BadRequestException`
  with RFC-7807 error detail if validation fails.
- `type === 'query'` → validate if a schema is provided, pass through if not.
- `type === 'param'` → **skip validation, return the value unchanged**. Path params
  are simple strings (UUIDs, slugs); they are validated by the route guard (`ParseUUIDPipe`
  inline at the param level or by the service layer on lookup).
- `type === 'custom'` → **skip validation, return the value unchanged**. Custom
  decorators like `@CurrentUser()` inject objects produced by guards; they are already
  validated/guaranteed by the guard's contract, and no Zod schema is associated with
  them at the pipe level anyway.

This is the discriminator:
```typescript
if (metadata.type === 'custom' || metadata.type === 'param') {
  return value;
}
```

There is currently no handler that registers the `ZodValidationPipe` at method level
with a `@Query()` argument in the same handler. If one is added, the author must
confirm that a schema is supplied for the query argument or that passing through
unvalidated query params is intentional. This assumption is documented at the pipe's
call site and in the integration test suite.

## Consequences
- All CRM create/update routes that have a `@CurrentUser()` or `@Param()` in their
  signature work correctly — the pipe only runs against the body.
- The fix is minimal and localized to the pipe implementation; no controller changes
  were needed.
- The integration test suite (`qa-engineer`, Wave 5) includes a regression test that
  verifies create routes succeed with a valid body, covering this scenario.
- The assumption about `@Query()` + method-level pipe not coexisting without a schema
  is enforced by convention and the test suite, not by a compile-time check. A lint
  rule or pipe introspection could strengthen this if the pattern spreads.

## Alternatives considered
- **Global-level pipe registration only, never method-level**: would eliminate the
  ambiguity of which arguments get piped. Rejected — some routes legitimately need
  schema-per-method-level variation (e.g. different schemas for create vs. update
  bodies on routes that share a controller).
- **Require all custom decorators to attach schema metadata to the pipe call**: would
  make the pipe more explicit. Adds boilerplate to every `@CurrentUser()` usage.
  Rejected as unnecessary complexity since custom arguments carry no user-provided
  input that requires Zod validation.
