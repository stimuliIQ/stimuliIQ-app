// Typed error thrown by the SDK whenever the API returns a non-2xx response
// or the envelope's `error` field is populated. Wraps the RFC-7807
// problem-details body from @repo/types so callers get a structured object
// instead of parsing strings.

import type { ProblemDetails } from "@repo/types";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.problem = problem;
  }

  /** True for 401 — the seam the frontend's refresh-and-retry hook checks for. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True for 403 — RBAC/scope denial; UI should hide the action, not retry. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}
