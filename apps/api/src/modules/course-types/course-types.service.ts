// apps/api/src/modules/course-types/course-types.service.ts
//
// Business logic for the CRM-managed course-type list (docs/specs/course-types.md,
// ADR-0068). Two audiences:
//   - the management screen (Admin ▸ Course types) — list/create/update/delete;
//   - every other module that stores or renders a `student_profiles.course_type` key,
//     via `assertKnownKey()` (write path) and `labelMap()` (read path).
//
// THE RULES THAT LIVE HERE, and why:
//   1. The KEY is derived from the label and never editable. A caller-chosen key is a
//      second name for the same option, and the two drift; an editable key silently
//      re-points every student row that already stores it.
//   2. Writes accept only ACTIVE options. Hiding an option means "stop offering this",
//      and an inactive option that new records could still be given is not hidden.
//      Reads accept anything: a student recorded years ago keeps their answer.
//   3. Delete is refused while students hold the key (409). The alternative is a student
//      whose qualification silently degrades into a raw slug nobody can explain. Hiding
//      is the operation staff actually want, and the error says so.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CourseTypeOption,
  CreateCourseTypeRequest,
  ListCourseTypesQuery,
  UpdateCourseTypeRequest,
} from "@repo/types";
import { slugifyCourseTypeKey } from "@repo/types";

import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { CourseTypesRepository, type CourseTypeRow } from "./course-types.repository";

@Injectable()
export class CourseTypesService {
  constructor(private readonly repository: CourseTypesRepository) {}

  /**
   * The option list is tenant-wide configuration, not per-branch records — the same call
   * partners/colleges make. A branch-scoped caller managing it would be editing every
   * branch's dropdown, so only scope=all may.
   */
  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "course_types.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for course types.`,
      });
    }
  }

  async list(tenantId: string, query: ListCourseTypesQuery): Promise<PaginatedResult<CourseTypeOption>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      activeOnly: query.activeOnly,
      page: query.page,
      pageSize: query.pageSize,
    });
    const counts = await this.repository.countStudentsByKey(tenantId, rows.map((r) => r.key));
    return new PaginatedResult(
      rows.map((row) => toDto(row, counts.get(row.key) ?? 0)),
      { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total },
    );
  }

  async create(tenantId: string, body: CreateCourseTypeRequest): Promise<CourseTypeOption> {
    this.assertAllScope();

    const key = slugifyCourseTypeKey(body.label);
    if (!key) {
      throw new BadRequestException({
        code: "course_types.label_unusable",
        title: "That name cannot be used",
        detail: "Use a name with at least one letter or number, for example “B.Sc Nursing”.",
      });
    }

    // The partial unique index only covers live rows, so a deleted key is free to reuse.
    // A HIDDEN one is not deleted though, and it is the case staff actually hit — the
    // message points at switching it back on rather than leaving them to add a duplicate
    // they cannot save.
    const clash = await this.repository.findByKey(tenantId, key);
    if (clash) {
      throw new ConflictException({
        code: "course_types.duplicate",
        title: "That course type already exists",
        detail: `“${clash.label}” already uses this name.${clash.active ? "" : " It is currently hidden — switch it back on instead of adding a second one."}`,
      });
    }

    const sortOrder = body.sortOrder ?? (await this.repository.maxSortOrder(tenantId)) + 1;
    const created = await this.repository.create(tenantId, {
      key,
      label: body.label,
      sortOrder,
      active: body.active,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "course_types.not_found", title: "Course type not found after creation" });
    return toDto(row, 0);
  }

  async update(tenantId: string, id: string, body: UpdateCourseTypeRequest): Promise<CourseTypeOption> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "course_types.not_found", title: "Course type not found" });

    // The label is renamed in place and the key stays put — see rule 1 in the file header.
    await this.repository.update(id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "course_types.not_found", title: "Course type not found after update" });
    const counts = await this.repository.countStudentsByKey(tenantId, [updated.key]);
    return toDto(updated, counts.get(updated.key) ?? 0);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "course_types.not_found", title: "Course type not found" });

    const counts = await this.repository.countStudentsByKey(tenantId, [existing.key]);
    const inUse = counts.get(existing.key) ?? 0;
    if (inUse > 0) {
      throw new ConflictException({
        code: "course_types.in_use",
        title: "This course type is in use",
        detail: `${inUse} student${inUse === 1 ? "" : "s"} ${inUse === 1 ? "is" : "are"} recorded as “${existing.label}”. Hide it instead — it will stop appearing in the pickers and those records keep their answer.`,
      });
    }
    await this.repository.softDelete(id);
  }

  // ─── Used by other modules ───────────────────────────────────────────────

  /**
   * Write-path check: the key must name an ACTIVE option of this tenant. 422 rather than a
   * silent write, so a stale CRM tab or a scripted import cannot invent a qualification.
   */
  async assertKnownKey(tenantId: string, key: string): Promise<void> {
    const row = await this.repository.findByKey(tenantId, key);
    if (!row || !row.active) {
      throw new BadRequestException({
        code: "course_types.unknown",
        title: "Unknown course type",
        detail: row
          ? `“${row.label}” is no longer offered. Pick a current course type, or switch it back on under Admin → Course types.`
          : "That course type does not exist. Refresh the page and pick one from the list.",
      });
    }
  }

  /**
   * Read-path helper: key -> label for every live option, so a rename shows up everywhere
   * at once. Callers fall back to the raw key for a value whose option is gone (history is
   * shown as it was recorded, never blanked).
   */
  async labelMap(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.repository.listAll(tenantId);
    return new Map(rows.map((row) => [row.key, row.label]));
  }
}

function toDto(row: CourseTypeRow, studentCount: number): CourseTypeOption {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    sortOrder: row.sortOrder,
    active: row.active,
    studentCount,
    createdAt: row.createdAt.toISOString(),
  };
}
