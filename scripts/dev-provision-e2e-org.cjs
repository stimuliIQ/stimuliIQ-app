// scripts/dev-provision-e2e-org.cjs
//
// LOCAL DEV ONLY. Provisions the org-chart fixture that the two live leave/reporting
// Playwright specs document but no script ever created:
//
//   apps/crm/e2e/team-scoped-reports.e2e.spec.ts  (read-only)
//   apps/crm/e2e/leave-two-step.e2e.spec.ts       (destructive, opt-in)
//
// Both name the same three `matrix.*@probe.test` accounts as their defaults, and both
// skip themselves with "provision the fixture accounts first" when those accounts cannot
// sign in. On a freshly seeded database they never can: the probe accounts are created
// status="invited" with placeholder hashes, and nobody is on a team. So the specs have
// always skipped, which is the quietest way for a suite to stop testing anything.
//
// This makes them runnable:
//
//   node scripts/dev-provision-e2e-org.cjs
//   QA_LEAVE_PASSWORD=LeaveQa@12345 npx playwright test e2e/team-scoped-reports
//
// The team it builds is the smallest one that exercises the rule under test — a manager,
// a lead and one member, in a single fixed-depth chain (ADR-0069):
//
//   manager  matrix.counsellor@probe.test      (a LEAD-OWNING role on purpose: the
//                                               lead-performance report's pool is
//                                               counsellor+marketing, and the spec asserts
//                                               the actor appears in their own team's rows)
//   lead     matrix.branch_manager@probe.test
//   member   matrix.content_editor@probe.test
//
// Refuses to run against a non-local database, same guard as dev-set-passwords.cjs. It
// touches ONLY the three probe accounts and one team named below, so it cannot disturb
// the demo accounts a human is using.

const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");

const DB_URL = process.env.DATABASE_URL || "";
const isLocalHost = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
const isProd = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
if (!isLocalHost || isProd) {
  console.error(
    "[dev-provision-e2e-org] Refusing to run: DATABASE_URL is not local, or the environment " +
      "is production. This script is for local dev only.",
  );
  process.exit(1);
}

const PASSWORD = process.env.QA_LEAVE_PASSWORD || "LeaveQa@12345";
const TEAM_NAME = "E2E Approval Chain";

const MANAGER = "matrix.counsellor@probe.test";
const LEAD = "matrix.branch_manager@probe.test";
const MEMBER = "matrix.content_editor@probe.test";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: "stimuliiq" } });
    if (!tenant) throw new Error("Tenant 'stimuliiq' not found — run `pnpm db:seed` first.");

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const users = {};
    for (const email of [MANAGER, LEAD, MEMBER]) {
      const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
      if (!user) {
        throw new Error(
          `${email} does not exist. These are the RBAC probe accounts — run \`pnpm db:seed\` first.`,
        );
      }
      users[email] = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "active" },
      });
    }

    // Idempotent: re-running re-points the same team rather than accumulating teams, so
    // the chain a spec reads is always the one this script last described.
    const existing = await prisma.team.findFirst({
      where: { tenantId: tenant.id, name: TEAM_NAME, deletedAt: null },
    });
    const team = existing
      ? await prisma.team.update({
          where: { id: existing.id },
          data: { managerUserId: users[MANAGER].id, leadUserId: users[LEAD].id, active: true },
        })
      : await prisma.team.create({
          data: {
            tenantId: tenant.id,
            name: TEAM_NAME,
            managerUserId: users[MANAGER].id,
            leadUserId: users[LEAD].id,
          },
        });

    // Membership is exactly one team per person (P17), so this is an assignment, not an add.
    // The manager stays OFF the team they manage: `listSubordinateUserIds` walks down from
    // the team they own, and a manager who is also a member of it is their own subordinate.
    for (const email of [LEAD, MEMBER]) {
      await prisma.user.update({ where: { id: users[email].id }, data: { teamId: team.id } });
    }

    console.log(`\n=== E2E org fixture ready (team "${TEAM_NAME}") ===\n`);
    console.log(`  manager  ${MANAGER}`);
    console.log(`  lead     ${LEAD}`);
    console.log(`  member   ${MEMBER}`);
    console.log(`  password ${PASSWORD}   (local dev only, not a secret)\n`);
    console.log("Run the specs it unlocks:");
    console.log(`  QA_LEAVE_PASSWORD=${PASSWORD} npx playwright test e2e/team-scoped-reports`);
    console.log(
      `  QA_ALLOW_DESTRUCTIVE=1 QA_LEAVE_PASSWORD=${PASSWORD} npx playwright test e2e/leave-two-step\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
