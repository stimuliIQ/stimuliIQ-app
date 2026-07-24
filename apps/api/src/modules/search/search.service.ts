// apps/api/src/modules/search/search.service.ts
//
// Business logic for GET /me/search (docs/plans/phase-9-completion.md T29). Own-enrolled
// scope: resolves the authenticated student's active enrollments (program ids + batch
// ids — NEVER trusted from the query string) and restricts every search type to that
// set. A user with no active enrollments gets an empty result set, not an error.

import { Injectable } from "@nestjs/common";
import type { GlobalSearchResponse, SearchResultType } from "@repo/types";
import { SearchRepository, type SearchHitRow } from "./search.repository";
import { LmsRepository } from "../lms/lms.repository";
import type { GlobalSearchQuery } from "./dto";

const ALL_TYPES: readonly SearchResultType[] = ["lesson", "resource", "forum_thread"];

function parseTypes(types: string | undefined): SearchResultType[] {
  if (!types) return [...ALL_TYPES];
  const requested = types.split(",").map((t) => t.trim());
  const valid = requested.filter((t): t is SearchResultType => (ALL_TYPES as string[]).includes(t));
  return valid.length > 0 ? valid : [...ALL_TYPES];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly repository: SearchRepository,
    private readonly lmsRepository: LmsRepository,
  ) {}

  async search(tenantId: string, userId: string, query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    const studentId = await this.lmsRepository.findStudentProfileId(tenantId, userId);
    if (!studentId) {
      // Not a student (e.g. staff account with no student_profile) — own-enrolled scope
      // resolves to nothing, not an error.
      return { results: [] };
    }

    const types = parseTypes(query.types);
    const [programIds, batchIds] = await Promise.all([
      this.repository.findEnrolledProgramIds(tenantId, studentId),
      this.repository.findEnrolledBatchIds(tenantId, studentId),
    ]);

    if (programIds.length === 0 && batchIds.length === 0) {
      return { results: [] };
    }

    const searches: Promise<SearchHitRow[]>[] = [];
    if (types.includes("lesson")) {
      searches.push(this.repository.searchLessons(tenantId, programIds, query.q, query.limit));
    }
    if (types.includes("resource")) {
      searches.push(this.repository.searchResources(tenantId, programIds, query.q, query.limit));
    }
    if (types.includes("forum_thread")) {
      searches.push(this.repository.searchForumThreads(tenantId, programIds, batchIds, query.q, query.limit));
    }

    const results = (await Promise.all(searches)).flat();
    // Cap the combined cross-type result set at the requested limit (each individual
    // query is already bounded, but a 3-type fan-out could otherwise return up to 3x).
    return { results: results.slice(0, query.limit) };
  }
}
