// apps/api/src/modules/lesson-notes/lesson-notes.service.spec.ts
//
// Unit tests for LessonNotesService, enrollment-gated own-scope CRUD + IDOR->404.

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LessonNotesService } from "./lesson-notes.service";
import { LessonNotesRepository, type LessonNoteRow } from "./lesson-notes.repository";
import { LmsRepository } from "../lms/lms.repository";
import * as gate from "../lms/lms-enrollment-gate";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<LessonNotesRepository> {
  return {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as Mocked<LessonNotesRepository>;
}

const ROW: LessonNoteRow = {
  id: "note-1",
  lessonId: "lesson-1",
  body: "Remember: idempotency keys prevent double-charges.",
  timestampS: 120,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("LessonNotesService", () => {
  let service: LessonNotesService;
  let repo: Mocked<LessonNotesRepository>;
  let gateSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = mockRepository();
    service = new LessonNotesService(
      repo as unknown as LessonNotesRepository,
      {} as unknown as LmsRepository,
    );
    gateSpy = jest.spyOn(gate, "resolveEnrollmentForLesson");
  });

  afterEach(() => {
    gateSpy.mockRestore();
  });

  describe("create", () => {
    it("creates a note when the lesson is accessible (enrolled or preview)", async () => {
      gateSpy.mockResolvedValue({ enrollment: { id: "enr-1" }, lessonProgramId: "prog-1", isPreview: false });
      repo.create.mockResolvedValue(ROW);

      const result = await service.create("tenant-1", "user-1", "lesson-1", { body: ROW.body, timestampS: 120 });

      expect(gateSpy).toHaveBeenCalledWith("user-1", "tenant-1", "lesson-1", expect.anything());
      expect(result.id).toBe("note-1");
    });

    it("404s when the lesson is not accessible (not enrolled, not preview)", async () => {
      gateSpy.mockResolvedValue(null);

      await expect(
        service.create("tenant-1", "user-1", "lesson-1", { body: "x" }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("throws 404 (IDOR-safe) when the note does not belong to this user/lesson", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update("tenant-1", "user-1", "lesson-1", "note-x", { body: "new" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects an empty update body", async () => {
      repo.findById.mockResolvedValue(ROW);

      await expect(service.update("tenant-1", "user-1", "lesson-1", "note-1", {})).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("updates when the note is owned and the body has fields", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, body: "updated" });

      const result = await service.update("tenant-1", "user-1", "lesson-1", "note-1", { body: "updated" });

      expect(repo.update).toHaveBeenCalledWith("note-1", { body: "updated", timestampS: undefined });
      expect(result.body).toBe("updated");
    });
  });

  describe("remove", () => {
    it("throws 404 (IDOR-safe) for a cross-user note id", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.remove("tenant-1", "user-1", "lesson-1", "note-x")).rejects.toThrow(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("soft-deletes an owned note", async () => {
      repo.findById.mockResolvedValue(ROW);

      await service.remove("tenant-1", "user-1", "lesson-1", "note-1");

      expect(repo.softDelete).toHaveBeenCalledWith("note-1");
    });
  });
});
