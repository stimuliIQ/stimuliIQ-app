// apps/api/src/modules/notifications/notifications.module.ts
//
// NotificationsModule — WS-1 Notifications core (docs/plans/phase-6.md task #6).
//
// Layering (CLAUDE.md §3.3):
//   NotificationsMeController  — /me/notifications* + /me/notification-prefs (own-scope)
//   UnsubscribeController      — /unsubscribe/:token (public, no auth)
//   NotificationsService       — fan-out engine, prefs, unsubscribe, SSE stream
//   NotificationsRepository    — Prisma data access (notifications, prefs, suppressions)
//
// Imports:
//   AuthModule    — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   DispatchModule — NOTIFICATION_DISPATCH_PORT + TemplateRegistry + isInQuietHours
//                    (built in task #4; includes MailProviderModule + WhatsAppProviderModule
//                    + SMS_PROVIDER — see dispatch.module.ts)
//
// Exports:
//   NotificationsService    — exported so ForumModule (task #9) can inject it for
//                             reply notifications. Also imported by any module that
//                             needs to call notify() for P4/P5 event wiring.
//   NotificationsRepository — exported so ReportSchedulesModule (Wave 2 task #11) can
//                             reuse `isSuppressed()` (Rule C-2) for scheduled-report
//                             delivery, without duplicating the suppression-list check.
//
// CSRF EXCLUSIONS:
//   GET/POST /unsubscribe/:token are excluded from CsrfMiddleware in app.module.ts.
//   These are unauthenticated endpoints protected by HMAC token only.
//
// PERMISSIONS (seeded in P6 schema migration, prisma/seed.ts):
//   notifications.view      (scope: own) — all authenticated users
//   notification_prefs.edit (scope: own) — all authenticated users

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DispatchModule } from "./dispatch/dispatch.module";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";
import { NotificationsMeController, UnsubscribeController } from "./notifications.controller";

@Module({
  imports: [
    // JwtAuthGuard, PermissionsGuard, ScopeInterceptor — required for /me/* guards
    AuthModule,
    // NOTIFICATION_DISPATCH_PORT + TemplateRegistry + Mail/WhatsApp/SMS providers
    DispatchModule,
  ],
  controllers: [
    NotificationsMeController,
    UnsubscribeController,
  ],
  providers: [
    NotificationsService,
    NotificationsRepository,
  ],
  exports: [
    // Export so ForumModule (task #9) + future P4/P5 wiring callers can inject this.
    NotificationsService,
    // Export so ReportSchedulesModule (Wave 2 task #11) can reuse the suppression check.
    NotificationsRepository,
  ],
})
export class NotificationsModule {}
