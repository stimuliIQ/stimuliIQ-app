// Core typed-fetch HTTP client for the stimuliiq API.
//
// Transport contract (LOCKED, docs/04-trd-architecture.md §2.3):
//   - Auth is httpOnly cookies, never bearer tokens. Every request is issued
//     with `credentials: "include"` so the browser attaches `access_token` /
//     `refresh_token` automatically; this SDK never reads or stores those
//     cookies itself (it can't — they're httpOnly).
//   - CSRF is double-submit: the non-httpOnly `csrf_token` cookie (or the
//     `csrfToken` field returned by login/refresh/otp-verify) must be echoed
//     back via the `X-CSRF-Token` header on every unsafe request. This
//     client does that automatically by reading the `csrf_token` cookie
//     (when running in a browser) and falling back to a value set via
//     `setCsrfToken()` (useful in SSR/server-action contexts where document.cookie
//     isn't available — the caller reads the cookie from the request and
//     primes the client explicitly).
//   - Every response is unwrapped from the `{ data, meta, error }` envelope
//     (@repo/types `buildEnvelopeSchema`). A populated `error` or a non-2xx
//     status throws `ApiError`. `request()` returns just `data` (for
//     single-resource get/create/update/action calls); `requestPaginated()`
//     returns `{ items, meta }` for CRM list endpoints whose `meta` carries
//     `OffsetPaginationMeta` (page/pageSize/total/hasMore — docs/04 §2.14).
//   - Unsafe (POST/PUT/PATCH/DELETE) requests accept an `idempotencyKey`
//     option, sent as the `Idempotency-Key` header CRM mutations require
//     (docs/04 §2.14). Resource API methods generate one by default via
//     `crypto.randomUUID()` unless the caller passes their own (e.g. to
//     retry the exact same logical mutation safely).
//
// 401 -> refresh -> retry seam:
//   This client does NOT automatically retry on 401. Auto-retry needs
//   app-level coordination (e.g. a TanStack Query mutation queue) to avoid a
//   thundering herd of parallel refreshes. Instead it exposes
//   `onUnauthorized`, a hook the frontend wires once at app bootstrap
//   (Wave 5, frontend-builder): when any request gets a 401, this hook is
//   awaited before the ApiError is thrown; if the hook resolves to `"retried"`
//   the original request is replayed once. A typical implementation calls
//   `authApi.refresh()` and resolves `"retried"` on success, `"failed"` on
//   refresh failure (in which case the original 401 surfaces and the app
//   redirects to login).

import type { ProblemDetails, OffsetPaginationMeta } from "@repo/types";
import { ApiError } from "./envelope-error.js";

export interface ApiClientConfig {
  /** Base URL of the API, e.g. `https://api.stimuliiq.com` or `http://localhost:4000`. Paths are appended as-is (already include `/api/v1/...`). */
  baseUrl: string;
  /**
   * Called once per request when the server returns 401. Return `"retried"`
   * to have the client replay the original request a single time (e.g.
   * after a successful `/auth/refresh`), or `"failed"` to let the 401
   * surface as an `ApiError`. Optional — if omitted, 401s always surface.
   */
  onUnauthorized?: () => Promise<"retried" | "failed">;
  /**
   * Override for reading the CSRF token (defaults to parsing `document.cookie`
   * for the app's csrf cookie — see `appAudience`). Provide this in non-browser
   * environments (Next.js server actions/route handlers) where the incoming
   * request's cookie jar must be threaded through explicitly.
   */
  getCsrfToken?: () => string | undefined;
  /**
   * Which first-party app this client instance belongs to ("lms" | "crm").
   * Sent as the `X-App-Audience` header on EVERY request so the API reads/writes
   * this app's own session cookie slot (`<app>_access_token` / `<app>_refresh_token`
   * / `<app>_csrf_token`) — the fix that lets a CRM staff session and an LMS student
   * session coexist in the same browser against the shared API origin. Also switches
   * the default CSRF cookie read to `<app>_csrf_token` (legacy `csrf_token` as
   * fallback). Omit for server-to-server/test callers, which keep the legacy
   * unprefixed cookie behavior.
   */
  appAudience?: "lms" | "crm";
}

type EnvelopeBody<T> = {
  data: T | null;
  meta: Record<string, unknown> | null;
  error: ProblemDetails | null;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The envelope stand-in for a 204 No Content response. A 204 is a success that carries no
 * body at all, so there is nothing to parse — this sentinel lets `request()` tell "the
 * server returned nothing BY DESIGN" apart from "the server returned a malformed empty
 * body", which must still be an error.
 */
const NO_CONTENT_ENVELOPE = { data: null, meta: null, error: null } as const;

function isNoContent(envelope: unknown): boolean {
  return envelope === NO_CONTENT_ENVELOPE;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly onUnauthorized?: ApiClientConfig["onUnauthorized"];
  private readonly getCsrfToken: () => string | undefined;
  private readonly appAudience?: "lms" | "crm";
  /**
   * FALLBACK ONLY — primed by login/refresh/otp-verify responses so non-browser callers
   * (SSR, server actions) can send the header without cookie access. In a browser the
   * live `csrf_token` cookie always wins: this snapshot goes stale whenever the cookie is
   * rotated elsewhere (see fetchEnvelope).
   */
  private lastCsrfToken: string | undefined;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.onUnauthorized = config.onUnauthorized;
    this.appAudience = config.appAudience;
    // App-scoped csrf cookie first (`lms_csrf_token`/`crm_csrf_token`), legacy
    // `csrf_token` as fallback for sessions minted before the slot split.
    this.getCsrfToken =
      config.getCsrfToken ??
      (() =>
        (this.appAudience ? readCookie(`${this.appAudience}_csrf_token`) : undefined) ??
        readCookie("csrf_token"));
  }

  /** Primes the CSRF token explicitly (called internally after login/refresh/otp-verify). */
  setCsrfToken(token: string): void {
    this.lastCsrfToken = token;
  }

  async request<TResponse>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; retried?: boolean; idempotencyKey?: string; skipAuthRefresh?: boolean } = {},
  ): Promise<TResponse> {
    const envelope = await this.fetchEnvelope<TResponse>(method, path, options);

    // `noContent` marks a 204: a SUCCESS that carries no body by design (the DELETE
    // endpoints for saved views, bookmarks and lesson notes). Without this exemption the
    // null-data guard below threw on every one of them — the server deleted the row, the
    // client reported failure, the mutation's onSuccess never ran, and the deleted item
    // stayed on screen until a manual reload. Callers of those endpoints type the result
    // as `void`.
    if (envelope.data === null && !isNoContent(envelope)) {
      // Endpoints with a non-nullable success payload (login, /me, CRM
      // create/get, etc.) always populate `data` on 2xx; null here means a
      // contract mismatch upstream.
      throw new ApiError({
        type: "about:blank",
        title: "Empty response body",
        status: 200,
        code: "http.empty_envelope",
      });
    }

    return envelope.data as TResponse;
  }

  /**
   * Like `request`, but for CRM list endpoints whose `meta` carries
   * `OffsetPaginationMeta` (page/pageSize/total/hasMore — docs/04 §2.14
   * envelope; see @repo/types common/pagination.ts). Returns the page items
   * alongside the pagination meta instead of discarding it.
   */
  async requestPaginated<TItem>(
    method: "GET",
    path: string,
    options: { retried?: boolean } = {},
  ): Promise<{ items: TItem[]; meta: OffsetPaginationMeta }> {
    const envelope = await this.fetchEnvelope<TItem[]>(method, path, options);

    if (envelope.meta === null) {
      throw new ApiError({
        type: "about:blank",
        title: "Missing pagination meta",
        status: 200,
        code: "http.empty_envelope",
      });
    }

    return { items: envelope.data ?? [], meta: envelope.meta as unknown as OffsetPaginationMeta };
  }

  /**
   * Like `requestPaginated`, but for PUBLIC list endpoints that use CURSOR
   * pagination (`PaginationMeta`: nextCursor + hasMore — docs/04 §2.14).
   * Used by GET /public/programs (Phase 5 public catalog — high-volume, SEO-first).
   * Unlike offset pagination (CRM lists), cursor pagination is forward-only and
   * does not expose a total count (appropriate for unauthenticated public surfaces).
   */
  async requestCursorPaginated<TItem>(
    method: "GET",
    path: string,
    options: { retried?: boolean } = {},
  ): Promise<{ items: TItem[]; meta: { nextCursor: string | null; hasMore: boolean } }> {
    const envelope = await this.fetchEnvelope<TItem[]>(method, path, options);
    const meta = envelope.meta as unknown as { nextCursor: string | null; hasMore: boolean } | null;
    return {
      items: envelope.data ?? [],
      meta: meta ?? { nextCursor: null, hasMore: false },
    };
  }

  /**
   * Raw (non-enveloped) GET — for the Phase 7 health/readiness endpoints ONLY
   * (docs/plans/phase-7.md task #4, AC-41/AC-42). `/health` and `/health/ready`
   * are a deliberate, spec-driven exception to the `{ data, meta, error }`
   * envelope: AC-41's own example is the raw minimal body `{ status: "ok" }`,
   * matching the load-balancer/monitoring convention those probes follow
   * elsewhere. Unlike `request()`, this does NOT throw on a non-2xx status —
   * `/health/ready` legitimately returns 503 with a valid, inspectable body
   * (e.g. `{ status: "degraded", db: "down", redis: "ok" }`) that the caller
   * needs to read, not treat as an `ApiError`. It DOES throw if the body
   * can't be parsed as JSON at all (a genuinely broken response). No CSRF/
   * Idempotency-Key handling — these are public, unauthenticated, GET-only
   * endpoints (AC-49: still rate-limited server-side, not a client concern).
   */
  async requestRaw<TResponse>(
    method: "GET",
    path: string,
  ): Promise<{ httpStatus: number; body: TResponse }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    const body = (await response.json().catch(() => null)) as TResponse | null;
    if (body === null) {
      throw new ApiError({
        type: "about:blank",
        title: response.statusText || "Request failed",
        status: response.status,
        code: "http.empty_response",
      });
    }
    return { httpStatus: response.status, body };
  }

  private async fetchEnvelope<TResponse>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; retried?: boolean; idempotencyKey?: string; skipAuthRefresh?: boolean },
  ): Promise<EnvelopeBody<TResponse>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // Declares which per-app session cookie slot this request uses (see appAudience).
    if (this.appAudience) headers["X-App-Audience"] = this.appAudience;

    if (UNSAFE_METHODS.has(method)) {
      // COOKIE FIRST, in-memory second. Double-submit compares the header against the
      // CURRENT `csrf_token` cookie, and the server ROTATES that cookie on every
      // login/refresh/2FA-verify (setAuthCookies). The in-memory value is only a snapshot
      // of the last such response THIS client instance saw — so it goes stale the moment
      // the cookie is rotated by anything else: another tab, or (on localhost, where all
      // ports share a cookie jar) the lms/web app silently refreshing its session. The
      // request then carried a stale header against a fresh cookie and the server
      // correctly rejected it ("X-CSRF-Token header must match the csrf_token cookie").
      // The cookie is the source of truth whenever it is readable; `lastCsrfToken` remains
      // the fallback for SSR/server-action callers that have no document.cookie.
      const csrf = this.getCsrfToken() ?? this.lastCsrfToken;
      if (csrf) headers["X-CSRF-Token"] = csrf;
      // Required on every unsafe CRM mutation (docs/04 §2.14). Auth-slice
      // mutations don't pass this (see registry.ts auth section) — callers
      // that need it generate one (e.g. crypto.randomUUID()) and pass it in.
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: "include", // httpOnly auth cookies travel automatically.
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (cause) {
      // `fetch` itself rejects (never resolves to a Response) on transport-level
      // failures: DNS/connection refused (API down), CORS preflight/origin block,
      // or an offline network — all surface as a bare `TypeError: Failed to fetch`.
      // Wrap it in an ApiError so every caller can rely on `error.problem` being
      // present (the whole client is typed to throw `ApiError`, never a raw
      // TypeError). Status 0 = "no HTTP response was received".
      const reason = cause instanceof Error ? cause.message : "Failed to fetch";
      throw new ApiError({
        type: "about:blank",
        title: "Network error",
        status: 0,
        code: "http.network_error",
        detail: `We couldn't reach the server (${reason}). Check your connection and that the API is running.`,
      });
    }

    // Auth-slice calls (login/refresh/otp/logout) opt out of the refresh seam:
    // a 401 from them is terminal (bad credentials, or no valid refresh cookie),
    // and re-entering `onUnauthorized` -> `refresh()` on the refresh call itself
    // would recurse forever (thundering herd of /auth/refresh 401s).
    if (response.status === 401 && !options.retried && !options.skipAuthRefresh && this.onUnauthorized) {
      const outcome = await this.onUnauthorized();
      if (outcome === "retried") {
        return this.fetchEnvelope<TResponse>(method, path, { ...options, retried: true });
      }
    }

    // 204 No Content is a SUCCESS with a deliberately empty body — there is no envelope to
    // parse. Without this branch `response.json()` fails, `envelope` is null, and the
    // "empty envelope" guard below throws even though the server did the work: the DELETE
    // endpoints that return 204 (saved views, bookmarks, lesson notes) all appeared to
    // fail, so their mutations' onSuccess never ran and the deleted row stayed on screen.
    if (response.status === 204) {
      return NO_CONTENT_ENVELOPE as EnvelopeBody<TResponse>;
    }

    const envelope = (await response.json().catch(() => null)) as EnvelopeBody<TResponse> | null;

    if (!response.ok || envelope?.error) {
      const problem: ProblemDetails = envelope?.error ?? {
        type: "about:blank",
        title: response.statusText || "Request failed",
        status: response.status,
        code: "http.unknown_error",
      };
      throw new ApiError(problem);
    }

    if (envelope === null) {
      throw new ApiError({
        type: "about:blank",
        title: "Empty response body",
        status: response.status,
        code: "http.empty_envelope",
      });
    }

    return envelope;
  }
}
