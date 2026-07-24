/**
 * add-bipc.ts — one-off: add 3 BiPC (Bio-Physics-Chemistry / medical-stream)
 * courses priced at ₹6,000 each, plus a "Visakhapatnam" branch.
 *
 * Price is integer paise (CLAUDE.md §3.6): ₹6,000 = 600000 paise.
 * Run:  ts-node --project prisma/tsconfig.seed.json prisma/add-bipc.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PRICE_PAISE = 600_000; // ₹6,000

const BIPC_COURSES = [
  {
    slug: "neet-biology-mastery-bipc",
    title: "NEET Biology Mastery (BiPC)",
    domain: "bipc",
    level: "intermediate",
    durationWeeks: 24,
    cardSummary: "Complete NEET Biology for BiPC aspirants — Botany + Zoology, exam-focused.",
  },
  {
    slug: "neet-physics-chemistry-intensive-bipc",
    title: "NEET Physics & Chemistry Intensive (BiPC)",
    domain: "bipc",
    level: "intermediate",
    durationWeeks: 24,
    cardSummary: "Physics + Chemistry crash-and-depth track built for the BiPC / NEET syllabus.",
  },
  {
    slug: "bipc-foundation-integrated-science",
    title: "BiPC Foundation — Integrated Science Program",
    domain: "bipc",
    level: "beginner",
    durationWeeks: 16,
    cardSummary: "Foundation Biology, Physics & Chemistry for first-year BiPC students.",
  },
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
  if (!tenant) throw new Error("[add-bipc] no tenant found");

  // 1) Courses (programs) — published + public so they surface in CRM and on the site.
  const createdCourses: string[] = [];
  for (const c of BIPC_COURSES) {
    const existing = await prisma.program.findFirst({ where: { tenantId: tenant.id, slug: c.slug } });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`[add-bipc] course exists, skipping: ${c.slug}`);
      continue;
    }
    const program = await prisma.program.create({
      data: {
        tenantId: tenant.id,
        slug: c.slug,
        title: c.title,
        domain: c.domain,
        level: c.level,
        mode: "recorded",
        durationWeeks: c.durationWeeks,
        pricePaise: PRICE_PAISE,
        currency: "INR",
        cardSummary: c.cardSummary,
        status: "published",
        isPublic: true,
      },
    });
    createdCourses.push(`${program.title} (₹${(program.pricePaise / 100).toLocaleString("en-IN")})`);
  }

  // 2) Branch — Visakhapatnam.
  const branchName = "Visakhapatnam";
  let branchNote: string;
  const existingBranch = await prisma.branch.findFirst({ where: { tenantId: tenant.id, name: branchName } });
  if (existingBranch) {
    branchNote = `branch exists, skipped: ${branchName}`;
  } else {
    const branch = await prisma.branch.create({
      data: { tenantId: tenant.id, name: branchName, city: branchName, status: "active" },
    });
    branchNote = `branch created: ${branch.name} (${branch.id})`;
  }

  // eslint-disable-next-line no-console
  console.log("\n[add-bipc] done.");
  // eslint-disable-next-line no-console
  console.log(`[add-bipc] courses created (${createdCourses.length}):`);
  for (const line of createdCourses) {
    // eslint-disable-next-line no-console
    console.log(`[add-bipc]   - ${line}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[add-bipc] ${branchNote}\n`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
