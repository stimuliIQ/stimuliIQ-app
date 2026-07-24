// apps/api/src/modules/bulk-actions/saved-views.service.spec.ts
//
// Unit tests for SavedViewsService — own-scope create/list/remove + IDOR->404.

import { NotFoundException } from "@nestjs/common";
import { SavedViewsService } from "./saved-views.service";
import { SavedViewsRepository, type SavedViewRow } from "./saved-views.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<SavedViewsRepository> {
  return {
    create: jest.fn(),
    list: jest.fn(),
    findOwnById: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<SavedViewsRepository>;
}

const ROW: SavedViewRow = {
  id: "sv-1",
  module: "leads",
  name: "My Hot Leads",
  filters: { stage: "negotiation" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("SavedViewsService", () => {
  let service: SavedViewsService;
  let repo: Mocked<SavedViewsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new SavedViewsService(repo as unknown as SavedViewsRepository);
  });

  it("create() delegates to the repository with the caller's own userId", async () => {
    repo.create.mockResolvedValue(ROW);

    const result = await service.create("tenant-1", "user-1", {
      module: "leads",
      name: "My Hot Leads",
      filters: { stage: "negotiation" },
    });

    expect(repo.create).toHaveBeenCalledWith("tenant-1", "user-1", "leads", "My Hot Leads", { stage: "negotiation" });
    expect(result.id).toBe("sv-1");
  });

  it("list() returns own saved views for the requested module", async () => {
    repo.list.mockResolvedValue([ROW]);

    const result = await service.list("tenant-1", "user-1", { module: "leads", page: 1, pageSize: 20 });

    expect(repo.list).toHaveBeenCalledWith("tenant-1", "user-1", "leads");
    expect(result).toHaveLength(1);
  });

  describe("remove", () => {
    it("soft-deletes an owned saved view", async () => {
      repo.findOwnById.mockResolvedValue(ROW);

      await service.remove("tenant-1", "user-1", "sv-1");

      expect(repo.softDelete).toHaveBeenCalledWith("sv-1");
    });

    it("throws 404 (IDOR-safe) for a saved view owned by a different user", async () => {
      repo.findOwnById.mockResolvedValue(null);

      await expect(service.remove("tenant-1", "user-1", "sv-other")).rejects.toThrow(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
