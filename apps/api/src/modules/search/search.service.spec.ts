// apps/api/src/modules/search/search.service.spec.ts
//
// Unit tests for SearchService, own-enrolled scope resolution + type filtering +
// "no enrollments -> empty results, not an error".

import { SearchService } from "./search.service";
import { SearchRepository, type SearchHitRow } from "./search.repository";
import { LmsRepository } from "../lms/lms.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockSearchRepo(): Mocked<SearchRepository> {
  return {
    findEnrolledProgramIds: jest.fn(),
    findEnrolledBatchIds: jest.fn(),
    searchLessons: jest.fn(),
    searchResources: jest.fn(),
    searchForumThreads: jest.fn(),
  } as unknown as Mocked<SearchRepository>;
}

function mockLmsRepo(): Mocked<LmsRepository> {
  return { findStudentProfileId: jest.fn() } as unknown as Mocked<LmsRepository>;
}

const LESSON_HIT: SearchHitRow = {
  type: "lesson",
  id: "lesson-1",
  title: "Intro to REST APIs",
  snippet: "Learn to build...",
  programId: "prog-1",
  programTitle: "Full Stack Development",
};

describe("SearchService", () => {
  let service: SearchService;
  let repo: Mocked<SearchRepository>;
  let lmsRepo: Mocked<LmsRepository>;

  beforeEach(() => {
    repo = mockSearchRepo();
    lmsRepo = mockLmsRepo();
    service = new SearchService(repo as unknown as SearchRepository, lmsRepo as unknown as LmsRepository);
  });

  it("returns empty results when the caller has no student_profile", async () => {
    lmsRepo.findStudentProfileId.mockResolvedValue(null);

    const result = await service.search("tenant-1", "user-1", { q: "rest api", limit: 20 });

    expect(result.results).toEqual([]);
    expect(repo.findEnrolledProgramIds).not.toHaveBeenCalled();
  });

  it("returns empty results when the student has no active enrollments", async () => {
    lmsRepo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findEnrolledProgramIds.mockResolvedValue([]);
    repo.findEnrolledBatchIds.mockResolvedValue([]);

    const result = await service.search("tenant-1", "user-1", { q: "rest api", limit: 20 });

    expect(result.results).toEqual([]);
    expect(repo.searchLessons).not.toHaveBeenCalled();
  });

  it("fans out to all three search types by default, scoped to enrolled program/batch ids", async () => {
    lmsRepo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findEnrolledProgramIds.mockResolvedValue(["prog-1"]);
    repo.findEnrolledBatchIds.mockResolvedValue(["batch-1"]);
    repo.searchLessons.mockResolvedValue([LESSON_HIT]);
    repo.searchResources.mockResolvedValue([]);
    repo.searchForumThreads.mockResolvedValue([]);

    const result = await service.search("tenant-1", "user-1", { q: "rest api", limit: 20 });

    expect(repo.searchLessons).toHaveBeenCalledWith("tenant-1", ["prog-1"], "rest api", 20);
    expect(repo.searchResources).toHaveBeenCalledWith("tenant-1", ["prog-1"], "rest api", 20);
    expect(repo.searchForumThreads).toHaveBeenCalledWith("tenant-1", ["prog-1"], ["batch-1"], "rest api", 20);
    expect(result.results).toEqual([LESSON_HIT]);
  });

  it("restricts to only the requested types", async () => {
    lmsRepo.findStudentProfileId.mockResolvedValue("student-1");
    repo.findEnrolledProgramIds.mockResolvedValue(["prog-1"]);
    repo.findEnrolledBatchIds.mockResolvedValue(["batch-1"]);
    repo.searchLessons.mockResolvedValue([LESSON_HIT]);

    await service.search("tenant-1", "user-1", { q: "rest api", types: "lesson", limit: 20 });

    expect(repo.searchLessons).toHaveBeenCalled();
    expect(repo.searchResources).not.toHaveBeenCalled();
    expect(repo.searchForumThreads).not.toHaveBeenCalled();
  });
});
