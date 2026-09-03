// Shared RFC-7807 Problem Details error→message surfacer. EVERY user-facing error in the
// CRM should come through here — toasts, inline banners, and the "couldn't load" states on
// lists and drawers — so staff get one consistent, specific explanation instead of each
// screen inventing its own.
//
// WHY THIS EXISTS IN ITS CURRENT FORM. Two failures kept reaching real users:
//
//  1. FIELD ERRORS WERE THROWN AWAY. The API's ZodValidationPipe answers a bad payload with
//     `detail: "One or more fields failed validation."` PLUS an `errors[]` array naming the
//     offending fields. Every caller read `detail` and dropped `errors`, so the entire
//     screen said "One or more fields failed validation" and nothing said WHICH field —
//     unactionable, and worse on a full-replace save (the role permission matrix) where the
//     rejected field was one row among two hundred.
//  2. "SOMETHING WENT WRONG" MEANT FOUR DIFFERENT THINGS. A list that failed to load said
//     the same sentence whether the API was unreachable, the session had expired, or the
//     staff member simply lacks the permission. The first is worth retrying, the second
//     needs a re-login, and the third will never succeed no matter how many times they hit
//     "Try again".
//
// The `code` is the stable machine-readable handle (see `errorCode`); `detail`/`title` are
// prose and may change, so never branch on them.
import { ZodError } from "zod";
import type { ProblemDetails } from "@repo/types";
import type { useToast } from "@repo/ui";

type ToastFn = ReturnType<typeof useToast>["toast"];

/** How many field-level issues to spell out before collapsing the rest into a count. */
const MAX_FIELD_ERRORS = 4;

/**
 * Codes whose `detail` is written for whoever is debugging the transport, not for the
 * person holding the mouse — "X-CSRF-Token header must match the csrf_token cookie on
 * unsafe requests" tells a counsellor nothing they can act on. For these we show the
 * status explanation instead; the code itself still reaches the console and Sentry.
 */
const TECHNICAL_CODES = new Set(["auth.csrf_mismatch", "http.unknown_error", "http.empty_envelope"]);

function problemOf(error: unknown): ProblemDetails | undefined {
  if (error && typeof error === "object" && "problem" in error) {
    return (error as { problem: ProblemDetails }).problem;
  }
  return undefined;
}

/**
 * `body.contactEmail` → `contactEmail`, `grants.3.permissionKey` → `grants 4 › permissionKey`.
 *
 * The `body.`/`query.`/`param.` prefix is an artifact of where the payload sat in the HTTP
 * request and means nothing to the person reading the toast. Array indices are rendered
 * 1-based for the same reason — "row 4" is something a human can go and look at, "3" is not.
 */
function humanisePath(path: string): string {
  const segments = path
    .split(".")
    .filter((segment, index) => !(index === 0 && (segment === "body" || segment === "query" || segment === "param")));
  if (segments.length === 0) return "";
  return segments
    .map((segment) => (/^\d+$/.test(segment) ? `${Number(segment) + 1}` : segment))
    .join(" › ");
}

/**
 * Renders the pipe's `errors[]` as "field: reason" pairs. Returns undefined when there is
 * nothing to add, so callers can fall back to the prose `detail`.
 */
function describeFieldErrors(problem: ProblemDetails): string | undefined {
  const errors = problem.errors ?? [];
  if (errors.length === 0) return undefined;

  const shown = errors.slice(0, MAX_FIELD_ERRORS).map((issue) => {
    const label = humanisePath(issue.path);
    return label ? `${label}: ${issue.message}` : issue.message;
  });
  const remaining = errors.length - shown.length;
  return remaining > 0 ? `${shown.join("; ")} (+${remaining} more)` : shown.join("; ");
}

/**
 * The plain-English explanation for a status that carries no useful `detail` of its own.
 * Deliberately says what the reader should DO, since "Forbidden" tells them nothing.
 */
function explainStatus(problem: ProblemDetails): string | undefined {
  if (problem.status === 401) {
    return "Your session has expired. Sign in again and retry.";
  }
  if (problem.status === 403) {
    return "You don't have permission to do this. Ask an admin to grant it to your role.";
  }
  if (problem.status === 404) {
    return "That record no longer exists — it may have been deleted by someone else. Refresh the page.";
  }
  if (problem.status === 409) {
    return "This conflicts with a change someone else made. Refresh the page and try again.";
  }
  if (problem.status === 429) {
    return "Too many requests in a row. Wait a moment, then try again.";
  }
  if (problem.status >= 500) {
    return "The server ran into a problem. Nothing was saved — try again in a moment.";
  }
  return undefined;
}

/**
 * Extracts a human-readable message from an RFC-7807 `ApiError` (or any thrown value) for
 * toasts and inline error states — e.g. `ChartFrame`/`KpiCard`'s `error` prop, or the
 * "couldn't load" `EmptyState` on a list, where there is no toast, just a persistent
 * message + a retry affordance.
 *
 * `fallback` is the CALLER'S CONTEXT ("Something went wrong fetching the branch list") and
 * is used only when the error itself explains nothing. A real problem detail always wins,
 * because "you don't have permission" beats a fallback that invites a pointless retry.
 * Never leaks a raw stack or object into the UI.
 */
export function queryErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  const problem = problemOf(error);

  if (problem) {
    const parts: string[] = [];
    const detail = TECHNICAL_CODES.has(problem.code) ? undefined : problem.detail;
    const explanation = detail ?? explainStatus(problem) ?? problem.title;
    if (explanation) parts.push(explanation);

    const fields = describeFieldErrors(problem);
    if (fields) parts.push(fields);

    // A 5xx is the one case worth carrying an identifier: it is the only class the reader
    // cannot resolve themselves, and the trace id is what support needs to find it in the
    // logs. Everything else stays free of jargon.
    if (problem.status >= 500 && problem.traceId) {
      parts.push(`Reference: ${problem.traceId}`);
    }

    if (parts.length > 0) return parts.join(" ");
  }

  // A CLIENT-SIDE validation failure, before any request was made. This must be handled
  // ahead of the generic `Error` branch below, because a ZodError IS an Error and its
  // `message` getter is `JSON.stringify(this.issues, null, 2)` — so seven CRM forms that
  // call `Schema.parse()` inside their submit try/catch were toasting a raw JSON array of
  // zod issues at whoever pressed Save. Rendered the same way as the server's own
  // `errors[]`, so a field rejected here reads identically to one rejected there.
  if (error instanceof ZodError) {
    const shown = error.issues.slice(0, MAX_FIELD_ERRORS).map((issue) => {
      const label = humanisePath(issue.path.join("."));
      return label ? `${label}: ${issue.message}` : issue.message;
    });
    const remaining = error.issues.length - shown.length;
    if (shown.length > 0) {
      return remaining > 0 ? `${shown.join("; ")} (+${remaining} more)` : shown.join("; ");
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Shows `queryErrorMessage` as a destructive toast under the caller's own title. */
export function surfaceError(toast: ToastFn, error: unknown, title: string): void {
  toast({ title, description: queryErrorMessage(error), variant: "destructive" });
}

/**
 * The RFC-7807 `code` (e.g. "students.email_in_use") — the stable, machine-readable
 * handle a form uses to decide whether an error belongs on a specific field instead
 * of in a toast. Never match on `detail`/`title`: those are prose and will change.
 */
export function errorCode(error: unknown): string | undefined {
  return problemOf(error)?.code;
}

/** The HTTP status behind an error, when it came from the API. */
export function errorStatus(error: unknown): number | undefined {
  return problemOf(error)?.status;
}
