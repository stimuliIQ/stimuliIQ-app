// apps/api/src/modules/tickets/tickets.module.ts
//
// Wires the Phase-9 Support-Desk feature module (docs/plans/phase-9-completion.md T21).
// Five controllers, three service+repository pairs:
//   - TicketsController          — CRM queue management (/crm/tickets*).
//   - MyTicketsController        — LMS student raise/view/reply/rate (/me/tickets*).
//   - CannedResponsesController  — CRM agent macros (/crm/canned-responses*).
//   - KbArticlesController       — CRM admin CRUD (/crm/kb-articles*).
//   - PublicKbArticlesController — anonymous published-only read (/public/kb-articles*).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TicketsController } from "./tickets.controller";
import { MyTicketsController } from "./my-tickets.controller";
import { TicketsService } from "./tickets.service";
import { TicketsRepository } from "./tickets.repository";
import { CannedResponsesController } from "./canned-responses.controller";
import { CannedResponsesService } from "./canned-responses.service";
import { CannedResponsesRepository } from "./canned-responses.repository";
import { KbArticlesController, PublicKbArticlesController } from "./kb-articles.controller";
import { KbArticlesService } from "./kb-articles.service";
import { KbArticlesRepository } from "./kb-articles.repository";

@Module({
  imports: [AuthModule],
  controllers: [
    TicketsController,
    MyTicketsController,
    CannedResponsesController,
    KbArticlesController,
    PublicKbArticlesController,
  ],
  providers: [
    TicketsService,
    TicketsRepository,
    CannedResponsesService,
    CannedResponsesRepository,
    KbArticlesService,
    KbArticlesRepository,
  ],
  exports: [TicketsRepository],
})
export class TicketsModule {}
