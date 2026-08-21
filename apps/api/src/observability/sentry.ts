// apps/api/src/observability/sentry.ts
//
// Sentry error reporting bootstrap (CLAUDE.md §1, docs/04-trd-architecture.md §2.13).
// No-ops cleanly when SENTRY_DSN is absent (dev/test — docs/plans/phase-0.md §Stubs),
// and ALSO no-ops whenever NODE_ENV=test regardless of DSN, so a stray env var can
// never make an automated test suite hit the real Sentry network.
//
// Phase 7 WS-C (docs/plans/phase-7.md task #9, AC-43) adds:
//   - a `beforeSend` PII-scrubbing hook (Rule H-4): strips the auth/cookie headers and
//     the user's email outright, then masks any remaining email/phone found anywhere
//     else in the event (request data, extra, contexts, breadcrumbs, exception/message
//     text) via the SAME `maskPiiDeep`/`maskPiiString` helpers the pino logger uses —
//     one masking implementation, not two that could drift.
//   - `captureException()` is called from the global exception filter for 5xx
//     responses, and from main.ts's process-level uncaughtException/unhandledRejection
//     handlers — always guarded by `initialized` so it's a true no-op until a DSN is
//     configured, and wrapped in try/catch so a Sentry transport failure itself can
//     never crash the request/process.
//
// T4 (docs/plans/phase-9-completion.md B11) hardening: a production deploy with no
// SENTRY_DSN previously no-op'd SILENTLY — a real prod outage would then generate zero
// Sentry events with no signal anywhere that reporting was even disabled. `initSentry()`
// now logs a loud WARN (never throws — a missing DSN must not take the whole API down)
// whenever `isProductionEnv()` is true and SENTRY_DSN is absent, so this is visible in
// deploy/boot logs. Non-production environments keep the fully silent no-op.

import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import { isProductionEnv } from "../config/env";
import { maskPiiDeep, maskPiiString } from "./pii-mask";

let initialized = false;

/**
 * Rule H-4/AC-43: strip transport secrets structurally (never merely "mask" an
 * Authorization/cookie header — remove it outright), then mask any remaining
 * email/phone anywhere else in the event. Exported for direct unit testing without
 * needing a live Sentry SDK instance.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      const headers: Record<string, string> = { ...event.request.headers };
      delete headers.authorization;
      delete headers.Authorization;
      delete headers.cookie;
      delete headers.Cookie;
      delete headers["x-csrf-token"];
      event.request.headers = headers;
    }
    delete event.request.cookies;
    if (event.request.data !== undefined) {
      event.request.data = maskPiiDeep(event.request.data);
    }
  }

  if (event.user) {
    const maskedUser = maskPiiDeep(event.user);
    delete maskedUser.email;
    event.user = maskedUser;
  }

  if (event.extra) {
    event.extra = maskPiiDeep(event.extra);
  }

  if (event.contexts) {
    event.contexts = maskPiiDeep(event.contexts);
  }

  if (event.message) {
    event.message = maskPiiString(event.message);
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value) => ({
      ...value,
      value: value.value ? maskPiiString(value.value) : value.value,
    }));
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? maskPiiString(crumb.message) : crumb.message,
      data: crumb.data ? maskPiiDeep(crumb.data as Record<string, unknown>) : crumb.data,
    }));
  }

  return event;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (process.env.NODE_ENV === "test") {
    // Never contact Sentry during automated tests, even if a stray DSN leaks in.
    return;
  }

  if (!dsn) {
    if (isProductionEnv()) {
      // Loud (not fatal): a production deploy with no DSN must be visible in boot logs,
      // but a missing DSN alone must never take the whole API down (fail-safe, not
      // fail-closed, for observability config — see T2/B2 for the providers that DO
      // fail-closed). pino isn't bootstrapped yet at this point in boot (see main.ts's
      // boot-order comment), so use console directly.
      console.warn(
        "[api] SENTRY_DSN is not set in a production environment, error reporting to " +
          "Sentry is DISABLED. 5xx exceptions and uncaught exceptions will NOT be " +
          "reported. Set SENTRY_DSN to enable production error tracking.",
      );
    }
    // No-op: error reporting is deferred until SENTRY_DSN is configured.
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV ?? "local",
    tracesSampleRate: process.env.APP_ENV === "production" ? 0.1 : 1.0,
    beforeSend: (event) => scrubSentryEvent(event),
  });

  initialized = true;
}

export function isSentryInitialized(): boolean {
  return initialized;
}

export function captureException(error: unknown): void {
  if (!initialized) {
    return;
  }
  try {
    Sentry.captureException(error);
  } catch {
    // Fail-safe: a Sentry transport error must never take down the request/process.
  }
}

/** Test-only: reset the module-level init flag between specs. */
export function __resetSentryForTests(): void {
  initialized = false;
}
