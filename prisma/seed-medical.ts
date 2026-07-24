// prisma/seed-medical.ts — BiPC / Medical business dataset (standalone, additive).
//
// Builds the customer's real org shape ON TOP OF the RBAC that the canonical
// `prisma/seed.ts` establishes (roles + the full permission catalog + grants). Run
// order:
//
//     pnpm db:seed          # RBAC (roles/permissions/grants) + demo fixtures + tests
//     pnpm db:seed:medical  # THIS FILE — the BiPC/medical business data
//
// This seed does NOT touch the canonical demo data or the permission catalog, so the
// API test suite (149 suites / 2042 tests) stays green. It only *reuses* the roles the
// canonical seed created (super_admin, faculty, mentor) and adds:
//
//   - 1 branch      — "BiPC Medical Academy — Hyderabad"
//   - 1 admin       — admin@bipc.test (super_admin), login-ready
//   - 5 faculty     — internal BiPC teaching staff (FacultyProfile + login)
//   - 10 mentors    — external medical subject-matter experts (Mentor + login)
//   - 6 courses     — priced ₹10,000 (pricePaise = 1_000_000), published + public;
//                     3 of them flagged scholarshipAvailable=true
//   - offer coupon  — OFFER6000: flat ₹4,000 off → effective offer price ₹6,000
//                     (Program has no separate sale-price column, so the ₹10,000→₹6,000
//                      "offer price" is realized through the real checkout discount path)
//   - scholarship coupon — MEDSCHOLAR50: 50% off, scoped to the scholarship courses
//   - 6 batches     — one per course, each with an assigned faculty + assigned mentors
//                     (all 10 mentors get at least one batch → mentor dashboards populate)
//
// Money is integer paise — NO floats (CLAUDE.md §3.6). Fully idempotent: every entity is
// found-or-created / upserted on a natural key, so re-running is safe.
//
// Local dev logins created here (all under @bipc.test to avoid any collision with the
// canonical @stimuliiq.test demo accounts):
//   admin@bipc.test        Admin@12345     Super Admin (CRM)
//   <first>@bipc.test      Faculty@12345   Faculty (CRM)     — padma, ravi, shalini, naveen, deepa
//   <first>@bipc.test      Mentor@12345    Mentor (CRM dash) — suresh, lakshmi, anil, priyanka, ...

import {
  PrismaClient,
  BranchStatus,
  ProgramMode,
  ProgramStatus,
  MentorEngagementStatus,
  CouponType,
  CouponStatus,
  LessonType,
  type Role,
} from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

// ₹10,000 list price, ₹6,000 "offer price". Integer paise (CLAUDE.md §3.6).
const LIST_PRICE_PAISE = 1_000_000; // ₹10,000.00
const OFFER_PRICE_PAISE = 600_000; // ₹6,000.00
const OFFER_DISCOUNT_PAISE = LIST_PRICE_PAISE - OFFER_PRICE_PAISE; // ₹4,000.00 flat

// ── password helpers (mirror scripts/dev-set-passwords.cjs: argon2id, status active) ──
async function hash(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id });
}

/** Upsert a login-ready user by (tenantId, email); assign a role (branch-scoped or global). */
async function ensureUser(args: {
  tenantId: string;
  email: string;
  name: string;
  phone?: string;
  password: string;
  roleId: string;
  branchId: string | null;
}): Promise<{ id: string; created: boolean }> {
  const passwordHash = await hash(args.password);
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: args.tenantId, email: args.email } },
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        // Re-assert a known password + active status so the account is always login-ready.
        data: { name: args.name, phone: args.phone, passwordHash, status: "active" },
      })
    : await prisma.user.create({
        data: {
          tenantId: args.tenantId,
          email: args.email,
          name: args.name,
          phone: args.phone,
          passwordHash,
          status: "active",
        },
      });

  // user_roles has a compound unique (user_id, role_id, branch_id) with a nullable
  // column — do find-then-create rather than upsert (Prisma rejects null in the
  // composite where).
  const existingRole = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: args.roleId, branchId: args.branchId },
  });
  if (!existingRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: args.roleId, branchId: args.branchId } });
  }

  return { id: user.id, created: !existing };
}

async function main(): Promise<void> {
  // ── Tenant (reuse the canonical one) ─────────────────────────────────────
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `[seed:medical] Tenant "${TENANT_SLUG}" not found. Run \`pnpm db:seed\` first (it creates roles/permissions).`,
    );
  }

  // ── Roles (reuse the canonical RBAC — do NOT recreate the catalog) ────────
  const rolesArr = await prisma.role.findMany({
    where: { tenantId: tenant.id, key: { in: ["super_admin", "faculty", "mentor", "student"] } },
  });
  const roleByKey = new Map<string, Role>(rolesArr.map((r) => [r.key, r]));
  function roleId(key: string): string {
    const r = roleByKey.get(key);
    if (!r) {
      throw new Error(
        `[seed:medical] Role "${key}" not found. Run \`pnpm db:seed\` first to establish RBAC.`,
      );
    }
    return r.id;
  }

  // ── 1 branch ─────────────────────────────────────────────────────────────
  const BRANCH_NAME = "BiPC Medical Academy — Hyderabad";
  const existingBranch = await prisma.branch.findFirst({ where: { tenantId: tenant.id, name: BRANCH_NAME } });
  const branch = existingBranch
    ? await prisma.branch.update({
        where: { id: existingBranch.id },
        data: { city: "Hyderabad", address: "Ameerpet, Hyderabad, Telangana", status: BranchStatus.active },
      })
    : await prisma.branch.create({
        data: {
          tenantId: tenant.id,
          name: BRANCH_NAME,
          city: "Hyderabad",
          address: "Ameerpet, Hyderabad, Telangana",
          status: BranchStatus.active,
        },
      });

  // ── 1 admin ──────────────────────────────────────────────────────────────
  const admin = await ensureUser({
    tenantId: tenant.id,
    email: "admin@bipc.test",
    name: "BiPC Academy Admin",
    phone: "+919000000001",
    password: "Admin@12345",
    roleId: roleId("super_admin"),
    branchId: null,
  });

  // ── 5 faculty (internal teaching staff → FacultyProfile) ─────────────────
  const facultyDefs = [
    { first: "padma", name: "Dr. Padma Krishnan", expertise: ["Biology", "NEET Zoology"], bio: "NEET Biology mentor, 12 years coaching BiPC students." },
    { first: "ravi", name: "Dr. Ravi Teja", expertise: ["Physics", "Medical Physics"], bio: "Physics faculty specialising in NEET/EAMCET medical stream." },
    { first: "shalini", name: "Dr. Shalini Rao", expertise: ["Chemistry", "Organic Chemistry"], bio: "Chemistry faculty, ex-Osmania University." },
    { first: "naveen", name: "Dr. Naveen Kumar", expertise: ["Zoology", "Human Physiology"], bio: "Zoology faculty and lab coordinator." },
    { first: "deepa", name: "Dr. Deepa Varma", expertise: ["Botany", "Genetics"], bio: "Botany faculty, plant biotechnology specialist." },
  ] as const;

  const facultyProfiles: Array<{ id: string; userId: string; first: string }> = [];
  for (let i = 0; i < facultyDefs.length; i++) {
    const def = facultyDefs[i]!;
    const u = await ensureUser({
      tenantId: tenant.id,
      email: `${def.first}@bipc.test`,
      name: def.name,
      phone: `+91900000${String(100 + i).padStart(4, "0")}`,
      password: "Faculty@12345",
      roleId: roleId("faculty"),
      branchId: branch.id,
    });
    const existingFp = await prisma.facultyProfile.findUnique({ where: { userId: u.id } });
    const fp = existingFp
      ? await prisma.facultyProfile.update({
          where: { id: existingFp.id },
          data: { expertise: def.expertise as unknown as object, bio: def.bio, branchId: branch.id, rating: 4.7 },
        })
      : await prisma.facultyProfile.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            expertise: def.expertise as unknown as object,
            bio: def.bio,
            branchId: branch.id,
            rating: 4.7,
          },
        });
    facultyProfiles.push({ id: fp.id, userId: u.id, first: def.first });
  }

  // ── 10 mentors (external medical subject-matter experts → Mentor) ────────
  const mentorDefs = [
    { first: "suresh", name: "Dr. Suresh Rao", institute: "Osmania Medical College", expertise: ["Human Anatomy", "Dissection Lab"], title: "Professor of Anatomy" },
    { first: "lakshmi", name: "Dr. Lakshmi Menon", institute: "Gandhi Medical College", expertise: ["Physiology", "Neurophysiology"], title: "Professor of Physiology" },
    { first: "anil", name: "Dr. Anil Kapoor", institute: "NIMS Hyderabad", expertise: ["Biochemistry", "Metabolism"], title: "Associate Professor" },
    { first: "priyanka", name: "Dr. Priyanka Reddy", institute: "Apollo Institute", expertise: ["Microbiology", "Immunology"], title: "Consultant Microbiologist" },
    { first: "vikram", name: "Dr. Vikram Singh", institute: "AIIMS (visiting)", expertise: ["Clinical Research", "Pharmacovigilance"], title: "Clinical Research Lead" },
    { first: "meena", name: "Dr. Meena Gupta", institute: "Yashoda Nursing College", expertise: ["Nursing", "Patient Care"], title: "Head of Nursing" },
    { first: "arjun", name: "Dr. Arjun Desai", institute: "CCMB Hyderabad", expertise: ["Biotechnology", "Molecular Biology"], title: "Senior Scientist" },
    { first: "sneha", name: "Dr. Sneha Joshi", institute: "CDFD Hyderabad", expertise: ["Genetics", "Genomics"], title: "Geneticist" },
    { first: "kiran", name: "Dr. Kiran Bhat", institute: "Care Hospitals", expertise: ["Pathology", "Lab Diagnostics"], title: "Consultant Pathologist" },
    { first: "farhana", name: "Dr. Farhana Sheikh", institute: "Deccan College of Medical Sciences", expertise: ["Pharmacology", "Toxicology"], title: "Professor of Pharmacology" },
  ] as const;

  const mentors: Array<{ id: string; first: string }> = [];
  for (let i = 0; i < mentorDefs.length; i++) {
    const def = mentorDefs[i]!;
    const email = `${def.first}@bipc.test`;
    // Give every mentor a login so the mentor dashboard is testable (userId is optional
    // on Mentor, but we grant logins here on purpose).
    const u = await ensureUser({
      tenantId: tenant.id,
      email,
      name: def.name,
      phone: `+91900000${String(200 + i).padStart(4, "0")}`,
      password: "Mentor@12345",
      roleId: roleId("mentor"),
      branchId: branch.id,
    });
    const existingMentor = await prisma.mentor.findFirst({ where: { tenantId: tenant.id, email } });
    const mentor = existingMentor
      ? await prisma.mentor.update({
          where: { id: existingMentor.id },
          data: {
            userId: u.id,
            fullName: def.name,
            externalInstitute: def.institute,
            expertise: def.expertise as unknown as object,
            engagementStatus: MentorEngagementStatus.active,
            title: def.title,
            bio: `${def.title} at ${def.institute}. BiPC/medical subject-matter mentor.`,
            yearsExperience: 8 + i,
          },
        })
      : await prisma.mentor.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            fullName: def.name,
            email,
            phone: `+91900000${String(200 + i).padStart(4, "0")}`,
            externalInstitute: def.institute,
            expertise: def.expertise as unknown as object,
            engagementStatus: MentorEngagementStatus.active,
            title: def.title,
            bio: `${def.title} at ${def.institute}. BiPC/medical subject-matter mentor.`,
            yearsExperience: 8 + i,
          },
        });
    mentors.push({ id: mentor.id, first: def.first });
  }

  // ── 6 courses (₹10,000; 3 with scholarship) ──────────────────────────────
  const programDefs = [
    {
      slug: "neet-biology-intensive",
      title: "NEET Biology Intensive Internship",
      domain: "medical-entrance",
      level: "intermediate",
      mode: ProgramMode.hybrid,
      scholarship: true,
      cardSummary: "Full NEET Biology syllabus with clinical case discussions and mentor-led doubt clearing.",
      modules: [
        { title: "Cell Biology & Genetics", lessons: ["Cell Structure & Function", "Mendelian Genetics", "Molecular Basis of Inheritance"] },
        { title: "Human Physiology", lessons: ["Digestion & Absorption", "Circulation & the Heart", "Nervous & Endocrine Control"] },
      ],
    },
    {
      slug: "medical-lab-technology",
      title: "Medical Laboratory Technology Internship",
      domain: "allied-health",
      level: "beginner",
      mode: ProgramMode.hybrid,
      scholarship: true,
      cardSummary: "Hands-on diagnostic lab training: haematology, biochemistry and microbiology workflows.",
      modules: [
        { title: "Lab Foundations & Safety", lessons: ["Biosafety & Sterilisation", "Specimen Collection", "Microscopy Basics"] },
        { title: "Clinical Diagnostics", lessons: ["Haematology Panels", "Clinical Biochemistry", "Culture & Sensitivity"] },
      ],
    },
    {
      slug: "clinical-research-pharmacovigilance",
      title: "Clinical Research & Pharmacovigilance Internship",
      domain: "clinical-research",
      level: "intermediate",
      mode: ProgramMode.recorded,
      scholarship: false,
      cardSummary: "GCP, trial design and adverse-event reporting for pharma and CRO careers.",
      modules: [
        { title: "Clinical Trial Fundamentals", lessons: ["Phases of Clinical Trials", "Good Clinical Practice (GCP)", "Informed Consent & Ethics"] },
        { title: "Pharmacovigilance", lessons: ["Adverse Event Reporting", "Signal Detection", "Regulatory Submissions"] },
      ],
    },
    {
      slug: "nursing-patient-care",
      title: "Nursing & Patient Care Foundations Internship",
      domain: "nursing",
      level: "beginner",
      mode: ProgramMode.live,
      scholarship: true,
      cardSummary: "Core bedside nursing skills, vitals, and patient-safety fundamentals with clinical mentors.",
      modules: [
        { title: "Fundamentals of Nursing", lessons: ["Vital Signs & Monitoring", "Infection Control", "Patient Hygiene & Mobility"] },
        { title: "Acute & Emergency Care", lessons: ["Basic Life Support", "Wound Care", "Medication Administration"] },
      ],
    },
    {
      slug: "anatomy-physiology-internship",
      title: "Human Anatomy & Physiology Internship",
      domain: "biosciences",
      level: "intermediate",
      mode: ProgramMode.hybrid,
      scholarship: false,
      cardSummary: "Systems-based anatomy and physiology with cadaver-model demonstrations.",
      modules: [
        { title: "Musculoskeletal & Nervous Systems", lessons: ["Skeletal System", "Muscular System", "Central Nervous System"] },
        { title: "Cardiovascular & Respiratory Systems", lessons: ["Heart & Vasculature", "Respiratory Mechanics", "Gas Exchange"] },
      ],
    },
    {
      slug: "biotech-genetics-lab",
      title: "Biotechnology & Genetics Lab Internship",
      domain: "biotechnology",
      level: "advanced",
      mode: ProgramMode.recorded,
      scholarship: false,
      cardSummary: "Molecular biology bench skills: PCR, gel electrophoresis and gene analysis.",
      modules: [
        { title: "Molecular Techniques", lessons: ["DNA Extraction", "PCR & Primer Design", "Gel Electrophoresis"] },
        { title: "Applied Genetics", lessons: ["Cloning Basics", "Genetic Screening", "Bioinformatics Intro"] },
      ],
    },
  ] as const;

  const programs: Array<{ id: string; slug: string; scholarship: boolean }> = [];
  for (let pi = 0; pi < programDefs.length; pi++) {
    const def = programDefs[pi]!;
    const existing = await prisma.program.findFirst({
      where: { tenantId: tenant.id, slug: def.slug, deletedAt: null },
    });
    // Public marketing courses carry SEO fields (seoTitle/seoDescription/cardSummary) and
    // denormalized rating display fields (ratingAvg is 0–50 = 0.0–5.0 stars, ×10 — no
    // floats, CLAUDE.md §3.6). The Phase-5 website integration test asserts every
    // is_public program has these set, so they are required, not optional.
    const data = {
      title: def.title,
      domain: def.domain,
      level: def.level,
      mode: def.mode,
      durationWeeks: 12,
      pricePaise: LIST_PRICE_PAISE,
      currency: "INR",
      status: ProgramStatus.published,
      isPublic: true,
      scholarshipAvailable: def.scholarship,
      cardSummary: def.cardSummary,
      summary: def.cardSummary,
      seoTitle: `${def.title} | BiPC Medical Academy`,
      seoDescription: def.cardSummary,
      ratingAvg: 46 + (pi % 4), // 4.6–4.9 stars
      ratingCount: 120 + pi * 15,
    };
    const program = existing
      ? await prisma.program.update({ where: { id: existing.id }, data })
      : await prisma.program.create({ data: { tenantId: tenant.id, slug: def.slug, ...data } });

    // Modules + lessons (idempotent by order within the program). First lesson of the
    // program is a free preview so preview playback is testable without enrollment.
    let firstLesson = true;
    for (let mi = 0; mi < def.modules.length; mi++) {
      const modDef = def.modules[mi]!;
      const existingModule = await prisma.module.findFirst({
        where: { programId: program.id, order: mi + 1, deletedAt: null },
      });
      const mod = existingModule
        ? await prisma.module.update({ where: { id: existingModule.id }, data: { title: modDef.title } })
        : await prisma.module.create({ data: { programId: program.id, title: modDef.title, order: mi + 1 } });

      for (let li = 0; li < modDef.lessons.length; li++) {
        const title = modDef.lessons[li]!;
        const isPreview = firstLesson;
        firstLesson = false;
        const existingLesson = await prisma.lesson.findFirst({
          where: { moduleId: mod.id, order: li + 1, deletedAt: null },
        });
        if (existingLesson) {
          await prisma.lesson.update({
            where: { id: existingLesson.id },
            data: { title, type: LessonType.video, isPreview },
          });
        } else {
          await prisma.lesson.create({
            data: { moduleId: mod.id, title, type: LessonType.video, order: li + 1, isPreview },
          });
        }
      }
    }

    programs.push({ id: program.id, slug: def.slug, scholarship: def.scholarship });
  }

  const scholarshipProgramIds = programs.filter((p) => p.scholarship).map((p) => p.id);

  // ── Coupons: OFFER6000 (₹10k → ₹6k) + MEDSCHOLAR50 (50% off scholarship courses) ──
  async function ensureCoupon(args: {
    code: string;
    type: CouponType;
    value: number;
    programScope: string[] | null;
    maxUses: number | null;
  }): Promise<void> {
    await prisma.coupon.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: args.code } },
      update: {
        type: args.type,
        value: args.value,
        programScope: args.programScope ?? undefined,
        maxUses: args.maxUses,
        status: CouponStatus.active,
      },
      create: {
        tenantId: tenant.id,
        code: args.code,
        type: args.type,
        value: args.value,
        programScope: args.programScope ?? undefined,
        maxUses: args.maxUses,
        status: CouponStatus.active,
      },
    });
  }

  // OFFER6000: flat ₹4,000 off ANY course → ₹10,000 becomes the ₹6,000 offer price.
  await ensureCoupon({ code: "OFFER6000", type: CouponType.flat, value: OFFER_DISCOUNT_PAISE, programScope: null, maxUses: null });
  // MEDSCHOLAR50: 50% scholarship waiver, scoped to the scholarship-flagged courses.
  await ensureCoupon({ code: "MEDSCHOLAR50", type: CouponType.pct, value: 50, programScope: scholarshipProgramIds, maxUses: 500 });

  // ── 6 batches (one per course) with faculty + mentor assignments ─────────
  // start date: use a fixed absolute date (Date.now() is fine here — this is a plain
  // Node script, not a resumable workflow).
  const startDate = new Date("2026-08-01T00:00:00.000Z");
  const endDate = new Date("2026-11-01T00:00:00.000Z");

  for (let i = 0; i < programs.length; i++) {
    const program = programs[i]!;
    const faculty = facultyProfiles[i % facultyProfiles.length]!;
    const batchName = `${programDefs[i]!.title.replace(/ Internship$/, "")} — Batch 2026-A`;

    const existingBatch = await prisma.batch.findFirst({ where: { tenantId: tenant.id, name: batchName, deletedAt: null } });
    const batch = existingBatch
      ? await prisma.batch.update({
          where: { id: existingBatch.id },
          data: { programId: program.id, branchId: branch.id, facultyId: faculty.id, status: "active", capacity: 40 },
        })
      : await prisma.batch.create({
          data: {
            tenantId: tenant.id,
            programId: program.id,
            branchId: branch.id,
            facultyId: faculty.id,
            name: batchName,
            startDate,
            endDate,
            capacity: 40,
            mode: programDefs[i]!.mode,
            status: "active",
          },
        });

    // Assign 2 mentors per batch, cycling so all 10 mentors land on at least one batch.
    const leadMentor = mentors[(2 * i) % mentors.length]!;
    const coMentor = mentors[(2 * i + 1) % mentors.length]!;
    for (const [mentor, isLead] of [
      [leadMentor, true],
      [coMentor, false],
    ] as const) {
      const existingBm = await prisma.batchMentor.findFirst({
        where: { tenantId: tenant.id, batchId: batch.id, mentorId: mentor.id, deletedAt: null },
      });
      if (!existingBm) {
        await prisma.batchMentor.create({
          data: { tenantId: tenant.id, batchId: batch.id, mentorId: mentor.id, isLead, assignedByUserId: admin.id },
        });
      } else {
        await prisma.batchMentor.update({ where: { id: existingBm.id }, data: { isLead } });
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const [branchCount, mentorCount, facultyCount, programCount, batchCount] = await Promise.all([
    prisma.branch.count({ where: { tenantId: tenant.id, name: BRANCH_NAME } }),
    prisma.mentor.count({ where: { tenantId: tenant.id, email: { endsWith: "@bipc.test" } } }),
    prisma.facultyProfile.count({ where: { tenantId: tenant.id, user: { email: { endsWith: "@bipc.test" } } } }),
    prisma.program.count({ where: { tenantId: tenant.id, slug: { in: programDefs.map((p) => p.slug) }, deletedAt: null } }),
    prisma.batch.count({ where: { tenantId: tenant.id, name: { contains: "Batch 2026-A" }, deletedAt: null } }),
  ]);

  console.log("\n=== BiPC / Medical seed complete ===\n");
  console.log(`  branch:   ${branchCount}  (${BRANCH_NAME})`);
  console.log(`  admin:    admin@bipc.test / Admin@12345  (super_admin, CRM)`);
  console.log(`  faculty:  ${facultyCount}  logins <first>@bipc.test / Faculty@12345`);
  console.log(`  mentors:  ${mentorCount}  logins <first>@bipc.test / Mentor@12345`);
  console.log(`  courses:  ${programCount}  @ ₹10,000 (${scholarshipProgramIds.length} with scholarship)`);
  console.log(`  batches:  ${batchCount}  (each: 1 faculty + 2 mentors assigned)`);
  console.log(`  coupons:  OFFER6000 (flat ₹4,000 off → ₹6,000 offer price), MEDSCHOLAR50 (50% off scholarship courses)`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
