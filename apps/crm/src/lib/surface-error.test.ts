import { describe, expect, it, vi } from "vitest";
import type { ProblemDetails } from "@repo/types";

import { errorCode, errorStatus, queryErrorMessage, surfaceError } from "./surface-error";

function apiError(problem: Partial<ProblemDetails> & { status: number; code: string }): { problem: ProblemDetails } {
  return {
    problem: {
      type: `https://docs.stimuliiq.com/errors/${problem.code}`,
      title: problem.title ?? "Request failed",
      ...problem,
    } as ProblemDetails,
  };
}

describe("queryErrorMessage", () => {
  it("names the offending fields instead of only saying validation failed", () => {
    // The shape the API's ZodValidationPipe actually sends. Before this, the whole message
    // was the first sentence and the staff member had no way to know which row to fix.
    const message = queryErrorMessage(
      apiError({
        status: 400,
        code: "validation.failed",
        title: "Validation failed",
        detail: "One or more fields failed validation.",
        errors: [
          { path: "body.grants.3.permissionKey", message: "must be dot-separated lowercase segments" },
          { path: "body.name", message: "Required" },
        ],
      }),
    );

    expect(message).toContain("One or more fields failed validation.");
    expect(message).toContain("grants › 4 › permissionKey: must be dot-separated lowercase segments");
    expect(message).toContain("name: Required");
  });

  it("collapses a long list of field errors instead of flooding the toast", () => {
    const message = queryErrorMessage(
      apiError({
        status: 400,
        code: "validation.failed",
        detail: "One or more fields failed validation.",
        errors: Array.from({ length: 7 }, (_, i) => ({ path: `body.field${i}`, message: "Required" })),
      }),
    );

    expect(message).toContain("field0: Required");
    expect(message).toContain("(+3 more)");
  });

  it("tells the reader what to do about a 403 rather than inviting a pointless retry", () => {
    const message = queryErrorMessage(apiError({ status: 403, code: "rbac.forbidden", title: "Forbidden" }));
    expect(message).toBe("You don't have permission to do this. Ask an admin to grant it to your role.");
  });

  it("keeps the server's own explanation when it has one", () => {
    const message = queryErrorMessage(
      apiError({
        status: 403,
        code: "roles.privilege_escalation",
        title: "Cannot grant a permission you do not hold",
        detail: 'You cannot grant "students.delete" because you do not hold it yourself.',
      }),
    );
    expect(message).toBe('You cannot grant "students.delete" because you do not hold it yourself.');
  });

  it("distinguishes an expired session from a server fault", () => {
    expect(queryErrorMessage(apiError({ status: 401, code: "auth.unauthenticated" }))).toContain("session has expired");
    expect(queryErrorMessage(apiError({ status: 500, code: "http.internal_error" }))).toContain("Nothing was saved");
  });

  it("carries the trace id on a 5xx, and only on a 5xx", () => {
    expect(queryErrorMessage(apiError({ status: 500, code: "http.internal_error", traceId: "abc-123" }))).toContain(
      "Reference: abc-123",
    );
    expect(queryErrorMessage(apiError({ status: 404, code: "students.not_found", traceId: "abc-123" }))).not.toContain(
      "abc-123",
    );
  });

  it("passes through the network-error detail the client builds when the API is unreachable", () => {
    const message = queryErrorMessage(
      apiError({
        status: 0,
        code: "http.network_error",
        title: "Network error",
        detail: "We couldn't reach the server (Failed to fetch). Check your connection and that the API is running.",
      }),
    );
    expect(message).toContain("couldn't reach the server");
  });

  it("replaces transport jargon with something the reader can act on", () => {
    const message = queryErrorMessage(
      apiError({
        status: 401,
        code: "auth.csrf_mismatch",
        title: "CSRF token missing or invalid",
        detail: "X-CSRF-Token header must match the csrf_token cookie on unsafe requests.",
      }),
    );
    expect(message).toBe("Your session has expired. Sign in again and retry.");
    expect(message).not.toContain("X-CSRF-Token");
  });

  it("falls back to the caller's context only when the error explains nothing", () => {
    expect(queryErrorMessage({}, "Something went wrong fetching the branch list.")).toBe(
      "Something went wrong fetching the branch list.",
    );
    expect(queryErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });
});

describe("errorCode / errorStatus", () => {
  it("reads the stable machine-readable handles", () => {
    const error = apiError({ status: 409, code: "students.email_in_use" });
    expect(errorCode(error)).toBe("students.email_in_use");
    expect(errorStatus(error)).toBe(409);
    expect(errorCode(new Error("boom"))).toBeUndefined();
  });
});

describe("surfaceError", () => {
  it("shows the specific message, not just the caller's title", () => {
    const toast = vi.fn();
    surfaceError(
      toast,
      apiError({ status: 409, code: "batches.capacity_full", detail: "This batch is already at capacity." }),
      "Couldn't enrol the student",
    );

    expect(toast).toHaveBeenCalledWith({
      title: "Couldn't enrol the student",
      description: "This batch is already at capacity.",
      variant: "destructive",
    });
  });
});
