// Bookmarks contract — Phase 9 Completion, T10/T14/T29. Backs `model Bookmark`
// (polymorphic refType/refId — e.g. "lesson", "video_timestamp", "blog_post").
// Own-scope only (a student can only create/list/delete their own bookmarks) under
// /api/v1/me/bookmarks.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

/** POST /api/v1/me/bookmarks */
export const CreateBookmarkRequestSchema = z
  .object({
    refType: z.string().min(1).max(60).describe("Open-ended, e.g. 'lesson', 'video_timestamp', 'blog_post'."),
    refId: UuidSchema,
    note: z.string().max(1000).optional(),
    timestampS: z.number().int().min(0).optional().describe("Video timestamp in seconds, when refType='video_timestamp'."),
  })
  .strict();
export type CreateBookmarkRequest = z.infer<typeof CreateBookmarkRequestSchema>;

/** GET /api/v1/me/bookmarks */
export const ListBookmarksQuerySchema = z
  .object({
    refType: z.string().min(1).max(60).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBookmarksQuery = z.infer<typeof ListBookmarksQuerySchema>;

export const BookmarkSchema = z.object({
  id: UuidSchema,
  refType: z.string(),
  refId: UuidSchema,
  refTitle: z.string().nullable().describe("Denormalized display title of the bookmarked entity (lesson title, post title, etc.)."),
  note: z.string().nullable(),
  timestampS: z.number().int().min(0).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Bookmark = z.infer<typeof BookmarkSchema>;
