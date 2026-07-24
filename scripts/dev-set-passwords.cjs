// scripts/dev-set-passwords.cjs
//
// LOCAL DEV ONLY. Sets known, non-secret passwords for demo accounts and marks them
// active so all three apps can be logged into for manual testing. Seed users are
// created status="invited" with placeholder hashes and cannot log in (auth requires
// status="active"); the admin's password is randomly generated at seed time and
// printed once. This script makes a stable, documented set of demo logins.
//
// Refuses to run against a non-local database (guards on host + APP_ENV/NODE_ENV).
//
//   node scripts/dev-set-passwords.cjs

const path = require("node:path");
const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");

const DB_URL = process.env.DATABASE_URL || "";
const isLocalHost = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
const isProd = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
if (!isLocalHost || isProd) {
  console.error(
    `[dev-set-passwords] Refusing to run: DATABASE_URL is not local (${DB_URL || "unset"}) ` +
      `or environment is production. This script is for local dev only.`,
  );
  process.exit(1);
}

// email -> plaintext password. Documented in docs/local-dev-logins.md.
const ACCOUNTS = [
  { email: "admin@stimuliiq.test", password: "Admin@12345", label: "Super Admin (CRM)" },
  { email: "faculty.priya@stimuliiq.test", password: "Faculty@12345", label: "Faculty (CRM)" },
  { email: "counsellor.sneha@stimuliiq.test", password: "Counsellor@12345", label: "Counsellor (CRM)" },
  { email: "student.ananya@stimuliiq.test", password: "Student@12345", label: "Student (LMS)" },
  { email: "mentor.ramesh@stimuliiq.test", password: "Mentor@12345", label: "Mentor (CRM dashboard)" },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: "stimuliiq" } });
    if (!tenant) throw new Error("Tenant 'stimuliiq' not found — run `pnpm db:seed` first.");

    const results = [];
    for (const acct of ACCOUNTS) {
      const user = await prisma.user.findFirst({
        where: { tenantId: tenant.id, email: acct.email },
      });
      if (!user) {
        results.push({ ...acct, status: "NOT FOUND — skipped" });
        continue;
      }
      const passwordHash = await argon2.hash(acct.password, { type: argon2.argon2id });
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "active" },
      });
      results.push({ ...acct, status: "ready" });
    }

    console.log("\n=== Local dev logins (password + status set) ===\n");
    for (const r of results) {
      console.log(
        `  ${r.status === "ready" ? "OK " : "!! "} ${r.email.padEnd(38)} ${String(r.password).padEnd(18)} ${r.label} [${r.status}]`,
      );
    }
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
