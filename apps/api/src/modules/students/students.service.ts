// apps/api/src/modules/students/students.service.ts
//
// Business logic for the student directory (docs/04-trd-architecture.md §2.1: "service —
// business logic, transactions, scope resolution"). Never touches Prisma directly
// (delegates to StudentsRepository). Owns the data-scope DECISION (which scope values
// are resolvable today vs. must fail closed) — the repository only ever sees an
// already-validated request.
//
// SCOPE ENFORCEMENT (docs/03 §9 + docs/plans/phase-1.md Wave-3 task brief; Wave 3b closes
// the branch/assigned gap via `EnrollmentScopeRepository`):
//   - "all"      -> allowed, no extra filter beyond tenant (super_admin/admin).
//   - "branch"   -> REAL FILTER (Wave 3b). `student_profiles` has no branch column of its
//                    own, but a student's branch resolves via `enrollments ->
//                    batches.branchId`. We resolve the caller's branch ids (via
//                    `user_roles.branchId`, `FacultyRepository.listCallerBranchIds` — the
//                    same lookup the faculty module already uses) and restrict to student
//                    ids enrolled in a batch with one of those branch ids
//                    (`EnrollmentScopeRepository.resolveStudentIdsForBranches`). An empty
//                    resolved id set means "filter to zero rows", never "no filter".
//   - "assigned" -> REAL FILTER (Wave 3b). Faculty's assigned students = students enrolled
//                    in a batch this faculty teaches (`batches.facultyId`). Resolved via
//                    the caller's own `faculty_profiles.id`
//                    (`FacultyRepository.findOwnFacultyId`) then
//                    `EnrollmentScopeRepository.resolveStudentIdsForFaculty`. A caller with
//                    no faculty profile (or no taught batches) sees zero rows.
//   - "own"      -> still FAIL CLOSED (no role is seeded at students.*=own in P1; no
//                    meaningful "own student" relationship exists to resolve — defensive).
//
// IDOR / object-level authz: `getById`/`update`/`softDelete`/`restore` re-verify the row
// belongs to the caller's tenant AND (for branch/assigned scopes) the resolved id set
// before acting — a request for an out-of-tenant/out-of-scope id returns 404, not 403, to
// avoid existence disclosure (docs/plans/phase-1.md task brief: "your call but be
// consistent" — this module is consistently 404).

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { StudentDetail, StudentSummary, LifecycleStage } from "@repo/types";
import { resolveLifecycleStage } from "@repo/types";
import { StudentsRepository, type StudentRow, type StudentLifecycleSignals } from "./students.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { FacultyRepository } from "../faculty/faculty.repository";
import { LmsAccountProvisioningService } from "./lms-account-provisioning.service";
import type { CreateStudentRequest, ListStudentsQuery, ResendCredentialsResponse, UpdateStudentRequest } from "./dto";

@Injectable()
export class StudentsService {
  constructor(
    private readonly repository: StudentsRepository,
    private readonly enrollmentScope: EnrollmentScopeRepository,
    private readonly facultyRepository: FacultyRepository,
    private readonly lmsProvisioning: LmsAccountProvisioningService,
  ) {}

  /**
   * Resolves the current scope into a student-id restriction for the repository, or
   * throws 403 for "own" (not yet meaningful for students — see file header).
   * `undefined` means "no restriction" (scope "all"); an array (possibly empty) means
   * "restrict to exactly these student-profile ids".
   */
  private async resolveStudentIdRestriction(tenantId: string): Promise<string[] | undefined> {
    const scope = requireScopeContext();

    switch (scope.scope) {
      case "all":
        return undefined;
      case "branch": {
        const branchIds = await this.facultyRepository.listCallerBranchIds(scope.actorId);
        return this.enrollmentScope.resolveStudentIdsForBranches(tenantId, branchIds);
      }
      case "assigned": {
        const facultyId = await this.facultyRepository.findOwnFacultyId(tenantId, scope.actorId);
        if (!facultyId) {
          return [];
        }
        return this.enrollmentScope.resolveStudentIdsForFaculty(tenantId, facultyId);
      }
      case "own":
      default:
        throw new ForbiddenException({
          code: "students.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the students module in P1.`,
        });
    }
  }

  /**
   * Combines the caller's scope restriction with the optional explicit branch
   * filter carried by the CRM's global branch scope (topbar). `student_profiles`
   * has no branch column, so an explicit branch resolves — exactly like
   * scope="branch" — to the ids of students enrolled in a batch of that branch.
   * Intersecting with the scope restriction guarantees the query param can only
   * ever NARROW what the caller may already see (a branch-scoped user can't widen
   * to another branch), and an empty resolved set still means "zero rows", never
   * "no filter" (matches the fail-closed contract in resolveStudentIdRestriction).
   */
  private async resolveListRestriction(
    tenantId: string,
    explicitBranchId: string | undefined,
  ): Promise<string[] | undefined> {
    const scopeIds = await this.resolveStudentIdRestriction(tenantId);
    if (!explicitBranchId) {
      return scopeIds;
    }

    const branchStudentIds = await this.enrollmentScope.resolveStudentIdsForBranches(tenantId, [
      explicitBranchId,
    ]);
    if (scopeIds === undefined) {
      return branchStudentIds;
    }
    const allowed = new Set(scopeIds);
    return branchStudentIds.filter((id) => allowed.has(id));
  }

  /** Throws 403 for "own"/unresolvable scopes; everything else (incl. branch/assigned) is allowed via mutation gating below. */
  private assertMutableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope === "own") {
      throw new ForbiddenException({
        code: "students.scope_unresolvable",
        title: "Scope not yet supported",
        detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the students module in P1.`,
      });
    }
  }

  async list(tenantId: string, query: ListStudentsQuery): Promise<PaginatedResult<StudentSummary>> {
    const restrictToIds = await this.resolveListRestriction(tenantId, query.branchId);

    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      status: query.status,
      courseType: query.courseType,
      includeDeleted: query.includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
      restrictToIds,
    });

    // One batched signals lookup for this page, then derive each row's stage in-memory.
    const signals = await this.repository.getLifecycleSignals(
      tenantId,
      rows.map((r) => r.id),
    );

    return new PaginatedResult(
      rows.map((r) => toSummary(r, deriveStage(r, signals.get(r.id)))),
      { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total },
    );
  }

  /** Fetch the lifecycle signals for a single student and return its enriched detail DTO. */
  private async detailWithStage(tenantId: string, row: StudentRow): Promise<StudentDetail> {
    const signals = await this.repository.getLifecycleSignals(tenantId, [row.id]);
    return toDetail(row, deriveStage(row, signals.get(row.id)));
  }

  async getById(tenantId: string, id: string): Promise<StudentDetail> {
    const restrictToIds = await this.resolveStudentIdRestriction(tenantId);
    if (restrictToIds && !restrictToIds.includes(id)) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    // includeDeleted: the detail DTO carries `deletedAt` and the CRM drawer renders a
    // deleted banner + Restore action for it (mirrors restore() below, which also
    // fetches with includeDeleted). Without this, opening a soft-deleted student from
    // a stale directory list 404-loops instead of offering the designed restore path.
    // Tenant + scope checks above still gate access; only same-tenant, in-scope staff
    // can see the archived record.
    const row = await this.repository.findById(tenantId, id, true);
    if (!row) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    return this.detailWithStage(tenantId, row);
  }

  async create(tenantId: string, body: CreateStudentRequest): Promise<StudentDetail> {
    this.assertMutableScope();

    const existing = await this.repository.findUserByEmailWithOwner(tenantId, body.email);

    // Re-adding someone who was deleted: the `users` row (and its email) survived the
    // soft-delete, so a plain create would hit the unique constraint forever. Restore
    // the profile and apply the submitted details instead — the natural read of
    // "Add student" for an address that only a deleted student holds.
    if (existing?.deletedStudentProfileId) {
      const profileId = existing.deletedStudentProfileId;
      await this.repository.restore(profileId);
      await this.repository.updateStudent(tenantId, profileId, existing.userId, {
        name: body.name,
        phone: body.phone,
        college: body.college,
        courseType: body.courseType,
        year: body.year,
        city: body.city,
        source: body.source,
        status: body.status,
      });
      const restored = await this.repository.findById(tenantId, profileId);
      if (!restored) {
        throw new NotFoundException({ code: "students.not_found", title: "Student not found after restore" });
      }
      return this.detailWithStage(tenantId, restored);
    }

    if (existing) {
      throw new ConflictException({
        code: "students.email_in_use",
        title: "Email already in use",
        detail: `${body.email} already belongs to ${existing.heldBy} in this CRM. Use a different email, or edit that record instead.`,
      });
    }

    const created = await this.repository.createStudentWithUser({
      tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      alternatePhone: body.alternatePhone,
      college: body.college,
      courseType: body.courseType,
      year: body.year,
      city: body.city,
      source: body.source,
      status: body.status,
    });

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found after creation" });
    }
    return this.detailWithStage(tenantId, row);
  }

  async update(tenantId: string, id: string, body: UpdateStudentRequest): Promise<StudentDetail> {
    this.assertMutableScope();
    const restrictToIds = await this.resolveStudentIdRestriction(tenantId);
    if (restrictToIds && !restrictToIds.includes(id)) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }

    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }

    await this.repository.updateStudent(tenantId, id, existing.userId, body);

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found after update" });
    }
    return this.detailWithStage(tenantId, updated);
  }

  async softDelete(tenantId: string, id: string): Promise<StudentDetail> {
    this.assertMutableScope();
    const restrictToIds = await this.resolveStudentIdRestriction(tenantId);
    if (restrictToIds && !restrictToIds.includes(id)) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    await this.repository.softDelete(id);
    const after = await this.repository.findById(tenantId, id, true);
    return this.detailWithStage(tenantId, after!);
  }

  async restore(tenantId: string, id: string): Promise<StudentDetail> {
    this.assertMutableScope();
    const restrictToIds = await this.resolveStudentIdRestriction(tenantId);
    if (restrictToIds && !restrictToIds.includes(id)) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    const existing = await this.repository.findById(tenantId, id, true);
    if (!existing) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    await this.repository.restore(id);
    const after = await this.repository.findById(tenantId, id);
    return this.detailWithStage(tenantId, after!);
  }

  /**
   * CRM "resend credentials" action (gap-closing pass): reissue a student's LMS login.
   * Same scope-check pattern as `update()`/`restore()` — `resolveStudentIdRestriction`
   * gates out-of-scope callers, and an out-of-tenant/out-of-scope/missing id is a 404
   * (IDOR posture consistent with the rest of this module — see file header). The actual
   * lookup + credential rotation is delegated to `LmsAccountProvisioningService`, whose
   * own tenant-scoped `findFirst` is the SAME existence check `null` maps to 404 from.
   */
  async resendCredentials(tenantId: string, id: string): Promise<ResendCredentialsResponse> {
    this.assertMutableScope();
    const restrictToIds = await this.resolveStudentIdRestriction(tenantId);
    if (restrictToIds && !restrictToIds.includes(id)) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }

    const result = await this.lmsProvisioning.resendCredentials(tenantId, id);
    if (!result) {
      throw new NotFoundException({ code: "students.not_found", title: "Student not found" });
    }
    return result;
  }
}

/**
 * Derive the unified lifecycle stage for one student from its profile row + the
 * batched lifecycle signals (lifecycle-redesign P1). When no signals were found
 * (a brand-new profile with no enrollment/order/cert/lead), the resolver falls back
 * to the coarse `status`: an `active`/`alumni` profile reads at least `registered`.
 */
function deriveStage(row: StudentRow, signals: StudentLifecycleSignals | undefined): LifecycleStage {
  return resolveLifecycleStage({
    lead: signals?.leadStage ? { stage: signals.leadStage, hasOwner: true, converted: true } : null,
    // A `lead`-status profile that isn't yet enrolled shouldn't read as a full student;
    // pass the student signal only once it's active/alumni OR has real progress signals.
    student:
      row.status === "active" || row.status === "alumni" || signals?.hasOrder || signals?.enrollment
        ? { status: row.status }
        : null,
    enrollment: signals?.enrollment ?? null,
    order: signals?.hasOrder ? { paid: signals.hasPaidOrder } : null,
    hasCertificate: signals?.hasCertificate ?? false,
  });
}

function toSummary(row: StudentRow, stage: LifecycleStage): StudentSummary {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    college: row.college,
    courseType: row.courseType,
    year: row.year,
    city: row.city,
    status: row.status,
    lifecycleStage: stage,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: StudentRow, stage: LifecycleStage): StudentDetail {
  return {
    ...toSummary(row, stage),
    alternatePhone: row.alternatePhone,
    source: row.source,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
