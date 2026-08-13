// apps/api/src/modules/certificates/certificates.repository.ts
//
// Prisma data-access layer for the Certificates module.
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete
// + data-scope filters. No business logic.")
//
// SECURITY INVARIANTS:
//   1. ALL queries are tenant-scoped — cross-tenant returns null → NotFoundException.
//   2. Student own-scope: every /me/... query filters by studentId derived from auth.
//   3. IDOR → 404: findById methods return null for cross-student/cross-tenant access.
//   4. Public verify (GET /verify/:certUid): tenant_id is NOT trusted from the client;
//      we look up by cert_uid across all tenants (the cert_uid HMAC encodes the tenant
//      implicitly). However, we still filter deletedAt IS NULL (soft-delete respected).
//   5. soft-delete: PrismaService.client has softDeleteExtension applied automatically.
//      Nested relations that may not propagate use explicit `deletedAt: null` guards.
//   6. The `recommendedAt` field stores a faculty recommendation timestamp on Enrollment
//      (we store it in the Enrollment's JSON notes as a work-around because the schema
//      does not have a separate `certificate_recommendations` table in P4). We store it
//      in a dedicated `certificates` row recommendation approach instead — we write the
//      recommendation as an AuditLog entry and a cached timestamp (see service).
//      For P4 the recommendation is stored as a nullable timestamp on the Enrollment row
//      via a JSON field workaround (see findEligibilityListItems), not a schema column.
//      The schema does NOT have certificateRecommendedAt on Enrollment — we surface this
//      from the audit_logs if needed, or from a NOTE: the api-designer typed
//      EligibilityResultSchema.recommendedAt. For P4 we use the audit log approach and
//      set recommendedAt from the latest audit row with action='certificate.recommend'.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { CertificateStatus } from "@prisma/client";

// ─── Row type contracts ────────────────────────────────────────────────────────

export interface CertificateTemplateDetailRow {
  id: string;
  name: string;
  design: Prisma.JsonValue;
  fields: Prisma.JsonValue;
  layout: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CertificateRow {
  id: string;
  tenantId: string;
  enrollmentId: string;
  kind: import("@prisma/client").CertificateKind;
  studentId: string;
  programId: string;
  certUid: string;
  serial: string;
  templateId: string;
  templateName: string;
  storageKey: string | null;
  issuedAt: Date;
  /** Null = issued automatically by the system (autoIssueOnCompletion), not by staff. */
  issuedById: string | null;
  issuedByName: string;
  status: CertificateStatus;
  revokedReason: string | null;
  revokedById: string | null;
  revokedByName: string | null;
  revokedAt: Date | null;
  batchId: string;
  batchName: string;
  studentName: string;
  programTitle: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicCertRow {
  /** cert_uid as stored in DB — verified by caller before calling this. */
  certUid: string;
  /** short human-typeable serial (STMQ-YYYY-XXXX-XXXX). */
  serial: string;
  status: CertificateStatus;
  programTitle: string;
  issuedAt: Date;
  holderName: string;
}

/** Inputs needed to hand out or regenerate a certificate PDF on the public path. */
export interface PublicDownloadRow {
  id: string;
  tenantId: string;
  templateId: string;
  status: CertificateStatus;
  storageKey: string | null;
  certUid: string;
  serial: string;
  issuedAt: Date;
  programTitle: string;
  holderName: string;
}

export interface EnrollmentForEligibility {
  id: string;
  tenantId: string;
  studentId: string;
  programId: string;
  batchId: string;
  progressPct: number;
  /** null when not yet issued */
  certificate?: {
    id: string;
    status: CertificateStatus;
    certUid: string;
    serial: string;
    issuedAt: Date;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CertificatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Profile / user resolution helpers ───────────────────────────────────

  async findStudentProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Returns all batch IDs where batch.faculty_id = facultyProfileId. */
  async findAssignedBatchIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** User display name via User.id. */
  async findUserDisplayName(userId: string): Promise<string> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) return "Unknown";
    return user.name?.trim() || user.email;
  }

  /**
   * Get display name for a student via StudentProfile.id.
   * Certificate.studentId stores StudentProfile.id (denormalized).
   */
  async findStudentDisplayName(studentProfileId: string): Promise<string> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      select: { user: { select: { name: true, email: true } } },
    });
    if (!profile?.user) return "Unknown";
    return profile.user.name?.trim() || profile.user.email;
  }

  // ─── Enrollment + eligibility helpers ────────────────────────────────────

  /**
   * Resolve an enrollment by id, tenant-scoped with program/batch denormalization.
   * Returns null if not found or soft-deleted (IDOR → 404).
   */
  async findEnrollmentById(
    tenantId: string,
    enrollmentId: string,
  ): Promise<EnrollmentForEligibility | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex Prisma select
    const row: any = await this.prisma.client.enrollment.findFirst({
      where: { id: enrollmentId, tenantId },
      select: {
        id: true,
        tenantId: true,
        studentId: true,
        programId: true,
        batchId: true,
        progressPct: true,
        // P7 fix (docs/plans/phase-7.md Wave 1 task #3): Enrollment.certificate is now
        // a to-many relation (`certificates`) because reissue soft-deletes the previous
        // row instead of hard-deleting it (see Certificate model doc comment in
        // schema.prisma). The `where: { deletedAt: null }` filter + the DB partial-unique
        // index together guarantee at most one row comes back here.
        certificates: {
          where: { deletedAt: null },
          select: { id: true, status: true, certUid: true, serial: true, issuedAt: true },
          take: 1,
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      studentId: row.studentId,
      programId: row.programId,
      batchId: row.batchId,
      progressPct: row.progressPct ?? 0,
      certificate: row.certificates?.[0] ?? null,
    };
  }

  /**
   * Find an enrollment by the authenticated student's studentProfileId.
   * Used for /me/certificates paths — IDOR-safe (own-scope).
   */
  async findEnrollmentByStudent(
    tenantId: string,
    enrollmentId: string,
    studentId: string,
  ): Promise<{ id: string; programId: string; batchId: string } | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { id: enrollmentId, tenantId, studentId },
      select: { id: true, programId: true, batchId: true },
    });
    return row ?? null;
  }

  /**
   * Count required assessments for the program and how many the student has passed.
   * Used in the eligibility engine (sub-condition 2).
   *
   * Returns { total: number, passed: number }.
   * If total === 0 → vacuously true (no required assessments).
   */
  async countRequiredAssessmentEligibility(
    tenantId: string,
    programId: string,
    enrollmentId: string,
  ): Promise<{ total: number; passed: number }> {
    // Find all modules for this program
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);

    if (moduleIds.length === 0) return { total: 0, passed: 0 };

    // Find all required assessments in these modules
    const requiredAssessments = await this.prisma.client.assessment.findMany({
      where: {
        tenantId,
        moduleId: { in: moduleIds },
        isRequired: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (requiredAssessments.length === 0) return { total: 0, passed: 0 };

    const assessmentIds = requiredAssessments.map((a) => a.id);
    const total = assessmentIds.length;

    // For each required assessment, check if any attempt has passed=true
    // We check per-assessment (edge case: multiple attempts allowed — ANY passing attempt counts).
    const passingCounts = await Promise.all(
      assessmentIds.map((assessmentId) =>
        this.prisma.client.attempt.count({
          where: {
            tenantId,
            assessmentId,
            enrollmentId,
            passed: true,
            submittedAt: { not: null },
            deletedAt: null,
          },
        }),
      ),
    );

    const passed = passingCounts.filter((c) => c > 0).length;
    return { total, passed };
  }

  /**
   * Check whether the final project (is_final=true, kind=project) for the program
   * is approved for this enrollment (sub-condition 3).
   *
   * Returns:
   *   null    → no final project exists (vacuously true)
   *   true    → all milestones graded (or no milestones, submission graded)
   *   false   → not yet fully approved
   */
  async checkFinalProjectApproved(
    tenantId: string,
    programId: string,
    enrollmentId: string,
  ): Promise<boolean | null> {
    // Find lessons in the program's modules
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) return null;

    const lessons = await this.prisma.client.lesson.findMany({
      where: { moduleId: { in: moduleIds }, deletedAt: null },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);
    if (lessonIds.length === 0) return null;

    // Find the final project assignment (kind=project, is_final=true)
    const finalProject = await this.prisma.client.assignment.findFirst({
      where: {
        tenantId,
        lessonId: { in: lessonIds },
        kind: "project",
        isFinal: true,
        deletedAt: null,
      },
      include: {
        milestones: {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!finalProject) return null; // vacuously true — no final project defined

    const milestoneIds = finalProject.milestones.map((m) => m.id);

    if (milestoneIds.length === 0) {
      // Single-submission project (no milestones)
      const submission = await this.prisma.client.submission.findFirst({
        where: {
          tenantId,
          assignmentId: finalProject.id,
          enrollmentId,
          milestoneId: null,
          status: "graded",
          score: { not: null },
          deletedAt: null,
        },
        select: { id: true },
      });
      return submission !== null;
    }

    // Multi-milestone project: ALL milestones must have a graded submission
    const gradedMilestoneCount = await this.prisma.client.submission.count({
      where: {
        tenantId,
        assignmentId: finalProject.id,
        enrollmentId,
        milestoneId: { in: milestoneIds },
        status: "graded",
        deletedAt: null,
      },
    });

    return gradedMilestoneCount >= milestoneIds.length;
  }

  // ─── Certificate CRUD ─────────────────────────────────────────────────────

  /**
   * Find an active (non-deleted) certificate by enrollmentId.
   * Returns null if not found (IDOR → 404 in service).
   */
  async findByEnrollmentId(
    tenantId: string,
    enrollmentId: string,
  ): Promise<CertificateRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
    const row: any = await this.prisma.client.certificate.findFirst({
      where: { tenantId, enrollmentId },
      include: {
        template: { select: { name: true } },
        issuedBy: { select: { name: true, email: true } },
        revokedBy: { select: { name: true, email: true } },
        enrollment: {
          select: {
            batchId: true,
            batch: { select: { name: true } },
          },
        },
        student: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
        program: { select: { title: true } },
      },
    });
    if (!row) return null;
    return toCertificateRow(row);
  }

  /**
   * Find certificate by id, tenant-scoped. Returns null for cross-tenant/not-found.
   */
  async findById(tenantId: string, id: string): Promise<CertificateRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
    const row: any = await this.prisma.client.certificate.findFirst({
      where: { id, tenantId },
      include: {
        template: { select: { name: true } },
        issuedBy: { select: { name: true, email: true } },
        revokedBy: { select: { name: true, email: true } },
        enrollment: {
          select: {
            batchId: true,
            batch: { select: { name: true } },
          },
        },
        student: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
        program: { select: { title: true } },
      },
    });
    if (!row) return null;
    return toCertificateRow(row);
  }

  /**
   * Find certificate by id, scoped to a specific studentId (own-scope IDOR guard).
   * Returns null if not found OR if studentId does not match.
   */
  async findByIdForStudent(
    tenantId: string,
    id: string,
    studentId: string,
  ): Promise<CertificateRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
    const row: any = await this.prisma.client.certificate.findFirst({
      where: { id, tenantId, studentId },
      include: {
        template: { select: { name: true } },
        issuedBy: { select: { name: true, email: true } },
        revokedBy: { select: { name: true, email: true } },
        enrollment: {
          select: {
            batchId: true,
            batch: { select: { name: true } },
          },
        },
        student: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
        program: { select: { title: true } },
      },
    });
    if (!row) return null;
    return toCertificateRow(row);
  }

  /**
   * Find certificates for a student (own-scope list: /me/certificates).
   */
  async listForStudent(
    tenantId: string,
    studentId: string,
    filters: { status?: CertificateStatus; programId?: string; page: number; pageSize: number },
  ): Promise<{ rows: CertificateRow[]; total: number }> {
    const where: Prisma.CertificateWhereInput = {
      tenantId,
      studentId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
    };
    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
      (this.prisma.client.certificate.findMany({
        where,
        include: {
          template: { select: { name: true } },
          issuedBy: { select: { name: true, email: true } },
          revokedBy: { select: { name: true, email: true } },
          enrollment: {
            select: {
              batchId: true,
              batch: { select: { name: true } },
            },
          },
          student: {
            select: {
              user: { select: { name: true, email: true } },
            },
          },
          program: { select: { title: true } },
        },
        orderBy: { issuedAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>),
      this.prisma.client.certificate.count({ where }),
    ]);
    return { rows: rawRows.map(toCertificateRow), total };
  }

  /**
   * List certificates for CRM (ops view — all or filtered).
   */
  async listCrm(
    tenantId: string,
    filters: {
      status?: CertificateStatus;
      programId?: string;
      search?: string;
      batchIds?: string[];
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: CertificateRow[]; total: number }> {
    const where: Prisma.CertificateWhereInput = {
      tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.search
        ? {
            OR: [
              { certUid: { contains: filters.search, mode: "insensitive" } },
              { serial: { contains: filters.search, mode: "insensitive" } },
              {
                student: {
                  user: {
                    name: { contains: filters.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
      ...(filters.batchIds !== undefined
        ? { enrollment: { batchId: { in: filters.batchIds } } }
        : {}),
    };
    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
      (this.prisma.client.certificate.findMany({
        where,
        include: {
          template: { select: { name: true } },
          issuedBy: { select: { name: true, email: true } },
          revokedBy: { select: { name: true, email: true } },
          enrollment: {
            select: {
              batchId: true,
              batch: { select: { name: true } },
            },
          },
          student: {
            select: {
              user: { select: { name: true, email: true } },
            },
          },
          program: { select: { title: true } },
        },
        orderBy: { issuedAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>),
      this.prisma.client.certificate.count({ where }),
    ]);
    return { rows: rawRows.map(toCertificateRow), total };
  }

  /**
   * PUBLIC VERIFY: look up a certificate by cert_uid (no tenant filter —
   * cert_uid is globally unique). Soft-delete respected.
   * Returns only the minimal public fields to avoid PII leakage.
   * SECURITY: caller MUST verify the cert_uid signature BEFORE calling this.
   */
  async findPublicByCertUid(certUid: string): Promise<PublicCertRow | null> {
    return this.toPublicCertRow(
      await this.prisma.client.certificate.findFirst({
        where: { certUid },
        select: PUBLIC_CERT_SELECT,
      }),
    );
  }

  /**
   * PUBLIC VERIFY by SHORT SERIAL (STMQ-YYYY-XXXX-XXXX). Same minimal PII-free
   * projection as findPublicByCertUid. Soft-delete respected via the extension.
   *
   * SECURITY: the serial is NOT signed (unlike cert_uid), so this is a plain lookup.
   * Its safety rests on (a) ~40 bits of entropy in the serial and (b) the per-IP rate
   * limiter the caller applies before reaching here. It returns ONLY public display
   * fields — never PII beyond holder name — exactly like the cert_uid path.
   */
  async findPublicBySerial(serial: string): Promise<PublicCertRow | null> {
    return this.toPublicCertRow(
      await this.prisma.client.certificate.findFirst({
        where: { serial },
        select: PUBLIC_CERT_SELECT,
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow public select
  private toPublicCertRow(row: any): PublicCertRow | null {
    if (!row) return null;
    const holderName = row.student?.user?.name?.trim() || "Certificate Holder";
    return {
      certUid: row.certUid,
      serial: row.serial,
      status: row.status,
      programTitle: row.program?.title ?? "Program",
      issuedAt: row.issuedAt,
      holderName,
    };
  }

  /**
   * Best-effort check that a serial is free, used to pre-empt the (astronomically rare,
   * ~1e-12 at 40 bits) collision before rendering the PDF. The AUTHORITATIVE guarantee is
   * the `certificates_serial_key` UNIQUE index, which covers ALL rows including
   * soft-deleted ones — so even if this probe misses a soft-deleted collision, the insert
   * fails cleanly rather than duplicating a serial.
   */
  async serialExists(serial: string): Promise<boolean> {
    const anyRow = await this.prisma.client.certificate.findFirst({
      where: { serial },
      select: { id: true },
    });
    return anyRow !== null;
  }

  /**
   * PUBLIC DOWNLOAD: everything needed to hand out (or regenerate) the PDF for a verified
   * cert_uid — the storage key, plus the tenant/template/render inputs used when the PDF
   * has to be produced on demand. Kept separate from findPublicByCertUid, which
   * deliberately returns only the minimal PII-free display fields for the verify response.
   *
   * SECURITY: the caller MUST have verified the cert_uid signature before calling this.
   */
  async findForPublicDownload(certUid: string): Promise<PublicDownloadRow | null> {
    return this.toPublicDownloadRow(
      await this.prisma.client.certificate.findFirst({
        where: { certUid },
        select: PUBLIC_DOWNLOAD_SELECT,
      }),
    );
  }

  /**
   * PUBLIC DOWNLOAD by SHORT SERIAL — same projection as findForPublicDownload.
   * SECURITY: the serial is unsigned; the caller applies the same per-IP rate limit as
   * the verify path, and a revoked certificate is still refused (410) upstream.
   */
  async findForPublicDownloadBySerial(serial: string): Promise<PublicDownloadRow | null> {
    return this.toPublicDownloadRow(
      await this.prisma.client.certificate.findFirst({
        where: { serial },
        select: PUBLIC_DOWNLOAD_SELECT,
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow public download select
  private toPublicDownloadRow(row: any): PublicDownloadRow | null {
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      templateId: row.templateId,
      status: row.status,
      storageKey: row.storageKey,
      certUid: row.certUid,
      serial: row.serial,
      issuedAt: row.issuedAt,
      programTitle: row.program?.title ?? "Program",
      holderName: row.student?.user?.name?.trim() || "Certificate Holder",
    };
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  /** Backfills the storage key after a PDF is (re)generated on demand. */
  async setStorageKey(id: string, storageKey: string): Promise<void> {
    await this.prisma.client.certificate.update({ where: { id }, data: { storageKey } });
  }

  /**
   * Insert a new Certificate row.
   * Caller must have verified eligibility and generated cert_uid/storageKey first.
   */
  async createCertificate(data: {
    tenantId: string;
    enrollmentId: string;
    kind: import("@prisma/client").CertificateKind;
    studentId: string;
    programId: string;
    certUid: string;
    serial: string;
    templateId: string;
    storageKey: string | null;
    issuedAt: Date;
    /** Null = issued automatically by the system (autoIssueOnCompletion). */
    issuedById: string | null;
  }): Promise<string> {
    const row = await this.prisma.client.certificate.create({
      data: {
        tenantId: data.tenantId,
        enrollmentId: data.enrollmentId,
        kind: data.kind,
        studentId: data.studentId,
        programId: data.programId,
        certUid: data.certUid,
        serial: data.serial,
        templateId: data.templateId,
        storageKey: data.storageKey,
        issuedAt: data.issuedAt,
        issuedById: data.issuedById,
        status: "valid",
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Revoke a certificate. Sets status='revoked' + revocation metadata.
   * Returns the before-state for audit logging.
   */
  async revokeCertificate(
    tenantId: string,
    id: string,
    data: { reason: string; revokedById: string; revokedAt: Date },
  ): Promise<{ beforeStatus: CertificateStatus }> {
    const before = await this.prisma.client.certificate.findFirst({
      where: { id, tenantId },
      select: { status: true },
    });
    await this.prisma.client.certificate.updateMany({
      where: { id, tenantId },
      data: {
        status: "revoked",
        revokedReason: data.reason,
        revokedById: data.revokedById,
        revokedAt: data.revokedAt,
      },
    });
    return { beforeStatus: before?.status ?? "valid" };
  }

  /**
   * Soft-deletes a certificate row for the reissue flow (docs/phase-4-followups.md M-2,
   * closed in docs/plans/phase-7.md Wave 1 task #3 / migration
   * `20260704060000_certificates_reissue_partial_unique`).
   *
   * P7 FIX — was a physical DELETE: Certificate.enrollmentId previously had a hard
   * @unique constraint (not a partial unique WHERE deleted_at IS NULL). A soft-delete
   * (setting deletedAt) still held the unique slot, preventing the new reissued cert
   * from being inserted, so reissue used a raw physical DELETE as a P4 workaround
   * (losing the revoked row from the audit trail — the AuditLog `before` snapshot was
   * the only surviving record of it).
   *
   * Now that the hard unique is replaced by the partial-unique index
   * `certificates_active_enrollment_id_key` (`UNIQUE (enrollment_id) WHERE deleted_at
   * IS NULL`), a genuine soft-delete releases the active slot for the same
   * enrollment_id while PRESERVING the revoked row (deleted_at set, not removed) —
   * satisfying both:
   *   1. Old cert_uid is no longer resolvable via the active-only lookup paths
   *      (findByCertUid / public verify filter deletedAt: null) → AC-G4 still holds.
   *   2. The revoked certificate row survives in `certificates` (soft-deleted) for
   *      audit/history — not just as an AuditLog JSON snapshot.
   * Uses `.deleteMany()` (tenant-scoped `where`, matching the `revokeCertificate`
   * pattern above) so the soft-delete Prisma extension's deleteMany→updateMany rewrite
   * applies.
   */
  async softDeleteCertificate(tenantId: string, id: string): Promise<void> {
    await this.prisma.client.certificate.deleteMany({
      where: { id, tenantId },
    });
  }

  // ─── Certificate templates ────────────────────────────────────────────────

  async findTemplateById(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; name: string; design: unknown; fields: unknown; status: string } | null> {
    const row = await this.prisma.client.certificateTemplate.findFirst({
      where: { id, tenantId, status: "active", deletedAt: null },
      select: { id: true, name: true, design: true, fields: true, status: true },
    });
    return row ?? null;
  }

  async findProgramTitle(programId: string): Promise<string> {
    const row = await this.prisma.client.program.findFirst({
      where: { id: programId },
      select: { title: true },
    });
    return row?.title ?? "Program";
  }

  /**
   * Active templates for the issue pickers.
   *
   * `design` is selected so the service can surface each template's KIND — the award is a
   * property of the template (its artwork's ribbon reads TRAINING or INTERNSHIP), and a
   * caller that has chosen a template has already chosen a kind. Selecting the whole JSON
   * rather than adding a column keeps the kind in the one place the renderer also reads it.
   */
  async listTemplates(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string; status: string; createdAt: Date; design: unknown }>> {
    return this.prisma.client.certificateTemplate.findMany({
      where: { tenantId, status: "active", deletedAt: null },
      select: { id: true, name: true, status: true, createdAt: true, design: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Pick a default active template for AUTO issuance (autoIssueOnCompletion).
   *
   * Prefers the oldest active template whose `design.certificateKind` matches the kind being
   * minted, and only falls back to the oldest active template of any kind when the tenant has
   * none for that kind. The `kind` argument is what makes this correct: the seed creates the
   * internship template first, so an unfiltered "oldest active" always returned the internship
   * artwork — and auto-issue always mints `kind: "training"`. Every auto-issued training
   * certificate was therefore stored as training and rendered as an internship certificate.
   *
   * A tenant with no active template at all simply cannot auto-issue (the caller logs and
   * skips); that remains intentional.
   */
  async findDefaultActiveTemplate(
    tenantId: string,
    kind?: string,
  ): Promise<{ id: string; name: string; design: unknown; fields: unknown; status: string } | null> {
    const select = { id: true, name: true, design: true, fields: true, status: true } as const;

    if (kind) {
      const match = await this.prisma.client.certificateTemplate.findFirst({
        where: {
          tenantId,
          status: "active",
          deletedAt: null,
          design: { path: ["certificateKind"], equals: kind },
        },
        select,
        orderBy: { createdAt: "asc" },
      });
      if (match) return match;
    }

    const row = await this.prisma.client.certificateTemplate.findFirst({
      where: { tenantId, status: "active", deletedAt: null },
      select,
      orderBy: { createdAt: "asc" },
    });
    return row ?? null;
  }

  // ─── Phase-9-completion gap #5: template detail + create/update (incl. layout) ────

  async findTemplateDetailById(tenantId: string, id: string): Promise<CertificateTemplateDetailRow | null> {
    const row = await this.prisma.client.certificateTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, design: true, fields: true, layout: true, status: true, createdAt: true, updatedAt: true },
    });
    return row ?? null;
  }

  async createTemplate(
    tenantId: string,
    data: { name: string; design: Prisma.InputJsonValue; fields: Prisma.InputJsonValue; layout: Prisma.InputJsonValue | undefined; status: string },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.certificateTemplate.create({
      data: { tenantId, name: data.name, design: data.design, fields: data.fields, layout: data.layout ?? Prisma.JsonNull, status: data.status },
    });
    return { id: row.id };
  }

  async updateTemplate(
    id: string,
    patch: Partial<{ name: string; design: Prisma.InputJsonValue; fields: Prisma.InputJsonValue; layout: Prisma.InputJsonValue; status: string }>,
  ): Promise<void> {
    await this.prisma.client.certificateTemplate.update({ where: { id }, data: patch });
  }

  // ─── Eligibility list ─────────────────────────────────────────────────────

  /**
   * List enrollments for the eligibility CRM view.
   * Includes certificate status + recommendation timestamp (from audit_logs).
   */
  async listEnrollmentsForEligibility(
    tenantId: string,
    filters: {
      programId?: string;
      batchId?: string;
      batchIds?: string[];
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    rows: Array<{
      enrollmentId: string;
      studentId: string;
      studentName: string;
      programId: string;
      programTitle: string;
      batchId: string;
      batchName: string;
      progressPct: number;
      certificate: { id: string; status: CertificateStatus; certUid: string; serial: string; issuedAt: Date } | null;
      recommendedAt: Date | null;
    }>;
    total: number;
  }> {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId,
      // `active` AND `completed` — NOT active-only. Marking an enrollment `completed` is
      // precisely what makes a student certificate-worthy, so an active-only filter made
      // finished students vanish from the issuance queue AND hid their already-issued
      // certificate from the CRM (student-360 Certificates tab renders this list).
      // `dropped` stays excluded — a dropped enrollment earns nothing.
      status: { in: ["active", "completed"] },
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.batchId
        ? { batchId: filters.batchId }
        : filters.batchIds !== undefined
          ? { batchId: { in: filters.batchIds } }
          : {}),
      ...(filters.search
        ? {
            student: {
              user: {
                name: { contains: filters.search, mode: "insensitive" },
              },
            },
          }
        : {}),
    };

    const [rawRows, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex include
      (this.prisma.client.enrollment.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              user: { select: { name: true, email: true } },
            },
          },
          program: { select: { id: true, title: true } },
          batch: { select: { id: true, name: true } },
          // P7 fix: to-many relation now (see findEnrollmentById note above).
          certificates: {
            where: { deletedAt: null },
            select: { id: true, status: true, certUid: true, serial: true, issuedAt: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }) as Promise<any[]>),
      this.prisma.client.enrollment.count({ where }),
    ]);

    // Fetch recommendation timestamps from audit_logs for each enrollment
    const enrollmentIds = rawRows.map((r: any) => r.id as string);
    const recommendationAuditRows =
      enrollmentIds.length > 0
        ? await this.prisma.client.auditLog.findMany({
            where: {
              tenantId,
              entity: "Certificate",
              action: "certificate.recommend",
              entityId: { in: enrollmentIds },
            },
            select: { entityId: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          })
        : [];

    // Build a map enrollmentId → latest recommendation timestamp
    const recommendedAtMap = new Map<string, Date>();
    for (const r of recommendationAuditRows) {
      if (!recommendedAtMap.has(r.entityId)) {
        recommendedAtMap.set(r.entityId, r.createdAt);
      }
    }

    const rows = rawRows.map((r: any) => ({
      enrollmentId: r.id as string,
      studentId: r.student?.id ?? r.studentId,
      studentName: formatUserName(r.student?.user),
      programId: r.program?.id ?? r.programId,
      programTitle: r.program?.title ?? "",
      batchId: r.batch?.id ?? r.batchId,
      batchName: r.batch?.name ?? "",
      progressPct: r.progressPct ?? 0,
      certificate: r.certificates?.[0] ?? null,
      recommendedAt: recommendedAtMap.get(r.id) ?? null,
    }));

    return { rows, total };
  }

  // ─── Eligibility batch rollup (batch-first landing view) ──────────────────

  /**
   * One row per batch that has at least one non-dropped enrollment, with the
   * cheap headline counts for the CRM ▸ Certificates landing table.
   *
   * COST: a FIXED five queries for the whole page, whatever the batch count —
   * never one-per-batch. The three-gate eligibility engine is deliberately NOT
   * run here (it is ~5 queries per enrollment); `completionReadyCount` is a
   * plain `progress_pct >= threshold` column read and the service labels it as
   * the completion gate only. Batches with zero qualifying enrollments are
   * omitted — this table is a queue of students to certify, not a batch admin list.
   */
  async listBatchSummariesForEligibility(
    tenantId: string,
    filters: {
      programId?: string;
      batchIds?: string[];
      search?: string;
      completionThreshold: number;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    rows: Array<{
      batchId: string;
      batchName: string;
      programId: string;
      programTitle: string;
      studentCount: number;
      issuedCount: number;
      revokedCount: number;
      completionReadyCount: number;
    }>;
    total: number;
  }> {
    // The enrollment population MUST match listEnrollmentsForEligibility's
    // exactly, or a batch row's studentCount would disagree with the number of
    // rows the drill-in table then shows.
    const enrollmentFilter: Prisma.EnrollmentWhereInput = {
      tenantId,
      status: { in: ["active", "completed"] },
      deletedAt: null,
    };

    const where: Prisma.BatchWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.batchIds !== undefined ? { id: { in: filters.batchIds } } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { program: { title: { contains: filters.search, mode: "insensitive" } } },
            ],
          }
        : {}),
      // Nested relation filters are NOT rewritten by the soft-delete extension,
      // hence the explicit `deletedAt: null` inside enrollmentFilter.
      enrollments: { some: enrollmentFilter },
    };

    const [batches, total] = await Promise.all([
      this.prisma.client.batch.findMany({
        where,
        select: {
          id: true,
          name: true,
          startDate: true,
          program: { select: { id: true, title: true } },
        },
        // Newest cohort first — that is the one being certified right now.
        orderBy: [{ startDate: "desc" }, { name: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.batch.count({ where }),
    ]);

    const batchIds = batches.map((b) => b.id);
    if (batchIds.length === 0) return { rows: [], total };

    const [studentCounts, completionReadyCounts, certificateRows] = await Promise.all([
      this.prisma.client.enrollment.groupBy({
        by: ["batchId"],
        where: { ...enrollmentFilter, batchId: { in: batchIds } },
        _count: { _all: true },
      }),
      this.prisma.client.enrollment.groupBy({
        by: ["batchId"],
        where: {
          ...enrollmentFilter,
          batchId: { in: batchIds },
          progressPct: { gte: filters.completionThreshold },
        },
        _count: { _all: true },
      }),
      // Certificate has no batch_id of its own, so there is nothing to group by
      // in SQL — we fetch the (small: one row per certified student) status +
      // batch pairs for the page's batches and tally them in memory.
      this.prisma.client.certificate.findMany({
        where: {
          tenantId,
          deletedAt: null,
          enrollment: { batchId: { in: batchIds }, ...enrollmentFilter },
        },
        select: { status: true, enrollment: { select: { batchId: true } } },
      }),
    ]);

    const studentCountByBatch = new Map(studentCounts.map((r) => [r.batchId, r._count._all]));
    const completionReadyByBatch = new Map(
      completionReadyCounts.map((r) => [r.batchId, r._count._all]),
    );
    const issuedByBatch = new Map<string, number>();
    const revokedByBatch = new Map<string, number>();
    for (const cert of certificateRows) {
      const batchId = cert.enrollment?.batchId;
      if (!batchId) continue;
      const bucket = cert.status === "valid" ? issuedByBatch : revokedByBatch;
      bucket.set(batchId, (bucket.get(batchId) ?? 0) + 1);
    }

    const rows = batches.map((batch) => ({
      batchId: batch.id,
      batchName: batch.name,
      programId: batch.program?.id ?? "",
      programTitle: batch.program?.title ?? "",
      studentCount: studentCountByBatch.get(batch.id) ?? 0,
      issuedCount: issuedByBatch.get(batch.id) ?? 0,
      revokedCount: revokedByBatch.get(batch.id) ?? 0,
      completionReadyCount: completionReadyByBatch.get(batch.id) ?? 0,
    }));

    return { rows, total };
  }

  // ─── Audit logging ────────────────────────────────────────────────────────

  async writeAuditLog(data: {
    tenantId: string;
    /** Null for system/auto actions (audit_logs.actor_id is nullable — no crash on FK). */
    actorId: string | null;
    entity: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: data.entity,
        entityId: data.entityId,
        action: data.action,
        before: (data.before ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after: (data.after ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }
}

// ─── Shared selects ────────────────────────────────────────────────────────────

/** Minimal, PII-free projection for the public verify path (cert_uid OR serial). */
const PUBLIC_CERT_SELECT = {
  certUid: true,
  serial: true,
  status: true,
  issuedAt: true,
  program: { select: { title: true } },
  student: { select: { user: { select: { name: true } } } },
} satisfies Prisma.CertificateSelect;

/** Projection for the public download path (cert_uid OR serial). */
const PUBLIC_DOWNLOAD_SELECT = {
  id: true,
  tenantId: true,
  templateId: true,
  status: true,
  storageKey: true,
  certUid: true,
  serial: true,
  issuedAt: true,
  program: { select: { title: true } },
  student: { select: { user: { select: { name: true } } } },
} satisfies Prisma.CertificateSelect;

// ─── Mapping helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function formatUserName(user: any): string {
  if (!user) return "Unknown";
  return user.name?.trim() || user.email || "Unknown";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include returns complex generic
function toCertificateRow(row: any): CertificateRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    enrollmentId: row.enrollmentId,
    kind: row.kind,
    studentId: row.studentId,
    programId: row.programId,
    certUid: row.certUid,
    serial: row.serial,
    templateId: row.templateId,
    templateName: row.template?.name ?? "",
    storageKey: row.storageKey ?? null,
    issuedAt: row.issuedAt,
    issuedById: row.issuedById ?? null,
    // Null issuedById = auto-issued by the system (autoIssueOnCompletion) — surface this
    // distinctly from "Unknown" (which means a staff issuer row failed to resolve).
    issuedByName: row.issuedById == null ? "System (automatic)" : formatUserName(row.issuedBy),
    status: row.status as CertificateStatus,
    revokedReason: row.revokedReason ?? null,
    revokedById: row.revokedById ?? null,
    revokedByName: row.revokedBy ? formatUserName(row.revokedBy) : null,
    revokedAt: row.revokedAt ?? null,
    batchId: row.enrollment?.batchId ?? "",
    batchName: row.enrollment?.batch?.name ?? "",
    studentName: formatUserName(row.student?.user),
    programTitle: row.program?.title ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
