// Notifications SDK — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Namespace: client.engagement.notifications.*
//
// Endpoints covered:
//   LMS own-scope (students + faculty + all authenticated users):
//     GET  /me/notifications                    → list()
//     GET  /me/notifications/stream             → stream() [SSE — returns EventSource handle]
//     POST /me/notifications/:id/read           → markRead()
//     POST /me/notifications/read-all           → markAllRead()
//     GET  /me/notification-prefs               → getPrefs()
//     PUT  /me/notification-prefs               → updatePrefs()
//
//   Public (no auth — signed token):
//     GET  /unsubscribe/:token                  → previewUnsubscribe()
//     POST /unsubscribe/:token                  → unsubscribe()
//
// SECURITY CONTRACTS:
//   1. list() ONLY returns own notifications (IDOR→404 for any cross-user attempt).
//      The backend filters on user_id = currentUser.id before returning.
//   2. stream() returns an EventSource. The caller is responsible for closing it
//      on component unmount to prevent handler leaks (AC-SSE edge case).
//   3. The stream endpoint REJECTS unauthenticated requests with 401 (AC-15).
//      The client MUST include credentials on the EventSource request:
//        new EventSource(url, { withCredentials: true })
//   4. updatePrefs() MUST NOT accept a userId field — the backend derives it from session.
//   5. unsubscribe() is PUBLIC — no cookieAuth or CSRF. Signed token authenticates.
//
// SSE polling fallback (LOCK-D3):
//   When SSE is unavailable (offline/PWA/proxy), poll list({ unread: 'true' }).
//   Both methods return the same NotificationDto shape.

import type {
  NotificationDto,
  ListNotificationsQuery,
  MarkReadResponse,
  NotificationPrefsResponse,
  NotificationPrefsDto,
  UnsubscribeResponse,
  PaginationMeta,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class NotificationsApi {
  constructor(private readonly client: ApiClient) {}

  // ─── Own-scope notifications ─────────────────────────────────────────────

  /**
   * GET /api/v1/me/notifications
   *
   * Returns the authenticated user's own in-app notifications, cursor-paginated.
   * Use `unread: 'true'` as the SSE polling fallback (LOCK-D3):
   *   - When SSE is unavailable (offline/PWA/proxy), poll this endpoint
   *     to maintain the unread badge count.
   *
   * IDOR: the backend ONLY returns notifications for the authenticated user.
   * Cross-user access → 404 (AC-5, AC-72).
   *
   * Permissions: notifications.view (own — all authenticated users).
   */
  async list(
    query: Partial<ListNotificationsQuery> = {},
  ): Promise<{ items: NotificationDto[]; meta: PaginationMeta }> {
    // toQueryString already returns a leading "?" (or ""), so append it directly —
    // wrapping it again as `?${qs}` double-prefixed to "??unread=true" and silently
    // dropped the filter (the polling fallback never actually filtered to unread).
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestCursorPaginated<NotificationDto>(
      "GET",
      `/api/v1/me/notifications${qs}`,
    );
  }

  /**
   * GET /api/v1/me/notifications/stream (Server-Sent-Events)
   *
   * Opens an SSE connection for real-time notification delivery.
   * Returns a native EventSource handle; the caller is responsible for:
   *   1. Listening on `eventSource.addEventListener('notification', handler)`.
   *   2. Calling `eventSource.close()` on component unmount to prevent leaks.
   *
   * SECURITY:
   *   - The stream is authenticated: cookieAuth cookie is sent via `withCredentials: true`.
   *   - Unauthenticated requests receive 401 before the stream opens (AC-15).
   *   - The stream only emits events for the authenticated user (AC-14).
   *
   * LOCK-D3 polling fallback: use list({ unread: 'true' }) when SSE is unavailable.
   *
   * @param baseUrl - The API base URL (e.g. 'https://api.stimuliiq.com').
   *   Required because EventSource must be constructed with a full URL.
   * @returns An EventSource instance. Call .close() on unmount.
   *
   * NOTE: This method is browser-only. In SSR contexts, use list() instead.
   */
  openStream(baseUrl: string): EventSource {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/me/notifications/stream`;
    return new EventSource(url, { withCredentials: true });
  }

  /**
   * POST /api/v1/me/notifications/:id/read
   *
   * Marks a single notification as read.
   * Own-scope: the notification MUST belong to the authenticated user → 404 otherwise (AC-5).
   * Idempotent: marking an already-read notification is a no-op (200).
   *
   * @param id - The notification ID to mark as read.
   * @param idempotencyKey - Client-generated UUID for safe retry. Default: new UUID.
   * @returns Updated unread count for badge update.
   *
   * Permissions: notifications.view (own).
   */
  async markRead(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MarkReadResponse> {
    return this.client.request<MarkReadResponse>(
      "POST",
      `/api/v1/me/notifications/${id}/read`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/me/notifications/read-all
   *
   * Marks ALL unread notifications for the authenticated user as read.
   * Batch UPDATE scoped to user_id = currentUser.id — no cross-user effect.
   * Executes as a single UPDATE (no N+1 — handles 500+ notifications, AC edge case).
   *
   * @param idempotencyKey - Client-generated UUID for safe retry. Default: new UUID.
   * @returns MarkReadResponse with unreadCount=0 on success.
   *
   * Permissions: notifications.view (own).
   */
  async markAllRead(
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MarkReadResponse> {
    return this.client.request<MarkReadResponse>(
      "POST",
      "/api/v1/me/notifications/read-all",
      { body: {}, idempotencyKey },
    );
  }

  // ─── Notification preferences ─────────────────────────────────────────────

  /**
   * GET /api/v1/me/notification-prefs
   *
   * Returns the authenticated user's notification preferences (type×channel matrix
   * + quiet hours + leaderboard opt-in).
   * If no row exists, system defaults are returned (NOT a 404 — AC-18).
   *
   * Permissions: notification_prefs.edit (own).
   */
  async getPrefs(): Promise<NotificationPrefsResponse> {
    return this.client.request<NotificationPrefsResponse>(
      "GET",
      "/api/v1/me/notification-prefs",
    );
  }

  /**
   * PUT /api/v1/me/notification-prefs
   *
   * Upserts the notification_prefs row for the authenticated user.
   * Partial update: only supplied matrix keys are updated; absent keys retain defaults.
   * Writes an audit-log entry (AC-19).
   *
   * SECURITY: userId is ALWAYS derived from the authenticated session — the `body`
   * MUST NOT contain a `userId` field (own-scope enforced server-side, AC-20).
   * This client never sends a `userId` field in the body (the DTO schema has no such field).
   *
   * @param body - Partial notification preferences. Only supplied keys are updated.
   * @param idempotencyKey - Client-generated UUID. Default: new UUID.
   * @returns The updated (or newly created) notification prefs.
   *
   * Permissions: notification_prefs.edit (own).
   */
  async updatePrefs(
    body: NotificationPrefsDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<NotificationPrefsResponse> {
    return this.client.request<NotificationPrefsResponse>(
      "PUT",
      "/api/v1/me/notification-prefs",
      { body, idempotencyKey },
    );
  }

  // ─── Public unsubscribe (no auth — signed token) ──────────────────────────

  /**
   * GET /api/v1/unsubscribe/:token
   *
   * PUBLIC endpoint — no authentication required (AC-22).
   * Validates the signed HMAC token and returns the channel that will be unsubscribed.
   * Used to render the confirmation page before the user clicks "Confirm Unsubscribe".
   *
   * Returns 400 INVALID_TOKEN if the token is tampered (AC-24).
   * The token MUST NOT reveal the user_id or email without the signing secret (AC-77).
   */
  async previewUnsubscribe(token: string): Promise<UnsubscribeResponse> {
    return this.client.request<UnsubscribeResponse>(
      "GET",
      `/api/v1/unsubscribe/${encodeURIComponent(token)}`,
      { skipAuthRefresh: true },
    );
  }

  /**
   * POST /api/v1/unsubscribe/:token
   *
   * PUBLIC endpoint — no authentication required (AC-22).
   * Validates the HMAC token and creates a notification_suppressions row.
   * After this, all notification fan-outs and campaign sends to the user on
   * the suppressed channel are skipped (Rule C-2, AC-23).
   *
   * Idempotent: double-unsubscribe is a no-op (200).
   * Returns 400 INVALID_TOKEN on tampered token (AC-24).
   *
   * No CSRF header is needed — this is a public endpoint (no session required).
   */
  async unsubscribe(token: string): Promise<UnsubscribeResponse> {
    return this.client.request<UnsubscribeResponse>(
      "POST",
      `/api/v1/unsubscribe/${encodeURIComponent(token)}`,
      { body: {}, skipAuthRefresh: true },
    );
  }
}
