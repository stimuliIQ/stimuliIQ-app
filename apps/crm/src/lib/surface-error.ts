// Shared RFC-7807 Problem Details error→toast surfacer, extracted from the
// repeated inline pattern in components/commerce/* (e.g.
// refund-detail-drawer.tsx, batch-form-drawer.tsx). New leads/* components
// use this instead of re-inlining it (CLAUDE.md §3: no duplicated business
// logic in components).
import type { useToast } from "@repo/ui";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function surfaceError(toast: ToastFn, error: unknown, title: string): void {
  const description = queryErrorMessage(error);
  toast({ title, description, variant: "destructive" });
}

/**
 * Extracts a human-readable message from an RFC-7807 `ApiError` (or any
 * thrown value) for inline error states — e.g. `ChartFrame`/`KpiCard`'s
 * `error` prop — where there's no toast, just a persistent "couldn't load"
 * message + retry affordance. Falls back to a generic message rather than
 * leaking a raw stack/object into the UI.
 */
export function queryErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error && typeof error === "object" && "problem" in error) {
    const problem = (error as { problem: { detail?: string; title?: string } }).problem;
    return problem.detail ?? problem.title ?? fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * The RFC-7807 `code` (e.g. "students.email_in_use") — the stable, machine-readable
 * handle a form uses to decide whether an error belongs on a specific field instead
 * of in a toast. Never match on `detail`/`title`: those are prose and will change.
 */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "problem" in error) {
    return (error as { problem: { code?: string } }).problem.code;
  }
  return undefined;
}
