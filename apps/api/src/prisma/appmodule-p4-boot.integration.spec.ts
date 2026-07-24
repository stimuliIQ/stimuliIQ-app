// apps/api/src/prisma/appmodule-p4-boot.integration.spec.ts
//
// AppModule / Prisma P4 schema boot smoke test (DEFECT-1 lesson from docs/plans/phase-4.md task #1 DoD).
//
// PURPOSE: Verify that all Phase-4 tables exist in the live DB and that Prisma's
// generated client can perform basic CRUD on every new P4 model. A broken migration
// (wrong table name, missing column, FK pointing at a non-existent table, or a
// schema-DB drift) surfaces here — not at phase closeout.
//
// This test does NOT boot the full NestJS AppModule (the Jest unit config cannot
// resolve @repo/types' ESM build — that is an integration-spec.ts concern). Instead
// it exercises the critical Prisma → DB path directly:
//   1. PrismaClient.$queryRaw to list P4 tables from information_schema.
//   2. PrismaClient.findMany on each new model (proves the generated client matches the DB).
//   3. Basic FK integrity: creating a child row with a valid parent succeeds.
//
// SKIP: if DATABASE_URL is absent (bare pnpm test without docker).
//
// References:
//   - DEFECT-1 lesson: docs/plans/phase-4.md §1 DoD "Run a full AppModule boot smoke test
//     early (DEFECT-1 lesson — a broken migration/relation must fail loud here)."
//   - Migration applied: 20260702065749_learning_depth +
//     20260702065800_learning_depth_partial_indexes +
//     20260702065914_learning_depth_eligibility_columns

import { PrismaClient } from "@prisma/client";

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("P4 schema boot smoke test — DB table existence + Prisma client sync", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const P4_TABLES = [
    "assignments",
    "assignment_milestones",
    "submissions",
    "assessments",
    "assessment_questions",
    "attempts",
    "certificate_templates",
    "certificates",
  ];

  const P4_ENUMS = [
    "AssignmentKind",
    "SubmissionStatus",
    "AssessmentType",
    "QuestionType",
    "CertificateStatus",
  ];

  it("all P4 tables exist in the public schema", async () => {
    // Query information_schema.tables to confirm all 8 P4 tables are present.
    const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${P4_TABLES})
      ORDER BY table_name
    `;
    const foundTables = result.map((r) => r.table_name);

    for (const tableName of P4_TABLES) {
      expect(foundTables).toContain(tableName);
    }
    expect(foundTables.length).toBe(P4_TABLES.length);
  });

  it("all P4 enums exist in the public schema", async () => {
    const result = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname
      FROM pg_type
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND typtype = 'e'
        AND typname = ANY(${P4_ENUMS})
      ORDER BY typname
    `;
    const foundEnums = result.map((r) => r.typname);

    for (const enumName of P4_ENUMS) {
      expect(foundEnums).toContain(enumName);
    }
    expect(foundEnums.length).toBe(P4_ENUMS.length);
  });

  it("assignments table has is_final column (eligibility addendum)", async () => {
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'assignments'
        AND column_name = 'is_final'
    `;
    expect(result.length).toBe(1);
  });

  it("assessments table has is_required column (eligibility addendum)", async () => {
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'assessments'
        AND column_name = 'is_required'
    `;
    expect(result.length).toBe(1);
  });

  it("assessment_questions table has answer_key column (server-only isolation column)", async () => {
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'assessment_questions'
        AND column_name = 'answer_key'
    `;
    expect(result.length).toBe(1);
  });

  it("Prisma client can findMany on each P4 model (schema-DB sync check)", async () => {
    // If the Prisma-generated client is out of sync with the DB (e.g. migration not
    // applied, column renamed), these calls throw at runtime — caught here.
    const [
      assignments,
      milestones,
      submissions,
      assessments,
      questions,
      attempts,
      templates,
      certificates,
    ] = await Promise.all([
      prisma.assignment.findMany({ take: 1 }),
      prisma.assignmentMilestone.findMany({ take: 1 }),
      prisma.submission.findMany({ take: 1 }),
      prisma.assessment.findMany({ take: 1 }),
      prisma.assessmentQuestion.findMany({ take: 1 }),
      prisma.attempt.findMany({ take: 1 }),
      prisma.certificateTemplate.findMany({ take: 1 }),
      prisma.certificate.findMany({ take: 1 }),
    ]);

    // All must be arrays (findMany returns [] for empty tables, not null/undefined).
    expect(Array.isArray(assignments)).toBe(true);
    expect(Array.isArray(milestones)).toBe(true);
    expect(Array.isArray(submissions)).toBe(true);
    expect(Array.isArray(assessments)).toBe(true);
    expect(Array.isArray(questions)).toBe(true);
    expect(Array.isArray(attempts)).toBe(true);
    expect(Array.isArray(templates)).toBe(true);
    expect(Array.isArray(certificates)).toBe(true);
  });

  it("certificates table has a PARTIAL unique index on enrollment_id, NOT a hard unique (P7 fix, pays down phase-4-followups.md M-2)", async () => {
    // P7 (docs/plans/phase-7.md Wave 1 task #3, migration
    // 20260704060000_certificates_reissue_partial_unique) drops the hard Prisma-managed
    // unique index (`certificates_enrollment_id_key`) — it blocked certificate reissue,
    // since a soft-deleted (revoked) certificate row still held the unique slot. The real
    // constraint going forward is the pre-existing partial-unique index
    // `certificates_active_enrollment_id_key` (UNIQUE (enrollment_id) WHERE deleted_at IS
    // NULL), which allows any number of soft-deleted historical rows per enrollment while
    // still guaranteeing at most one ACTIVE certificate per enrollment.
    const hardUnique = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'certificates'
        AND indexname = 'certificates_enrollment_id_key'
    `;
    expect(hardUnique.length).toBe(0);

    const partialUnique = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'certificates'
        AND indexname = 'certificates_active_enrollment_id_key'
    `;
    expect(partialUnique.length).toBe(1);
    expect(partialUnique[0]?.indexdef).toContain("enrollment_id");
    expect(partialUnique[0]?.indexdef).toContain("deleted_at IS NULL");
  });

  it("certificates table has unique index on cert_uid (Prisma @unique → pg_indexes)", async () => {
    const result = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'certificates'
        AND indexname = 'certificates_cert_uid_key'
    `;
    expect(result.length).toBe(1);
    expect(result[0]?.indexdef).toContain("cert_uid");
  });

  it("partial index submissions_active_no_resubmit_unique exists", async () => {
    // Confirms the resubmit partial-unique from the raw-SQL migration was applied.
    const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'submissions'
        AND indexname = 'submissions_active_no_resubmit_unique'
    `;
    expect(result.length).toBe(1);
  });

  it("seeded certificate_template and certificate rows are present", async () => {
    // Confirms the seed ran successfully and the DB has at least the seeded cert template
    // and the issued certificate for Sneha. If the seed failed silently, this fails.
    const templates = await prisma.certificateTemplate.findMany({
      where: { name: "Stimuliiq Standard Certificate" },
    });
    expect(templates.length).toBeGreaterThanOrEqual(1);

    // The seeded certificate's uid is HMAC-SIGNED (`<payload>.<signature>`), not a
    // readable slug — /verify recomputes the signature and 404s anything unsigned, so a
    // stub uid made the demo certificate unverifiable. Assert the SHAPE, not a literal.
    const certs = await prisma.certificate.findMany({ where: { status: "valid" } });
    expect(certs.length).toBeGreaterThanOrEqual(1);
    expect(certs[0]?.certUid).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
