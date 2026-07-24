// apps/api/src/modules/bookmarks/bookmarks.service.spec.ts
//
// Unit tests for BookmarksService — own-scope create/list/remove + IDOR->404 +
// duplicate-bookmark 409.

import { ConflictException, NotFoundException } from "@nestjs/common";
import { BookmarksService } from "./bookmarks.service";
import { BookmarksRepository, type BookmarkRow } from "./bookmarks.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<BookmarksRepository> {
  return {
    create: jest.fn(),
    findExisting: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<BookmarksRepository>;
}

const ROW: BookmarkRow = {
  id: "bm-1",
  refType: "lesson",
  refId: "lesson-1",
  refTitle: "Intro to REST APIs",
  note: null,
  timestampS: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("BookmarksService", () => {
  let service: BookmarksService;
  let repo: Mocked<BookmarksRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new BookmarksService(repo as unknown as BookmarksRepository);
  });

  describe("create", () => {
    it("creates a bookmark when none exists for (refType, refId)", async () => {
      repo.findExisting.mockResolvedValue(null);
      repo.create.mockResolvedValue(ROW);

      const result = await service.create("tenant-1", "user-1", { refType: "lesson", refId: "lesson-1" });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        userId: "user-1",
        refType: "lesson",
        refId: "lesson-1",
        note: undefined,
        timestampS: undefined,
      });
      expect(result.id).toBe("bm-1");
      expect(result.refTitle).toBe("Intro to REST APIs");
    });

    it("throws 409 when the (refType, refId) is already bookmarked", async () => {
      repo.findExisting.mockResolvedValue({ id: "bm-1" });

      await expect(
        service.create("tenant-1", "user-1", { refType: "lesson", refId: "lesson-1" }),
      ).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("paginates own bookmarks", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await service.list("tenant-1", "user-1", { page: 1, pageSize: 20 });

      expect(repo.list).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        userId: "user-1",
        refType: undefined,
        page: 1,
        pageSize: 20,
      });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe("remove", () => {
    it("soft-deletes an owned bookmark", async () => {
      repo.findById.mockResolvedValue(ROW);

      await service.remove("tenant-1", "user-1", "bm-1");

      expect(repo.softDelete).toHaveBeenCalledWith("bm-1");
    });

    it("throws 404 (IDOR-safe) when the bookmark does not belong to this user", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.remove("tenant-1", "user-1", "bm-other")).rejects.toThrow(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
