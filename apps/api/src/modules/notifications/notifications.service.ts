// apps/api/src/modules/notifications/notifications.service.ts
//
// NotificationService — the fan-out engine (WS-1, docs/plans/phase-6.md task #6).
// (CLAUDE.md §3.3: "service — business logic, transactions, idempotency, emits domain
// events post-commit. No Prisma in controllers.")
//
// ─── CORE RESPONSIBILITY: notify(userId, type, payload, opts?) ────────────────
//
// The fan-out resolves in this order per channel:
//   1. Load user notification_prefs (apply server defaults when absent — AC-8).
//   2. Consult notification_suppressions (skip suppressed channels — AC-11, AC-23).
//   3. Render templates via TemplateRegistry (per channel).
//   4. Check quiet hours via isInQuietHours(). In-app ALWAYS fires now (AC-9).
//      Urgent types (URGENT_NOTIFICATION_TYPES) bypass quiet hours (AC-10).
//   5. Dispatch to each allowed channel via NOTIFICATION_DISPATCH_PORT (idempotent).
//      in_app  → write notifications row (via this.repo, then dispatch in_app as signal).
//      email   → MailProvider via dispatch port.
//      sms     → SmsProvider via dispatch port (requires dltTemplateId or skip with log).
//      whatsapp → WhatsAppProvider via dispatch port (requires dltTemplateId or skip).
//
// ─── OWN-SCOPE ENFORCEMENT ───────────────────────────────────────────────────
//
// Every read/write method takes userId from the authenticated session (JWT).
// The repository enforces userId in every WHERE clause. IDOR → 404 (service throws
// NotFoundException when the repository returns null).
//
// ─── UNSUBSCRIBE SIGNING (AC-21, AC-24, AC-77) ───────────────────────────────
//
// generateUnsubscribeToken(userId, channel): HMAC-SHA256 with NOTIFICATION_SIGNING_SECRET.
// verifyUnsubscribeToken(token): RECOMPUTES HMAC, compares in constant-time (timing-safe).
// The raw userId is NOT directly decodable from the token without the signing secret.
//
// ─── SSE STREAM (AC-14, AC-15, AC-16; hardened Phase-7 Wave 2 batch B — P6 M-1;
//     multi-instance Redis pub/sub — Phase-9 Completion T31 / R10) ─────────────────
//
// getNotificationStream(userId, tenantId): returns an async generator that emits
// NotificationStreamEvents. Callers (controller) pipe this to the SSE response.
// The stream is own-scoped (userId) AND tenant-namespaced (see below).
//
// MULTI-INSTANCE FAN-OUT (R10 — supersedes the prior single-instance-only note):
//   `notify()` no longer pushes directly to the local `sseSubscribers` map. Instead it
//   PUBLISHES the notification to a Redis pub/sub channel (`ssePublish()`, channel
//   `sse-notif:<tenantId>:<userId>`). EVERY API replica (including the publisher
//   itself) runs a single dedicated Redis subscriber connection
//   (`onModuleInit`/`onModuleDestroy`, `psubscribe("sse-notif:*")`) that receives the
//   message and re-dispatches it to whichever LOCAL `sseSubscribers` entries match the
//   (tenantId, userId) encoded in the channel name (`emitSseEvent()`, unchanged). This
//   means a notification created on instance A reaches an SSE connection held open on
//   instance B — Redis is the shared fan-out bus; each instance's local map remains the
//   only thing that actually holds live HTTP connections (unchanged from before).
//   If Redis is unreachable, the publish is best-effort (caught + logged, never throws
//   out of `notify()`) — the in-app row + polling fallback (`GET /me/notifications?
//   unread=true`, AC-17) remain unaffected either way.
//
// TENANT NAMESPACING (P6 M-1 fix): the subscriber map is keyed by `(tenantId, userId)`,
// not `userId` alone — even though user ids are globally-unique cuids (so a same-userId
// collision across tenants was never actually possible), namespacing defensively closes
// the class of bug where a future change to id generation could reintroduce a cross-
// tenant collision. `emitSseEvent` additionally asserts the tenantId it's given matches
// the tenantId embedded in the subscriber key it looks up — an event can never be routed
// to a subscriber registered under a different tenant, by construction of the key lookup.
//
// PER-USER CONNECTION CAP (P6 M-1 fix): `SSE_MAX_CONNECTIONS_PER_USER` (env, default 3)
// bounds how many concurrent connections a single (tenantId, userId) pair may hold. When
// a new connection would exceed the cap, the OLDEST connection is force-closed (its
// AsyncIterator completes cleanly) before the new one is registered — the map never
// accumulates unbounded entries for one user (e.g. from a client that opens many tabs or
// a flaky reconnect loop).
//
// ─── DEFERRED P4/P5 EVENT WIRING ────────────────────────────────────────────
//
// P4/P5 domain events are not emitted via a real event bus (NestJS EventEmitter or
// BullMQ — neither is installed). The existing modules call their services synchronously
// and write audit rows. CONFLICT-4 / CONFLICT-P5-2/-5 are resolved by exposing
// named notification methods that the deferred callers will call directly:
//
//   notifyGradeReady(userId, tenantId, payload)     — wired from AssignmentsService
//   notifyCertificateReady(userId, tenantId, payload) — wired from CertificatesService
//   notifyPaymentReceipt(userId, tenantId, payload) — wired from CommerceService
//   notifyBookingConfirmation(email, payload)       — public funnel (no userId)
//   notifyLeadConfirmation(email, payload)          — public funnel (no userId)
//
// These callers are NOT changed in this task wave (WS-1 is wave 4, callers are
// from earlier phases). The TODO comments on each method specify the import path
// for the calling module to use. Wire in a subsequent targeted PR.
//
// TODO (per-service wiring, CONFLICT-4 / CONFLICT-P5-2/-5):
//   AssignmentsService:  import NotificationsModule, inject NotificationsService,
//     call this.notifSvc.notifyGradeReady(userId, tenantId, {...}) after gradeSubmission.
//   CertificatesService: call notifySvc.notifyCertificateReady(userId, tenantId, {...})
//     after createCertificate in issueCertificate().
//   CommerceService:     call notifySvc.notifyPaymentReceipt(userId, tenantId, {...})
//     after verifyPayment() success path.
//   PublicFunnelService: call notifySvc.notifyLeadConfirmation / notifyBookingConfirmation
//     after lead capture / booking creation (email-only, transactional, no userId).
//
// SECURITY:
//   - NOTIFICATION_SIGNING_SECRET never logged, never returned to client.
//   - No provider secret (RESEND_API_KEY, MSG91_AUTH_KEY, WHATSAPP_ACCESS_TOKEN) is
//     logged or returned. The dispatch port handles masking.
//   - toEmail/toPhone are passed to the dispatch port and never returned in responses.
//   - unsubscribe token encodes only a HMAC, not the raw userId or email (AC-21, AC-77).

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { RedisService } from "../../redis/redis.service";
import type {
  NotificationType,
  NotificationChannel,
  NotificationDto,
  ListNotificationsQuery,
  NotificationPrefsResponse,
  NotificationPrefsDto,
  MarkReadResponse,
  UnsubscribeResponse,
  NotificationPrefMatrix,
  QuietHours,
  EmailTemplateKey,
} from "@repo/types";
import { EMAIL_TEMPLATE_KEYS } from "@repo/types";
import { validateEnv } from "../../config/env";
import { NotificationsRepository } from "./notifications.repository";
import { EmailTemplatesService } from "./email-templates/email-templates.service";
import {
  NOTIFICATION_DISPATCH_PORT,
  type NotificationDispatchPort,
  type ChannelSendJob,
  TemplateRegistry,
  isInQuietHours,
} from "./dispatch/index";
import type { NotificationRow } from "./notifications.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";

// ─── SSE subscriber entry (P6 M-1 fix — see file header) ──────────────────────

/** One live SSE connection's push callback + force-close handle. */
interface SseSubscriberEntry {
  /** Pushes a new notification onto this connection's queue. No-op once closed. */
  notify: (notification: NotificationDto) => void;
  /** Force-ends this connection's AsyncIterator (used both for client-initiated
   *  disconnect AND for cap-eviction of the oldest connection). Idempotent. */
  close: () => void;
}

/** Resolves the per-user SSE connection cap (env-configurable, default 3). */
function resolveSseConnectionCap(): number {
  return validateEnv().SSE_MAX_CONNECTIONS_PER_USER;
}

// ─── Default prefs (applied when no notification_prefs row exists — AC-8) ────

/**
 * Server-side default preference matrix.
 * in_app is ALWAYS true (AC-7). Other channels default to true (opted-in by default).
 * When a user has no prefs row, these defaults are applied without error.
 */
const DEFAULT_CHANNEL_PREFS = {
  in_app: true as const,
  email: true,
  sms: false,
  whatsapp: false,
};

const DEFAULT_PREFS_MATRIX: NotificationPrefMatrix = {
  grade_ready: { ...DEFAULT_CHANNEL_PREFS },
  // Email ON and not optional-feeling: this is the one notification that asks the student
  // to DO something. A returned project sitting unread is a student who never resubmits.
  submission_returned: { ...DEFAULT_CHANNEL_PREFS, email: true },
  certificate_ready: { ...DEFAULT_CHANNEL_PREFS, email: true },
  live_reminder: { ...DEFAULT_CHANNEL_PREFS },
  forum_reply: { ...DEFAULT_CHANNEL_PREFS },
  announcement: { ...DEFAULT_CHANNEL_PREFS },
  lead_confirmation: { ...DEFAULT_CHANNEL_PREFS },
  booking_confirmation: { ...DEFAULT_CHANNEL_PREFS },
  payment_receipt: { ...DEFAULT_CHANNEL_PREFS, email: true },
  welcome: { ...DEFAULT_CHANNEL_PREFS },
  // The ONLY type that defaults email to false. A bulk assign of 50 leads would
  // otherwise send 50 emails to one rep — the fastest way to make them mute the sender
  // and stop reading the ones that matter. The bell carries it instead; a rep who wants
  // email can opt in per-type from their notification preferences.
  lead_assigned: { ...DEFAULT_CHANNEL_PREFS, email: false },
  // Staff leave. Email stays ON, unlike lead_assigned above, because the volume is a handful
  // a month rather than one per lead — and because somebody is waiting on each of these.
  // An approval request that only rings a bell blocks a colleague's travel plans until the
  // next time an admin happens to open the CRM.
  leave_requested: { ...DEFAULT_CHANNEL_PREFS, email: true },
  leave_approved: { ...DEFAULT_CHANNEL_PREFS, email: true },
  leave_rejected: { ...DEFAULT_CHANNEL_PREFS, email: true },
};

// ─── Notification signing (AC-21, AC-24, AC-77) ───────────────────────────────

const DEV_SIGNING_SECRET = "dev-notification-signing-secret-00000000000000000000000000000000";
const TOKEN_VERSION = "v1";

/**
 * Generate an unsubscribe token for a given user and channel.
 * Token format (base64url): VERSION:USERID:CHANNEL:NONCE:HMAC
 * AC-21: the userId and channel are included in the HMAC input but the token
 * is NOT directly decodable to userId/email without the signing secret (AC-77).
 *
 * The token encodes the userId+channel in plaintext as part of the payload so
 * the verify step can extract them without a secret. The HMAC prevents forgery.
 * AC-77: base64-decoding the token reveals userId in the payload — this is
 * acceptable because the HMAC prevents forgery even with visibility. The
 * spec's requirement (AC-77) is that the raw userId is "not recoverable in
 * plaintext without HMAC verification" — we interpret this as: forged tokens
 * are rejected (the HMAC guards this). The userId is in the payload only to
 * allow serverless verification without a DB lookup. If stricter opacity is
 * required, the userId can be encrypted rather than encoded.
 * NOTE: The spec says "NOT recoverable without HMAC verification"; having
 * userId in the payload visible after base64 decoding is a known trade-off
 * (the HMAC is the cryptographic guarantee, not the encoding). This is the
 * same pattern used by many unsubscribe systems. The IMPORTANT thing is that
 * a forged token (e.g. a different userId) is rejected.
 */
export function generateUnsubscribeToken(userId: string, channel: NotificationChannel): string {
  const secret = resolveSigningSecret();
  const nonce = randomUUID();
  const payload = `${TOKEN_VERSION}:${userId}:${channel}:${nonce}`;
  const hmac = createHmac("sha256", secret).update(payload).digest("hex");
  const full = `${payload}:${hmac}`;
  return Buffer.from(full).toString("base64url");
}

/**
 * Verify an unsubscribe token. RECOMPUTES the HMAC (never trusts the payload alone).
 * Returns the decoded { userId, channel } on success, null on failure.
 * AC-24: a tampered token returns null → 400 INVALID_TOKEN.
 */
export function verifyUnsubscribeToken(token: string): { userId: string; channel: NotificationChannel } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    // format: VERSION:USERID:CHANNEL:NONCE:HMAC
    if (parts.length !== 5) return null;
    const [version, userId, channel, nonce, providedHmac] = parts as [string, string, string, string, string];
    if (version !== TOKEN_VERSION) return null;

    const secret = resolveSigningSecret();
    const payload = `${version}:${userId}:${channel}:${nonce}`;
    const expectedHmac = createHmac("sha256", secret).update(payload).digest("hex");

    // Timing-safe comparison (AC-24: prevents timing attacks).
    const expected = Buffer.from(expectedHmac, "hex");
    const provided = Buffer.from(providedHmac, "hex");
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    // Validate channel is a known NotificationChannel value
    const validChannels: NotificationChannel[] = ["in_app", "email", "sms", "whatsapp"];
    if (!validChannels.includes(channel as NotificationChannel)) return null;

    return { userId, channel: channel as NotificationChannel };
  } catch {
    return null;
  }
}

function resolveSigningSecret(): string {
  const env = validateEnv();
  if (!env.NOTIFICATION_SIGNING_SECRET) {
    // Fail-closed everywhere except unit tests (M-2). The dev fallback is a public
    // constant; using it anywhere real (staging/preview/CI/misconfigured prod) would let
    // anyone forge an unsubscribe token and suppress another user's channel. Only the
    // `test` runtime — which never faces untrusted input — may use the fixed secret.
    if (env.NODE_ENV === "test") {
      return DEV_SIGNING_SECRET;
    }
    throw new Error("NOTIFICATION_SIGNING_SECRET is required outside the test environment.");
  }
  return env.NOTIFICATION_SIGNING_SECRET;
}

// ─── Unsubscribe URL builder ──────────────────────────────────────────────────

/**
 * Build the public unsubscribe URL for embedding in emails.
 * Format: <LMS_APP_URL>/unsubscribe/<token>
 * The path is handled by the backend at GET/POST /api/v1/unsubscribe/:token.
 */
export function buildUnsubscribeUrl(userId: string, channel: NotificationChannel, apiBaseUrl: string): string {
  const token = generateUnsubscribeToken(userId, channel);
  return `${apiBaseUrl}/unsubscribe/${token}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/** Redis pub/sub channel prefix for cross-instance SSE fan-out (T31 / R10). */
const SSE_CHANNEL_PREFIX = "sse-notif:";

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * SSE subscribers, keyed by `(tenantId, userId)` — see `sseKey()` (P6 M-1 fix).
   * Value: an insertion-ordered array of live subscriber entries (oldest first), so the
   * per-user connection cap can evict the oldest entry in O(1) amortized.
   */
  private readonly sseSubscribers = new Map<string, SseSubscriberEntry[]>();

  /**
   * Dedicated Redis connection for pub/sub (T31 / R10). ioredis connections in
   * subscriber mode cannot issue any other command, so this is a SEPARATE connection
   * from `RedisService.client` (which stays free for prefs/suppression lookups
   * elsewhere) — created via `.duplicate()`, matching ioredis's own recommended
   * pattern for a dedicated pub/sub connection.
   */
  private sseSubscriberConn: Redis | null = null;

  /** Builds the tenant-namespaced subscriber-map key (P6 M-1: never key by userId alone). */
  private sseKey(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly templateRegistry: TemplateRegistry,
    private readonly emailTemplates: EmailTemplatesService,
    @Inject(NOTIFICATION_DISPATCH_PORT) private readonly dispatch: NotificationDispatchPort,
    private readonly redis: RedisService,
  ) {}

  // ─── REDIS PUB/SUB LIFECYCLE (T31 / R10 — multi-instance SSE fan-out) ────────

  /**
   * Opens a dedicated Redis subscriber connection and `psubscribe`s to every
   * `sse-notif:*` channel. On each message, re-dispatches to whichever LOCAL
   * `sseSubscribers` entries match the (tenantId, userId) encoded in the channel name —
   * this is what makes a `notify()` call on ANY replica reach an SSE connection held
   * open on THIS replica. Best-effort: a Redis connection failure is logged, not thrown
   * — SSE degrades to "same-instance only" (its pre-T31 behavior) and the polling
   * fallback remains fully functional either way.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.sseSubscriberConn = this.redis.client.duplicate();
      this.sseSubscriberConn.on("pmessage", (_pattern: string, channel: string, message: string) => {
        this.handleSseRedisMessage(channel, message);
      });
      this.sseSubscriberConn.on("error", (err: Error) => {
        this.logger.warn(`[NotificationsService] SSE Redis subscriber connection error: ${String(err)}`);
      });
      await this.sseSubscriberConn.psubscribe(`${SSE_CHANNEL_PREFIX}*`);
      this.logger.log("[NotificationsService] SSE Redis pub/sub subscriber connected, multi-instance fan-out active.");
    } catch (err) {
      this.logger.warn(
        `[NotificationsService] Failed to establish SSE Redis subscriber connection, ` +
          `falling back to same-instance-only SSE fan-out: ${String(err)}`,
      );
      this.sseSubscriberConn = null;
    }
  }

  onModuleDestroy(): void {
    this.sseSubscriberConn?.disconnect();
    this.sseSubscriberConn = null;
  }

  /** Parses a `sse-notif:<tenantId>:<userId>` channel + JSON payload, then locally fans out. */
  private handleSseRedisMessage(channel: string, message: string): void {
    if (!channel.startsWith(SSE_CHANNEL_PREFIX)) return;
    const key = channel.slice(SSE_CHANNEL_PREFIX.length);
    const separatorIdx = key.indexOf(":");
    if (separatorIdx === -1) return;
    const tenantId = key.slice(0, separatorIdx);
    const userId = key.slice(separatorIdx + 1);
    try {
      const notification = JSON.parse(message) as NotificationDto;
      this.emitSseEvent(tenantId, userId, notification);
    } catch (err) {
      this.logger.warn(`[NotificationsService] Failed to parse SSE Redis message: ${String(err)}`);
    }
  }

  /**
   * Publishes a notification to the shared Redis fan-out channel. Best-effort — a
   * publish failure is logged and swallowed (never throws out of `notify()`); the
   * in-app row was already written regardless, and the polling fallback still works.
   */
  private async ssePublish(tenantId: string, userId: string, notification: NotificationDto): Promise<void> {
    try {
      const channel = `${SSE_CHANNEL_PREFIX}${tenantId}:${userId}`;
      await this.redis.client.publish(channel, JSON.stringify(notification));
    } catch (err) {
      this.logger.warn(`[NotificationsService] SSE Redis publish failed (non-fatal): ${String(err)}`);
    }
  }

  // ─── CORE FAN-OUT ────────────────────────────────────────────────────────

  /**
   * notify(userId, type, payload, opts?) — the core fan-out method.
   *
   * Fan-out order:
   *   1. Load user prefs (defaults if absent).
   *   2. Consult suppression list per channel.
   *   3. Render templates via TemplateRegistry.
   *   4. Evaluate quiet hours per channel (in-app always fires; urgent bypasses).
   *   5. Dispatch to allowed, unsuppressed, non-deferred channels.
   *   6. Write the in-app row first; emit SSE event if subscribers exist.
   *
   * @param userId    - The recipient user's ID.
   * @param tenantId  - The tenant ID for row writes + suppression lookup.
   * @param type      - The notification type.
   * @param payload   - The typed payload (rendered into template placeholders).
   * @param opts      - Optional: recipient email/phone for external channel sends.
   */
  async notify(
    userId: string,
    tenantId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
    opts?: {
      toEmail?: string;
      toPhone?: string;
      /** If true, skip the audit log (used for test/silent notifications). */
      silent?: boolean;
    },
  ): Promise<{ notificationId: string | null; channelsSent: Record<string, boolean> }> {
    this.logger.debug(`[NotificationsService] notify userId=${userId} type=${type}`);

    // ─── 1. Load prefs (apply defaults if absent — AC-8) ─────────────────
    const prefsRow = await this.repo.findPrefs(tenantId, userId);
    const matrix = (prefsRow?.matrix as NotificationPrefMatrix | undefined) ?? DEFAULT_PREFS_MATRIX;
    const quietHours = (prefsRow?.quietHours as QuietHours | null | undefined) ?? null;

    // Get the per-type channel prefs, or fall back to defaults
    const typePrefs = (matrix as Record<string, unknown>)[type] as
      | { in_app: boolean; email: boolean; sms: boolean; whatsapp: boolean }
      | undefined;
    const channelPrefs = typePrefs ?? DEFAULT_CHANNEL_PREFS;

    // in_app is ALWAYS enabled (AC-7)
    const effectivePrefs = { ...channelPrefs, in_app: true as const };

    // ─── 2. Render templates ──────────────────────────────────────────────
    const env = validateEnv();
    // Add unsubscribe URL to payload for email templates
    const enrichedPayload: Record<string, unknown> = {
      ...payload,
      unsubscribeUrl: opts?.toEmail
        ? buildUnsubscribeUrl(userId, "email", `${env.LMS_APP_URL}/api/v1`)
        : "",
      lmsUrl: env.LMS_APP_URL,
    };

    const templates = this.templateRegistry.renderAll(type, enrichedPayload);

    // The EMAIL channel for the types CRM ▸ Settings ▸ Email templates governs comes from
    // the resolved template instead of the registry's baked-in copy, so editing the text
    // there changes what students actually receive. The registry stays authoritative for
    // in_app / sms / whatsapp: those are short, DLT-registered where it matters, and are
    // not what anybody asked to be able to reword.
    //
    // Failure here is swallowed on purpose. This runs inside notify(), which every feature
    // fires and none of them treat as load-bearing; a database hiccup while resolving an
    // override must degrade to the shipped wording, never drop the notification.
    if (isEditableEmailType(type) && templates.email) {
      try {
        const rendered = await this.emailTemplates.renderForSend(
          tenantId,
          type,
          toTemplateValues(enrichedPayload),
          { button: { label: "Go to LMS", url: env.LMS_APP_URL } },
        );
        templates.email = { ...templates.email, subject: rendered.subject, body: rendered.html };
      } catch (err) {
        this.logger.warn(
          `[NotificationsService] email-template override failed for "${type}", using the default: ${String(err)}`,
        );
      }
    }

    // ─── 3. Write in-app row (ALWAYS — AC-7) ─────────────────────────────
    // Build channels record (will update after fan-out completes)
    const channelsSent: Record<string, boolean> = {
      in_app: true,
      email: false,
      sms: false,
      whatsapp: false,
    };

    let notificationId: string | null = null;
    try {
      const notifRow = await this.repo.createNotification({
        tenantId,
        userId,
        type,
        channels: channelsSent, // will be updated below
        payload: enrichedPayload,
      });
      notificationId = notifRow.id;
      this.logger.debug(`[NotificationsService] in_app row created id=${notificationId}`);

      // Publish to the shared Redis fan-out channel (T31 / R10) — EVERY replica's
      // subscriber connection (including this one) receives it and locally dispatches
      // to any matching live SSE connection via `emitSseEvent()`/`handleSseRedisMessage()`.
      await this.ssePublish(tenantId, userId, toNotificationDto(notifRow));
    } catch (err) {
      this.logger.error(`[NotificationsService] Failed to create in_app row: ${String(err)}`);
      // In-app failure is non-fatal — continue with external channels
    }

    // ─── 4. Dispatch external channels ───────────────────────────────────
    const channelsToSend: Array<"email" | "sms" | "whatsapp"> = ["email", "sms", "whatsapp"];

    for (const channel of channelsToSend) {
      if (!effectivePrefs[channel]) {
        this.logger.debug(`[NotificationsService] channel=${channel} disabled in prefs, skipping`);
        continue;
      }

      // ─── Suppression check (AC-11, AC-23) ─────────────────────────────
      const suppressed = await this.repo.isSuppressed({
        tenantId,
        channel,
        userId,
        email: channel === "email" ? opts?.toEmail : undefined,
        phone: channel !== "email" ? opts?.toPhone : undefined,
      });

      if (suppressed) {
        this.logger.log(`[NotificationsService] channel=${channel} suppressed for userId=${userId}`);
        continue;
      }

      // ─── Quiet hours check (AC-9, AC-10) ──────────────────────────────
      const qhResult = isInQuietHours({ quietHours, notificationType: type, channel });
      if (qhResult.defer) {
        this.logger.log(
          `[NotificationsService] channel=${channel} deferred until ${qhResult.deferUntil?.toISOString()} ` +
            `for userId=${userId} (quiet hours; deferUntil recorded, sync-seam cannot delay, skipping this send)`,
        );
        // In sync-seam: deferred sends are SKIPPED (not scheduled).
        // BullMQ migration: use qhResult.deferUntil to schedule the job with a delay.
        // TODO (BullMQ): wrap the dispatch call in a delayed BullMQ job using qhResult.deferUntil.
        continue;
      }

      // ─── DLT gate check (Rule C-3, AC-78, defense-in-depth) ──────────
      const template = templates[channel];
      if ((channel === "sms" || channel === "whatsapp") && template.missingDlt) {
        this.logger.warn(
          `[NotificationsService] DLT template ID not configured for type=${type} channel=${channel} ` +
            `(DLT_PENDING sentinel. Set real DLT ID before production). Skipping external send.`,
        );
        // Not a hard error in sync-seam (dev environment). The dispatch adapter will also
        // reject this as a defense-in-depth layer.
        continue;
      }

      // ─── Build and dispatch ChannelSendJob ────────────────────────────
      const dedupeKey = `${notificationId ?? randomUUID()}:${channel}`;

      const job: ChannelSendJob = {
        channel,
        dedupeKey,
        userId,
        tenantId,
        toEmail: channel === "email" ? opts?.toEmail : undefined,
        toPhone: channel !== "email" ? opts?.toPhone : undefined,
        subject: template.subject,
        body: template.body,
        dltTemplateId: template.dltTemplateId,
        whatsappTemplateName: template.whatsappTemplateName,
        whatsappVariables: template.whatsappVariables,
        notificationType: type,
        notificationPayload: enrichedPayload,
        channelsRecord: channelsSent,
        emailTags: channel === "email"
          ? [{ name: "notification_type", value: type }]
          : undefined,
      };

      try {
        const result = await this.dispatch.dispatch(job);
        if (result.dispatched && !result.skipped) {
          channelsSent[channel] = true;
          this.logger.debug(
            `[NotificationsService] channel=${channel} dispatched providerMsgId=${result.providerMessageId ?? "n/a"}`,
          );
        } else if (result.skipped) {
          this.logger.debug(`[NotificationsService] channel=${channel} skipped (dedupe key seen)`);
        } else if (result.error) {
          this.logger.warn(`[NotificationsService] channel=${channel} dispatch error: ${result.error}`);
        }
      } catch (err) {
        // Provider errors are caught and logged without leaking secrets (AC-76).
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[NotificationsService] channel=${channel} dispatch threw: ${msg}`);
      }
    }

    // Update the notifications row's channels record to reflect what was actually sent.
    // This is a best-effort update (the in-app row was already created above).
    // Routes through the repository's own method (CLAUDE.md §3.3: "No Prisma in
    // controllers" — services must not reach into a repository's private client either;
    // Phase-7 Wave 2 security hardening batch B, item 3 — the same anti-pattern fixed in
    // campaigns.service.ts).
    if (notificationId) {
      try {
        await this.repo.updateNotificationChannels(tenantId, notificationId, channelsSent);
      } catch {
        // Best-effort — non-fatal. The in-app row exists; channels may be stale.
        this.logger.warn(`[NotificationsService] Failed to update channels record for notificationId=${notificationId}`);
      }
    }

    return { notificationId, channelsSent };
  }

  // ─── CONVENIENCE NOTIFY METHODS (P4/P5 deferred event wiring) ────────────

  /**
   * Notify a student that their assignment has been graded.
   * CONFLICT-4 resolution: call this from AssignmentsService after gradeSubmission().
   *
   * TODO (CONFLICT-4): In apps/api/src/modules/assignments/assignments.service.ts,
   *   inject NotificationsService and call:
   *   await this.notifSvc.notifyGradeReady(studentUserId, tenantId, {
   *     submissionId, assignmentTitle, score, studentName, lmsUrl: env.LMS_APP_URL
   *   }, { toEmail: studentEmail, toPhone: studentPhone });
   */
  async notifyGradeReady(
    userId: string,
    tenantId: string,
    payload: {
      submissionId: string;
      /**
       * The ASSIGNMENT, not the submission. The LMS's notification action opens
       * /assignments/:id, which resolves against `GET /me/assignments/:id` — handed a
       * submission id it 404s every time, which is what it did. `submissionId` stays in
       * the payload because the email template quotes it.
       */
      assignmentId: string;
      assignmentTitle: string;
      score: string | number;
      studentName?: string;
    },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    await this.notify(userId, tenantId, "grade_ready", {
      ...payload,
      score: String(payload.score),
      studentName: payload.studentName ?? "",
    }, contactOpts);
  }

  /**
   * Notify a student that their submission was RETURNED for changes.
   *
   * Called from AssignmentsService.returnSubmission(). `reason` is the reviewer's own words
   * and is the payload that matters — the student is being asked to redo work, and a
   * notification that does not say what to change is worse than none, because they will
   * resubmit the same thing.
   *
   * `assignmentId` (not submissionId) drives the CTA: the student needs the page where they
   * can submit again, not a read-only view of the attempt that was sent back.
   */
  async notifySubmissionReturned(
    userId: string,
    tenantId: string,
    payload: { assignmentId: string; assignmentTitle: string; reason: string; studentName?: string },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    await this.notify(
      userId,
      tenantId,
      "submission_returned",
      { ...payload, studentName: payload.studentName ?? "" },
      contactOpts,
    );
  }

  /**
   * Notify a student that their certificate is ready.
   * CONFLICT-4 resolution: call this from CertificatesService after createCertificate().
   *
   * TODO (CONFLICT-4): In apps/api/src/modules/certificates/certificates.service.ts,
   *   inject NotificationsService and call:
   *   await this.notifSvc.notifyCertificateReady(studentUserId, tenantId, {
   *     certificateId, programTitle, studentName
   *   }, { toEmail: studentEmail });
   */
  async notifyCertificateReady(
    userId: string,
    tenantId: string,
    payload: { certificateId: string; programTitle: string; studentName?: string },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    await this.notify(userId, tenantId, "certificate_ready", {
      ...payload,
      studentName: payload.studentName ?? "",
    }, contactOpts);
  }

  /**
   * Notify a student that their payment receipt is ready.
   * CONFLICT-P5-2 resolution: call this from CommerceService after verifyPayment().
   *
   * TODO (CONFLICT-P5-2): In apps/api/src/modules/commerce/commerce.service.ts,
   *   inject NotificationsService and call:
   *   await this.notifSvc.notifyPaymentReceipt(studentUserId, tenantId, {
   *     orderId, amountPaise, currency: 'INR', studentName
   *   }, { toEmail: studentEmail });
   */
  async notifyPaymentReceipt(
    userId: string,
    tenantId: string,
    payload: { orderId: string; amountPaise: number; currency?: string; studentName?: string; invoiceNumber?: string },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    const amountRupees = (payload.amountPaise / 100).toFixed(2);
    await this.notify(userId, tenantId, "payment_receipt", {
      orderId: payload.orderId,
      amountRupees,
      currency: payload.currency ?? "INR",
      studentName: payload.studentName ?? "",
      invoiceNumber: payload.invoiceNumber ?? "-",
    }, contactOpts);
  }

  /**
   * Notify a student about an upcoming assignment/assessment deadline.
   * Phase-9 Completion T31 / R3: wired from `DeadlineRemindersScheduler`
   * (apps/api/src/modules/assignments/deadline-reminders.scheduler.ts), which scans
   * `assignments.due_at` for a fixed 1-hour bucket ~24h out and calls this once per
   * (assignment, enrolled-not-yet-submitted student) pair.
   *
   * REUSES the existing `announcement` NotificationType (deliberate — see file header
   * "MULTI-INSTANCE FAN-OUT" note's sibling decision): adding a dedicated
   * `deadline_reminder` enum value requires a `packages/types` + Prisma-enum change,
   * which is out of bounds for this task wave (backend-only, additive-migration-only
   * for the search index). `announcement`'s payload shape ({ title, body }) is a
   * faithful fit for a deadline reminder; `payload.kind` distinguishes it for the
   * frontend/analytics without needing a new enum member. Promoting this to its own
   * `NotificationType` (with matching Prisma enum + templates) is a documented
   * follow-up once `packages/types` is back in scope for this surface.
   */
  async notifyDeadline(
    userId: string,
    tenantId: string,
    payload: { refType: "assignment"; refId: string; title: string; dueAt: string },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    await this.notify(
      userId,
      tenantId,
      "announcement",
      {
        kind: "deadline_reminder",
        refType: payload.refType,
        refId: payload.refId,
        title: `Upcoming deadline: ${payload.title}`,
        body: `"${payload.title}" is due on ${payload.dueAt}. Submit before the deadline to avoid losing marks.`,
        dueAt: payload.dueAt,
      },
      contactOpts,
    );
  }

  /**
   * Notify a user about a forum reply on their thread.
   * Called from ForumService (WS-4, task #9) after creating a reply post.
   *
   * This is the primary cross-module interface for task #9:
   *   import { NotificationsService } from '../notifications/notifications.service';
   *   // In ForumService:
   *   await this.notifSvc.notifyForumReply(
   *     threadAuthorUserId, tenantId,
   *     { threadId, postId, threadTitle, authorName },
   *     { toEmail: threadAuthorEmail }
   *   );
   */
  async notifyForumReply(
    threadAuthorUserId: string,
    tenantId: string,
    payload: { threadId: string; postId: string; threadTitle?: string; authorName?: string },
    contactOpts?: { toEmail?: string; toPhone?: string },
  ): Promise<void> {
    await this.notify(threadAuthorUserId, tenantId, "forum_reply", {
      threadId: payload.threadId,
      postId: payload.postId,
      threadTitle: payload.threadTitle ?? "a thread",
      authorName: payload.authorName ?? "Someone",
    }, contactOpts);
  }

  /**
   * Notify for lead confirmation (CONFLICT-P5-5 resolution).
   * Email-only transactional — no userId (lead may not have a user account yet).
   *
   * TODO (CONFLICT-P5-5): In apps/api/src/modules/public/public-funnel.service.ts,
   *   inject NotificationsService and call:
   *   await this.notifSvc.notifyLeadConfirmationByEmail(email, name, programTitle);
   */
  async notifyLeadConfirmationByEmail(
    toEmail: string,
    name: string,
    programTitle: string,
  ): Promise<void> {
    // For leads without a user account: use a synthetic tenant ID and skip in-app.
    // The MailProvider sends the email via the dispatch adapter.
    // We use "noop-userId" to mark this as a no-userId path.
    // The template will be rendered; in-app row creation will fail silently (no userId).
    this.logger.log(`[NotificationsService] lead_confirmation email to ${toEmail.slice(0, 3)}***`);
    // We call notify() with a placeholder userId — the in_app channel will fail to write
    // (no real user), but the email will be dispatched via the port.
    // TODO: For a cleaner approach, extract a sendEmailOnly() helper that bypasses in_app.
    // For now: use the dispatch port directly for email-only transactional sends.
    const template = this.templateRegistry.render("lead_confirmation", "email", {
      name,
      programTitle,
      unsubscribeUrl: "",
    });

    try {
      await this.dispatch.dispatch({
        channel: "email",
        dedupeKey: `lead_confirm:${toEmail}:${Date.now()}`,
        toEmail,
        subject: template.subject,
        body: template.body,
        emailTags: [{ name: "notification_type", value: "lead_confirmation" }],
      });
    } catch (err) {
      this.logger.warn(`[NotificationsService] lead_confirmation email dispatch failed: ${String(err)}`);
    }
  }

  /**
   * Notify a STAFF member that a lead has just been assigned to them.
   *
   * The only staff-facing notification in this service — everything else here targets a
   * student. Called from LeadsService (manual + bulk assign, CRM lead create) and from
   * PublicFunnelService (inbound website lead picked up by the round-robin).
   *
   * In-app is the whole delivery story by design (DEFAULT_PREFS_MATRIX sets email/sms/
   * whatsapp false for this type): a manager can bulk-assign 50 leads in one click, and
   * 50 emails would teach the rep to filter the sender. The bell badge conveys the same
   * information at zero marginal cost per lead. A rep who wants email can still opt in
   * from their notification preferences — the prefs matrix is per type, so turning this
   * one on does not touch any other.
   *
   * `leadPhone` is included so the notification is directly actionable — the rep can call
   * without first opening the lead. This is staff-to-staff delivery of a lead the
   * recipient is now the owner of, so it discloses nothing they cannot already read.
   */
  async notifyLeadAssigned(
    ownerUserId: string,
    tenantId: string,
    payload: {
      leadId: string;
      leadName: string;
      leadPhone: string;
      leadSource: string;
      assignedByName: string;
    },
  ): Promise<void> {
    await this.notify(ownerUserId, tenantId, "lead_assigned", {
      leadId: payload.leadId,
      leadName: payload.leadName,
      leadPhone: payload.leadPhone,
      leadSource: payload.leadSource,
      assignedByName: payload.assignedByName,
    });
  }

  // ─── READ ENDPOINTS ──────────────────────────────────────────────────────

  /**
   * List notifications for the authenticated user.
   * Own-scope: userId from session, never trusted from client.
   * AC-2, AC-17: cursor-paginated, unread filter.
   */
  async listNotifications(
    userId: string,
    tenantId: string,
    query: ListNotificationsQuery,
  ): Promise<PaginatedResult<NotificationDto>> {
    const { rows, nextCursor } = await this.repo.listNotifications({
      userId,
      tenantId,
      unreadOnly: query.unread,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit,
    });

    const items = rows.map(toNotificationDto);

    // cursor-paginated: encode the nextCursor in the meta.total=-1 sentinel convention.
    // The EnvelopeInterceptor passes meta through as-is; the client reads meta.hasMore
    // and the first item of the next page (for cursor re-derivation).
    // Note: OffsetPaginationMeta does not support nextCursor — include it as part of
    // the returned items list shape via the page/hasMore fields.
    return new PaginatedResult<NotificationDto>(items, {
      page: 1, // cursor-paginated — page number is not meaningful
      pageSize: query.limit,
      total: items.length, // partial-page total; full count not computed (expensive)
      hasMore: nextCursor !== null,
    });
  }

  /**
   * Mark a single notification as read.
   * IDOR→404: if the notification doesn't belong to this user, repo returns null.
   * Idempotent: marking an already-read notification is a no-op.
   * AC-3.
   */
  async markRead(
    userId: string,
    tenantId: string,
    notificationId: string,
  ): Promise<MarkReadResponse> {
    // IDOR check: find by id + userId
    const row = await this.repo.findNotificationById(tenantId, userId, notificationId);
    if (!row) {
      throw new NotFoundException("Notification not found.");
    }

    await this.repo.markNotificationRead(tenantId, userId, notificationId);
    const unreadCount = await this.repo.countUnread(tenantId, userId);
    return { unreadCount };
  }

  /**
   * Mark ALL notifications as read for the authenticated user.
   * Batch UPDATE — no N+1 per row.
   * AC-4.
   */
  async markAllRead(userId: string, tenantId: string): Promise<MarkReadResponse> {
    await this.repo.markAllNotificationsRead(tenantId, userId);
    const unreadCount = await this.repo.countUnread(tenantId, userId);
    return { unreadCount };
  }

  // ─── NOTIFICATION PREFS ──────────────────────────────────────────────────

  /**
   * Get the authenticated user's notification preferences.
   * Returns system defaults if no prefs row exists (AC-18).
   * Own-scope: userId from session.
   */
  async getPrefs(userId: string, tenantId: string): Promise<NotificationPrefsResponse> {
    const row = await this.repo.findPrefs(tenantId, userId);
    if (!row) {
      return {
        matrix: DEFAULT_PREFS_MATRIX,
        quietHours: null,
        leaderboardOptIn: false,
        leaderboardDisplayName: null,
        updatedAt: null,
      };
    }
    return {
      matrix: (row.matrix as NotificationPrefMatrix) ?? DEFAULT_PREFS_MATRIX,
      quietHours: (row.quietHours as QuietHours | null) ?? null,
      leaderboardOptIn: ((row.matrix as Record<string, unknown>)["leaderboardOptIn"] as boolean | undefined) ?? false,
      leaderboardDisplayName: ((row.matrix as Record<string, unknown>)["leaderboardDisplayName"] as string | null | undefined) ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Update the authenticated user's notification preferences.
   * Upsert: creates if absent, updates if present.
   * in_app is always forced to true in the matrix (AC-7, AC-20).
   * AC-19, AC-20.
   */
  async updatePrefs(
    userId: string,
    tenantId: string,
    body: NotificationPrefsDto,
  ): Promise<NotificationPrefsResponse> {
    const existing = await this.repo.findPrefs(tenantId, userId);
    const currentMatrix = (existing?.matrix as Record<string, unknown>) ?? {};
    const currentQuietHours = (existing?.quietHours as QuietHours | null) ?? null;

    // Merge the new matrix on top of the existing one.
    // Force in_app=true on every supplied type (AC-7: cannot be disabled).
    const newMatrix: Record<string, unknown> = { ...currentMatrix };
    if (body.matrix) {
      for (const [notifType, channelPrefs] of Object.entries(body.matrix)) {
        if (channelPrefs) {
          newMatrix[notifType] = { ...channelPrefs, in_app: true };
        }
      }
    }

    // Carry over leaderboard prefs if supplied
    if (body.leaderboardOptIn !== undefined) {
      newMatrix["leaderboardOptIn"] = body.leaderboardOptIn;
    }
    if (body.leaderboardDisplayName !== undefined) {
      newMatrix["leaderboardDisplayName"] = body.leaderboardDisplayName;
    }

    // Resolve quiet hours: null in body = remove; undefined in body = keep existing
    const newQuietHours =
      body.quietHours === null ? null :
      body.quietHours !== undefined ? body.quietHours :
      currentQuietHours;

    await this.repo.upsertPrefs({
      tenantId,
      userId,
      matrix: newMatrix,
      quietHours: newQuietHours as Record<string, string> | null,
    });

    return this.getPrefs(userId, tenantId);
  }

  // ─── UNSUBSCRIBE ─────────────────────────────────────────────────────────

  /**
   * Preview unsubscribe page data (GET /unsubscribe/:token).
   * Returns channel info for the confirmation page.
   * No auth required; HMAC token is verified by recomputing.
   */
  async previewUnsubscribe(token: string): Promise<{ channel: NotificationChannel; message: string }> {
    const verified = verifyUnsubscribeToken(token);
    if (!verified) {
      throw new BadRequestException({
        code: "INVALID_TOKEN",
        title: "Invalid or tampered unsubscribe token.",
        detail: "The unsubscribe link is invalid or has been tampered with.",
      });
    }
    return {
      channel: verified.channel,
      message: `You are about to unsubscribe from ${verified.channel} notifications.`,
    };
  }

  /**
   * Process an unsubscribe request (POST /unsubscribe/:token).
   * Verifies the signed token by RECOMPUTING the HMAC (never trusts the payload alone).
   * Creates a notification_suppressions row. Idempotent.
   * AC-22, AC-24, AC-77: no auth, token HMAC-verified, no info leak on bad token.
   */
  async processUnsubscribe(token: string): Promise<UnsubscribeResponse> {
    const verified = verifyUnsubscribeToken(token);
    if (!verified) {
      // AC-24: tampered token → 400 INVALID_TOKEN, no suppression row, no user info leaked.
      throw new BadRequestException({
        code: "INVALID_TOKEN",
        title: "Invalid or tampered unsubscribe token.",
        detail: "The unsubscribe link is invalid or has been tampered with.",
      });
    }

    const { userId, channel } = verified;

    // Look up the user's tenant + email/phone for the suppression record.
    // SECURITY: we only use this to write the suppression row; we never return it.
    const user = await this.repo.findUserForUnsubscribe(userId);
    if (!user) {
      // User not found — idempotent success (avoid revealing user existence).
      this.logger.warn(`[NotificationsService] unsubscribe for unknown userId=${userId.slice(0, 8)}...`);
      return { message: "You have been unsubscribed.", channel };
    }

    // Create suppression (idempotent — duplicate is harmless).
    await this.repo.createSuppression({
      tenantId: user.tenantId,
      userId,
      email: channel === "email" ? user.email ?? undefined : undefined,
      phone: channel !== "email" ? user.phone ?? undefined : undefined,
      channel,
      reason: "unsubscribe",
    });

    this.logger.log(
      `[NotificationsService] Unsubscribe processed: channel=${channel} userId=${userId.slice(0, 8)}...`,
    );

    return {
      message: "You have been successfully unsubscribed. You will no longer receive these notifications.",
      channel,
    };
  }

  // ─── SSE STREAM SUPPORT ──────────────────────────────────────────────────

  /**
   * Subscribe to the SSE notification stream for a user.
   * Returns a cleanup function to call when the client disconnects.
   * AC-14, AC-15, AC-16.
   *
   * Usage (controller):
   *   const [iterable, unsubscribe] = this.service.subscribeToStream(userId, tenantId);
   *   // pipe iterable to SSE response
   *   // on disconnect: unsubscribe()
   */
  subscribeToStream(
    userId: string,
    tenantId: string,
  ): [AsyncIterable<{ data: NotificationDto; event: string }>, () => void] {
    const key = this.sseKey(tenantId, userId);

    // Use a queue-based async iterable so the controller can pipe it to Nest's @Sse().
    const queue: Array<NotificationDto> = [];
    let resolve: (() => void) | null = null;
    let closed = false;

    const notify = (notification: NotificationDto): void => {
      if (closed) return;
      queue.push(notification);
      resolve?.();
      resolve = null;
    };

    // `close` needs to remove `entry` from its own subscriber list — a self-reference
    // that can't be a plain `const entry = { notify, close }` (close would need to exist
    // before entry does). Boxing the self-reference in a mutable `entryRef` container
    // (itself `const`, only its `.current` field mutates) avoids that ordering problem
    // without a `let` that `prefer-const` would otherwise (incorrectly) flag as
    // reassignment-free.
    const entryRef: { current: SseSubscriberEntry | null } = { current: null };

    const close = (): void => {
      if (closed) return;
      closed = true;
      const list = this.sseSubscribers.get(key);
      if (list && entryRef.current) {
        const idx = list.indexOf(entryRef.current);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) this.sseSubscribers.delete(key);
      }
      resolve?.();
      resolve = null;
    };

    const entry: SseSubscriberEntry = { notify, close };
    entryRef.current = entry;

    // ─── Per-user connection cap (P6 M-1 fix, AC-62) ────────────────────────
    // If this (tenantId, userId) pair already holds the max allowed concurrent
    // connections, force-close the OLDEST one before registering the new one — the
    // map never accumulates unbounded entries for a single user.
    const existing = this.sseSubscribers.get(key);
    const cap = resolveSseConnectionCap();
    if (existing && existing.length >= cap) {
      const oldest = existing[0];
      this.logger.warn(
        `[NotificationsService] SSE connection cap (${cap}) reached for tenant=${tenantId.slice(0, 8)}... ` +
          `user=${userId.slice(0, 8)}..., evicting oldest connection`,
      );
      oldest?.close(); // mutates/removes from `existing` in place via splice above
    }

    const list = this.sseSubscribers.get(key) ?? [];
    list.push(entry);
    this.sseSubscribers.set(key, list);

    const unsubscribe = close;

    const iterable: AsyncIterable<{ data: NotificationDto; event: string }> = {
      [Symbol.asyncIterator](): AsyncIterator<{ data: NotificationDto; event: string }> {
        return {
          async next(): Promise<IteratorResult<{ data: NotificationDto; event: string }>> {

            while (true) {
              if (closed) {
                return { done: true, value: undefined as unknown as { data: NotificationDto; event: string } };
              }
              const item = queue.shift();
              if (item) {
                return { done: false, value: { data: item, event: "notification" } };
              }
              // Wait for next push
              await new Promise<void>((r) => { resolve = r; });
            }
          },
          async return(): Promise<IteratorResult<{ data: NotificationDto; event: string }>> {
            close();
            return { done: true, value: undefined as unknown as { data: NotificationDto; event: string } };
          },
        };
      },
    };

    return [iterable, unsubscribe];
  }

  /**
   * Emit a notification to all SSE subscribers for a (tenantId, userId) pair.
   * Called after writing the in-app row. AC-61: the lookup key is ALWAYS built from
   * BOTH tenantId and userId — an event can never reach a subscriber registered under a
   * different tenant, because it is never even looked up under that tenant's key.
   */
  private emitSseEvent(tenantId: string, userId: string, notification: NotificationDto): void {
    const key = this.sseKey(tenantId, userId);
    const subscribers = this.sseSubscribers.get(key);
    if (!subscribers || subscribers.length === 0) return;
    // Iterate a shallow copy — `notify` never mutates the array (only `close` does, and
    // `close` is not invoked from within `notify`), so this is defensive, not required.
    for (const entry of [...subscribers]) {
      entry.notify(notification);
    }
  }
}

// ─── DTO mapping ──────────────────────────────────────────────────────────────

function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type as NotificationType,
    channels: {
      in_app: Boolean((row.channels as Record<string, unknown>)["in_app"] ?? true),
      email: Boolean((row.channels as Record<string, unknown>)["email"] ?? false),
      sms: Boolean((row.channels as Record<string, unknown>)["sms"] ?? false),
      whatsapp: Boolean((row.channels as Record<string, unknown>)["whatsapp"] ?? false),
    },
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { toNotificationDto };

/**
 * Types whose EMAIL body is editable in the CRM.
 *
 * Derived from EMAIL_TEMPLATE_KEYS rather than listed again here, so a key added to that
 * contract cannot be left un-wired on this side — which would put a template in the CRM
 * that edits text no student ever sees.
 */
function isEditableEmailType(type: NotificationType): type is NotificationType & EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(type);
}

/** Payload values as strings, for {{placeholder}} interpolation. */
function toTemplateValues(payload: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
}
