// apps/api/src/modules/notifications/notifications.controller.ts
//
// HTTP boundary for the NotificationsModule (WS-1, docs/plans/phase-6.md task #6).
// (CLAUDE.md §3.3: "controller — HTTP boundary, validates DTO via the global Zod pipe,
// returns DTO. No Prisma in controllers.")
//
// ROUTE MAP:
//   GET  /me/notifications             — list notifications (own-scope, cursor-paginated)
//   GET  /me/notifications/stream      — SSE stream (authenticated, own-scoped, AC-14/15/16)
//   POST /me/notifications/:id/read    — mark single notification read (idempotent, IDOR→404)
//   POST /me/notifications/read-all    — mark all read (batch UPDATE)
//   GET  /me/notification-prefs        — get own prefs (system defaults if absent, AC-18)
//   PUT  /me/notification-prefs        — upsert own prefs (in_app locked true, AC-19/20)
//
//   (PUBLIC — CSRF-excluded in app.module.ts):
//   GET  /unsubscribe/:token           — preview unsubscribe page (no auth)
//   POST /unsubscribe/:token           — submit unsubscribe (no auth, token HMAC-verified)
//
// SECURITY:
//   - JwtAuthGuard + PermissionsGuard on all /me/* routes.
//   - Own-scope only: userId always from session (JWT), never from client-supplied body.
//   - IDOR→404: markRead returns 404 if the notification belongs to another user.
//   - SSE stream is authenticated + own-scoped (AC-14, AC-15).
//   - Public unsubscribe endpoints: no auth, no CSRF (excluded in app.module.ts).
//   - No business logic in this class — all delegated to NotificationsService.
//   - X-Accel-Buffering: no set on SSE response (proxy-buffering prevention).
//
// PERMISSIONS USED (seeded in P6 migration):
//   notifications.view      (scope: own) — read + stream + prefs-read
//   notification_prefs.edit (scope: own) — prefs-write

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  Sse,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { Observable, from } from "rxjs";
import type {
  NotificationDto,
  NotificationPrefsResponse,
  NotificationPrefsDto,
  ListNotificationsQuery,
  MarkReadResponse,
  UnsubscribeResponse,
} from "@repo/types";
import {
  ListNotificationsQuerySchema,
  NotificationPrefsDtoSchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { NotificationsService } from "./notifications.service";

// ─── Authenticated /me/* routes ───────────────────────────────────────────────

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class NotificationsMeController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * GET /api/v1/me/notifications
   * List own notifications, newest first, cursor-paginated.
   * AC-2: unread=true returns only unread notifications.
   * AC-17: polling fallback — client polls this when SSE is unavailable.
   * Permission: notifications.view (own)
   */
  @Get("notifications")
  @RequirePermission("notifications.view")
  async listNotifications(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<PaginatedResult<NotificationDto>> {
    return this.service.listNotifications(user.id, user.tenantId, query);
  }

  /**
   * GET /api/v1/me/notifications/stream
   * Server-Sent Events stream (authenticated, own-scoped).
   * AC-14: emits only events for the authenticated user.
   * AC-15: 401 before stream opens if unauthenticated (JwtAuthGuard handles this).
   * AC-16: new notifications arrive within 2 seconds via SSE push.
   *
   * The stream is set up by subscribing to the service's SSE publisher.
   * Cleanup on client disconnect is handled via res.on('close').
   *
   * Note: @Sse returns an Observable<MessageEvent> per NestJS SSE docs.
   * We use rxjs `from` to convert the AsyncIterable from the service.
   * Permission: notifications.view (own)
   */
  @Sse("notifications/stream")
  @RequirePermission("notifications.view")
  notificationsStream(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: false }) res: Response,
  ): Observable<{ data: NotificationDto; event: string }> {
    // Set SSE-appropriate headers (X-Accel-Buffering prevents proxy buffering)
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const [iterable, unsubscribe] = this.service.subscribeToStream(user.id, user.tenantId);

    // Clean up when client disconnects (AC-14: no goroutine/handler leak)
    res.on("close", () => {
      unsubscribe();
    });

    return from(iterable);
  }

  /**
   * POST /api/v1/me/notifications/:id/read
   * Mark a single notification as read. Idempotent.
   * IDOR→404: if the notification doesn't belong to this user, returns 404.
   * AC-3, AC-5.
   * Permission: notifications.view (own)
   */
  @Post("notifications/:id/read")
  @HttpCode(200)
  @RequirePermission("notifications.view")
  async markRead(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MarkReadResponse> {
    return this.service.markRead(user.id, user.tenantId, id);
  }

  /**
   * POST /api/v1/me/notifications/read-all
   * Mark all notifications as read for the authenticated user.
   * Batch UPDATE — no N+1. AC-4.
   * Permission: notifications.view (own)
   */
  @Post("notifications/read-all")
  @HttpCode(200)
  @RequirePermission("notifications.view")
  async markAllRead(
    @CurrentUser() user: RequestUser,
  ): Promise<MarkReadResponse> {
    return this.service.markAllRead(user.id, user.tenantId);
  }

  /**
   * GET /api/v1/me/notification-prefs
   * Get the authenticated user's notification preferences.
   * Returns system defaults if no row exists (not a 404 — AC-18).
   * Permission: notifications.view (own)
   */
  @Get("notification-prefs")
  @RequirePermission("notifications.view")
  async getPrefs(
    @CurrentUser() user: RequestUser,
  ): Promise<NotificationPrefsResponse> {
    return this.service.getPrefs(user.id, user.tenantId);
  }

  /**
   * PUT /api/v1/me/notification-prefs
   * Update the authenticated user's notification preferences.
   * Upsert: creates if absent, updates if present.
   * in_app is always forced to true (AC-7, AC-20).
   * Own-scope: userId from session ONLY — body userId is REJECTED by schema (.strict()).
   * Audit-log entry written by the Prisma audit extension.
   * AC-19, AC-20.
   * Permission: notification_prefs.edit (own)
   */
  @Put("notification-prefs")
  @RequirePermission("notification_prefs.edit")
  async updatePrefs(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(NotificationPrefsDtoSchema)) body: NotificationPrefsDto,
  ): Promise<NotificationPrefsResponse> {
    // AC-20: reject any attempt to supply a userId in the body.
    // Since NotificationPrefsDtoSchema is .strict() and has no userId field, the
    // ZodValidationPipe already strips/rejects it. Belt-and-suspenders:
    if ("userId" in (body as Record<string, unknown>)) {
      throw new BadRequestException({
        code: "INVALID_FIELD",
        title: "userId cannot be supplied in the request body.",
        detail: "Your user identity is determined from the authenticated session.",
      });
    }

    return this.service.updatePrefs(user.id, user.tenantId, body);
  }
}

// ─── Public unsubscribe routes (no auth, CSRF-excluded) ───────────────────────

/**
 * Public unsubscribe controller.
 * No guards — these endpoints are unauthenticated by design (AC-22).
 * CSRF excluded in app.module.ts (no browser session; token HMAC-verified instead).
 *
 * DO NOT add @UseGuards() to this class or any of its methods.
 */
@Controller("unsubscribe")
export class UnsubscribeController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * GET /api/v1/unsubscribe/:token
   * Preview the unsubscribe page — shows which channel will be unsubscribed.
   * No state change. HMAC token is verified.
   * AC-24: tampered token → 400 INVALID_TOKEN; no user info exposed.
   */
  @Get(":token")
  async previewUnsubscribe(
    @Param("token") token: string,
  ): Promise<{ channel: string; message: string }> {
    return this.service.previewUnsubscribe(token);
  }

  /**
   * POST /api/v1/unsubscribe/:token
   * Submit the unsubscribe confirmation.
   * Creates a notification_suppressions row. Idempotent.
   * No authentication required. HMAC token verified by RECOMPUTING the signature.
   * AC-21, AC-22, AC-24, AC-77.
   */
  @Post(":token")
  @HttpCode(200)
  async submitUnsubscribe(
    @Param("token") token: string,
  ): Promise<UnsubscribeResponse> {
    return this.service.processUnsubscribe(token);
  }
}
