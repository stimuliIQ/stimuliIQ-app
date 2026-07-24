// apps/api/src/modules/forum/forum.module.ts
//
// ForumModule — WS-4 Forum / Community (docs/plans/phase-6.md task #9).
//
// Layering (CLAUDE.md §3.3):
//   ForumController      — /forum/* (LMS student/faculty forum surface)
//   CrmForumController   — /crm/forum/* (CRM moderation queue for staff)
//   ForumService         — enrollment-scope + assigned-scope + moderation + vote + notify
//   ForumRepository      — Prisma data access (forum_threads, forum_posts, forum_post_votes)
//
// Imports:
//   AuthModule            — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   NotificationsModule   — exports NotificationsService; ForumService injects it to
//                           send forum_reply notifications (AC-60, WS-1 dependency).
//
// RBAC permissions (seeded in P6 schema migration):
//   forum.read     (enrolled | assigned | branch | all)
//   forum.post     (enrolled | assigned | all)
//   forum.moderate (assigned | branch | all)
//
// Enrollment check: done inside ForumService (not the guard) because the enrolled
// scope requires a DB lookup against forum_threads.batchId + enrollment table —
// the ScopeInterceptor does not have this domain-specific lookup. The guard enforces
// the PERMISSION exists on the role; the SERVICE enforces the SCOPE (IDOR→404).
//
// Wave 5 dependency: NotificationsModule (task #6) must be imported for
// NotificationsService to be available as a provider in this module.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ForumRepository } from "./forum.repository";
import { ForumService } from "./forum.service";
import { ForumController, CrmForumController } from "./forum.controller";

@Module({
  imports: [
    // JwtAuthGuard, PermissionsGuard, ScopeInterceptor
    AuthModule,
    // NotificationsService — for forum_reply notifications (AC-60, WS-1).
    // NotificationsModule exports NotificationsService (see notifications.module.ts).
    NotificationsModule,
  ],
  controllers: [
    ForumController,
    CrmForumController,
  ],
  providers: [
    ForumService,
    ForumRepository,
  ],
  // ForumService is not exported — no other module consumes it.
})
export class ForumModule {}
