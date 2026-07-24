// apps/api/src/modules/bookmarks/bookmarks.module.ts
//
// Phase-9 Completion T29 — own-scope LMS bookmarks (docs/plans/phase-9-completion.md).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BookmarksController } from "./bookmarks.controller";
import { BookmarksService } from "./bookmarks.service";
import { BookmarksRepository } from "./bookmarks.repository";

@Module({
  imports: [AuthModule],
  controllers: [BookmarksController],
  providers: [BookmarksService, BookmarksRepository],
  exports: [BookmarksService, BookmarksRepository],
})
export class BookmarksModule {}
