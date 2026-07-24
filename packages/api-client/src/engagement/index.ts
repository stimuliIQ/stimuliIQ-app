// Phase 6 Engagement SDK namespace — barrel + aggregator.
// Exposed on the SDK as `client.engagement.*`.
//
// Namespace layout:
//   client.engagement.notifications.*  — in-app center, SSE stream, prefs, unsubscribe
//   client.engagement.campaigns.*      — templates, campaign CRUD, send/pause/cancel, recipients/metrics
//   client.engagement.gamification.*  — own points/badges/streak, leaderboard (PII-minimal)
//   client.engagement.forum.*          — threads/posts/replies/vote/resolve/moderate
//
// Security contracts (cross-cutting):
//   - All own-scope endpoints derive userId from the authenticated session ONLY.
//   - Enrollment-scope: forum reads/writes for non-enrolled students → 404 (IDOR-safe).
//   - Assigned-scope: faculty moderation on non-assigned batches → 404 (IDOR-safe).
//   - Public endpoints (unsubscribe) require no auth — signed HMAC token authenticates.
//   - Provider webhooks (/campaigns/webhooks/:channel) are UNAUTHENTICATED + HMAC-verified;
//     handled by the backend directly (not exposed in this SDK).
//   - LeaderboardEntryDto contains NO PII beyond displayName (alias/first-name only).
//     Compile-time asserted in @repo/types/engagement/gamification.schemas.ts.
//   - No provider secrets (API keys, webhook secrets, signing secrets) appear in any
//     response type. Compile-time asserted in @repo/types/engagement/notifications.schemas.ts
//     and @repo/types/engagement/campaigns.schemas.ts.

import type { ApiClient } from "../http/client.js";
import { NotificationsApi } from "./notifications.api.js";
import { CampaignsApi } from "./campaigns.api.js";
import { GamificationApi } from "./gamification.api.js";
import { ForumApi } from "./forum.api.js";

export class EngagementApi {
  /**
   * WS-1: In-app notification center, SSE stream, prefs/quiet-hours, unsubscribe.
   *
   * Key contracts:
   *   - `client.engagement.notifications.list({ unread: 'true' })` is the SSE polling fallback.
   *   - `client.engagement.notifications.openStream(baseUrl)` returns an EventSource; close() on unmount.
   *   - `client.engagement.notifications.unsubscribe(token)` is PUBLIC (no auth) — signed token.
   *   - updatePrefs() NEVER sends userId in the body (own-scope from session).
   */
  readonly notifications: NotificationsApi;

  /**
   * WS-2: Campaign templates, campaign CRUD, send/pause/cancel, recipient tracking, metrics.
   *
   * Key contracts:
   *   - `createTemplate()` for sms/whatsapp: dlt_template_id REQUIRED (AC-78, LOCK-D4).
   *   - `send()` is consent-gated (non-consented recipients auto-excluded, AC-29).
   *   - `send()` is idempotent per-recipient (double-send = no-op, AC-27).
   *   - No provider API keys in any response (compile-time asserted).
   *   - Campaign webhooks (/campaigns/webhooks/:channel) are NOT in this SDK — backend only.
   */
  readonly campaigns: CampaignsApi;

  /**
   * WS-3: Points/XP summary, badges, streaks, leaderboard opt-in.
   *
   * Key contracts:
   *   - `getMySummary()` returns only the authenticated user's data (own-scope).
   *   - `getLeaderboard(batchId)`: PII-minimal entries only (LOCK-D5).
   *     LeaderboardEntryDto has NO email/phone/enrollmentId (compile-time asserted).
   *     Non-enrolled student → 404 (enrollment-scoped IDOR, AC-52).
   *   - `updatePrefs({ leaderboardOptIn: false })`: opt-out reflected within cache TTL (AC-51).
   */
  readonly gamification: GamificationApi;

  /**
   * WS-4: Forum threads, posts, nested replies, upvote, resolve, moderation.
   *
   * Key contracts:
   *   - `listThreads({ batchId })` + `createThread()` + `createPost()`: enrollment-scoped.
   *     Non-enrolled student → 404 (IDOR-safe, AC-55, AC-56, AC-58).
   *   - `vote()`: self-vote → 422 CANNOT_VOTE_OWN_POST (AC-62); toggle-off on second call (AC-61).
   *   - `moderateThread()` + `moderatePost()`: faculty assigned-scope only (AC-64); 403 for students.
   *   - `getModerationQueue()`: CRM surface — faculty assigned-scope, admin all-scope.
   *   - PostDto.body is stored RAW. Callers MUST apply DOMPurify before DOM insertion (AC-70).
   */
  readonly forum: ForumApi;

  constructor(client: ApiClient) {
    this.notifications = new NotificationsApi(client);
    this.campaigns = new CampaignsApi(client);
    this.gamification = new GamificationApi(client);
    this.forum = new ForumApi(client);
  }
}

export * from "./notifications.api.js";
export * from "./campaigns.api.js";
export * from "./gamification.api.js";
export * from "./forum.api.js";
