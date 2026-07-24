// apps/api/src/modules/notifications/notifications.repository.ts
//
// Prisma data-access layer for the NotificationsModule (WS-1).
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete +
// data-scope filters. No business logic.")
//
// TABLE SCOPE:
//   notifications            — in-app notification rows (per-user, tenant-scoped)
//   notification_prefs       — per-user preferences matrix + quiet hours
//   notification_suppressions — suppression/unsubscribe list (channel + user/email/phone)
//
// ALL queries apply:
//   1. tenant_id filter (cross-tenant isolation — AC-72).
//   2. deleted_at IS NULL (soft-delete extension handles this via the Prisma extension;
//      the repo passes plain queries and relies on the extension).
//
// IDOR: the repository NEVER exposes a user's notifications to another user.
// Own-scope is enforced by always including userId in WHERE clauses.
// The service layer enforces this; the repo mirrors it defensively.
//
// AUDIT: read-only repository — mutations (create/update) are performed via the
// extended Prisma client (PrismaService.client), which auto-writes audit rows via
// the audit extension. No explicit writeAuditLog helper is needed here; the
// extension handles it. For notification_prefs upsert, the audit extension
// captures the before/after state automatically.

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { NotificationChannel, NotificationType } from "@repo/types";
import { PrismaService } from "../../prisma/prisma.service";

/** RFC-4122 UUID shape guard — User.id is @db.Uuid; a non-UUID would raise Postgres 22P02. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Repository row types ─────────────────────────────────────────────────────

export interface NotificationRow {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  channels: Record<string, boolean>;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPrefsRow {
  id: string;
  tenantId: string;
  userId: string;
  matrix: Record<string, unknown>;
  quietHours: Record<string, string> | null;
  updatedAt: Date;
}

export interface SuppressionRow {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  channel: string;
  reason: string;
  createdAt: Date;
}

export interface ListNotificationsOptions {
  userId: string;
  tenantId: string;
  unreadOnly?: boolean;
  type?: NotificationType;
  cursor?: string;
  limit: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

@Injectable()
export class NotificationsRepository {
  private readonly logger = new Logger(NotificationsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── notifications table ───────────────────────────────────────────────────

  /**
   * Create a new in-app notification row.
   * The audit extension writes an audit_logs entry automatically.
   */
  async createNotification(data: {
    tenantId: string;
    userId: string;
    type: NotificationType;
    channels: Record<string, boolean>;
    payload: Record<string, unknown>;
  }): Promise<NotificationRow> {
    const row = await this.prisma.client.notification.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        type: data.type as never, // cast: Prisma enum from DB, types align at runtime
        channels: data.channels,
        payload: data.payload,
      },
    });
    return this.toNotificationRow(row);
  }

  /**
   * List notifications for a user (own-scope only).
   * Cursor-paginated by createdAt DESC.
   * AC-2: returns unread-only when unreadOnly=true.
   * AC-5/AC-72: userId is always constrained → IDOR-safe.
   */
  async listNotifications(opts: ListNotificationsOptions): Promise<{
    rows: NotificationRow[];
    nextCursor: string | null;
  }> {
    const where: Record<string, unknown> = {
      tenantId: opts.tenantId,
      userId: opts.userId,
    };

    if (opts.unreadOnly) {
      where["readAt"] = null;
    }

    if (opts.type) {
      where["type"] = opts.type;
    }

    // Cursor-based pagination: cursor is the `createdAt` ISO string of the last row.
    if (opts.cursor) {
      where["createdAt"] = { lt: new Date(opts.cursor) };
    }

    const rows = await this.prisma.client.notification.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1, // fetch one extra to detect hasMore
    });

    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.createdAt.toISOString() ?? null : null;

    return {
      rows: pageRows.map((r) => this.toNotificationRow(r)),
      nextCursor,
    };
  }

  /**
   * Find a single notification by ID, scoped to the given user and tenant.
   * Returns null if not found or belongs to a different user/tenant (IDOR→null→404 in service).
   */
  async findNotificationById(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<NotificationRow | null> {
    const row = await this.prisma.client.notification.findFirst({
      where: { id, tenantId, userId },
    });
    return row ? this.toNotificationRow(row) : null;
  }

  /**
   * Mark a single notification as read. Idempotent (sets readAt if null, noop if already set).
   * Returns the updated row.
   * AC-3: own-scope enforced by userId constraint in WHERE.
   */
  async markNotificationRead(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ readAt: Date }> {
    const now = new Date();
    // Idempotent: only update if readAt is null
    await this.prisma.client.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: now },
    });
    return { readAt: now };
  }

  /**
   * Mark ALL notifications for a user as read in a single batch UPDATE.
   * AC-4: uses bulk UPDATE (no N+1 per row).
   * AC-72: scoped to userId+tenantId.
   */
  async markAllNotificationsRead(tenantId: string, userId: string): Promise<number> {
    const now = new Date();
    const result = await this.prisma.client.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: now },
    });
    return result.count;
  }

  /**
   * Update the `channels` record on a notification row to reflect which channels were
   * actually dispatched (best-effort, called post-fan-out by NotificationsService.notify()).
   * Tenant-scoped via `updateMany` (rather than `update({ where: { id } })`) so a stale/
   * forged notificationId can never touch another tenant's row (Phase-7 Wave 2 security
   * hardening batch B, item 3 — replaces a prior `this.repo["prisma"]` private-client
   * reach-through in the service layer).
   */
  async updateNotificationChannels(
    tenantId: string,
    notificationId: string,
    channels: Record<string, boolean>,
  ): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { id: notificationId, tenantId },
      data: { channels },
    });
  }

  /**
   * Count unread notifications for a user (for badge/count updates).
   */
  async countUnread(tenantId: string, userId: string): Promise<number> {
    return this.prisma.client.notification.count({
      where: { tenantId, userId, readAt: null },
    });
  }

  // ─── notification_prefs table ─────────────────────────────────────────────

  /**
   * Find a user's notification preferences row.
   * Returns null if not found (caller applies system defaults — AC-8, AC-18).
   */
  async findPrefs(tenantId: string, userId: string): Promise<NotificationPrefsRow | null> {
    const row = await this.prisma.client.notificationPref.findFirst({
      where: { tenantId, userId },
    });
    return row ? this.toPrefsRow(row) : null;
  }

  /**
   * Upsert the user's notification preferences.
   * AC-19: creates if absent, updates if present. Audit extension writes audit row.
   */
  async upsertPrefs(data: {
    tenantId: string;
    userId: string;
    matrix: Record<string, unknown>;
    quietHours: Record<string, string> | null;
  }): Promise<NotificationPrefsRow> {
    const existing = await this.prisma.client.notificationPref.findFirst({
      where: { tenantId: data.tenantId, userId: data.userId },
    });

    if (existing) {
      const updated = await this.prisma.client.notificationPref.update({
        where: { id: existing.id },
        data: {
          matrix: data.matrix,
          quietHours: data.quietHours ?? undefined,
        },
      });
      return this.toPrefsRow(updated);
    }

    const created = await this.prisma.client.notificationPref.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        matrix: data.matrix,
        quietHours: data.quietHours ?? undefined,
      },
    });
    return this.toPrefsRow(created);
  }

  // ─── notification_suppressions table ──────────────────────────────────────

  /**
   * Check if a user is suppressed on a given channel.
   * Consults by userId, email, or phone (AC-11, AC-23, AC-30).
   * Returns true if any suppression record exists for the given identifiers + channel.
   */
  async isSuppressed(opts: {
    tenantId: string;
    channel: NotificationChannel;
    userId?: string;
    email?: string;
    phone?: string;
  }): Promise<boolean> {
    const conditions: Array<Record<string, unknown>> = [];

    if (opts.userId) {
      conditions.push({ tenantId: opts.tenantId, channel: opts.channel, userId: opts.userId });
    }
    if (opts.email) {
      conditions.push({ tenantId: opts.tenantId, channel: opts.channel, email: opts.email });
    }
    if (opts.phone) {
      conditions.push({ tenantId: opts.tenantId, channel: opts.channel, phone: opts.phone });
    }

    if (conditions.length === 0) return false;

    const count = await this.prisma.client.notificationSuppression.count({
      where: { OR: conditions } as never,
    });

    return count > 0;
  }

  /**
   * Create a suppression record (unsubscribe, bounce, or complaint).
   * Idempotent: re-creating the same suppression is a no-op (duplicate is harmless).
   * AC-22: no auth required at this layer — the service validates the signed token.
   *
   * IDEMPOTENCY (Phase-7 Wave 2 security hardening batch A, item 2b — AC-60): backed by
   * the DB-level partial-unique index on (tenant_id, channel, email) and
   * (tenant_id, channel, phone) added in migration
   * 20260707070000_security_hardening_suppression_unique. A P2002 unique-constraint
   * violation (a repeat unsubscribe/bounce for the same address) is caught here and
   * resolved to the EXISTING active row rather than thrown — matching
   * CampaignsRepository#createBounceSuppression's identical pattern for the same
   * underlying table/constraint.
   */
  async createSuppression(data: {
    tenantId: string;
    userId?: string;
    email?: string;
    phone?: string;
    channel: NotificationChannel;
    reason: "unsubscribe" | "bounce" | "complaint";
  }): Promise<SuppressionRow> {
    try {
      const row = await this.prisma.client.notificationSuppression.create({
        data: {
          tenantId: data.tenantId,
          userId: data.userId ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          channel: data.channel as never,
          reason: data.reason as never,
        },
      });
      return this.toSuppressionRow(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.debug(
          `[NotificationsRepo] createSuppression: duplicate (tenant=${data.tenantId} channel=${data.channel}) — returning existing row (idempotent).`,
        );
        const orConditions: Prisma.NotificationSuppressionWhereInput[] = [];
        if (data.email) orConditions.push({ channel: data.channel as never, email: data.email });
        if (data.phone) orConditions.push({ channel: data.channel as never, phone: data.phone });
        const existing = await this.prisma.client.notificationSuppression.findFirst({
          where: { tenantId: data.tenantId, deletedAt: null, OR: orConditions },
        });
        if (existing) return this.toSuppressionRow(existing);
        // Extremely unlikely (row was deleted between the P2002 and this re-query) —
        // re-throw rather than fabricate a row that no longer exists.
        throw err;
      }
      throw err;
    }
  }

  /**
   * Find user info needed for unsubscribe token verification:
   * email, phone, userId — used to re-derive and verify the HMAC token.
   * SECURITY: only called after HMAC verification; returns minimal data.
   */
  async findUserForUnsubscribe(userId: string): Promise<{
    id: string;
    email: string | null;
    phone: string | null;
    tenantId: string;
  } | null> {
    // Guard the shape before it reaches a @db.Uuid column: a validly-signed token whose
    // decoded userId is not a UUID must resolve to the graceful "unknown user" path (null),
    // not crash Postgres with a 22P02 invalid-uuid error (unhandled 500).
    if (!UUID_RE.test(userId)) {
      return null;
    }
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { id: true, email: true, phone: true, tenantId: true },
    });
    return user ?? null;
  }

  // ─── Row mappers ──────────────────────────────────────────────────────────

  private toNotificationRow(r: {
    id: string;
    tenantId: string;
    userId: string;
    type: string;
    channels: unknown;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): NotificationRow {
    return {
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      type: r.type,
      channels: (r.channels as Record<string, boolean>) ?? {},
      payload: (r.payload as Record<string, unknown>) ?? {},
      readAt: r.readAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toPrefsRow(r: {
    id: string;
    tenantId: string;
    userId: string;
    matrix: unknown;
    quietHours: unknown;
    updatedAt: Date;
  }): NotificationPrefsRow {
    return {
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      matrix: (r.matrix as Record<string, unknown>) ?? {},
      quietHours: (r.quietHours as Record<string, string> | null) ?? null,
      updatedAt: r.updatedAt,
    };
  }

  private toSuppressionRow(r: {
    id: string;
    tenantId: string;
    userId: string | null;
    email: string | null;
    phone: string | null;
    channel: string;
    reason: string;
    createdAt: Date;
  }): SuppressionRow {
    return {
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      email: r.email,
      phone: r.phone,
      channel: r.channel,
      reason: r.reason,
      createdAt: r.createdAt,
    };
  }
}
