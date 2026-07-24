// scripts/create-crm-admin.cjs
//
// LOCAL DEV ONLY. Creates (or re-activates) a real CRM super-admin login in the app's
// OWN auth system — NestJS JWT + argon2 password hash + Postgres + RBAC. There is NO
// Supabase in this stack; this is the genuine, fully-authenticated account used to log
// into the CRM at http://localhost:3002.
//
// Idempotent: safe to re-run (upserts the user, re-asserts the password + super_admin role).
//
//   node scripts/create-crm-admin.cjs
//
// Refuses to run against a non-local database (guards on host + APP_ENV/NODE_ENV), same
// posture as scripts/dev-set-passwords.cjs.

const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");

const DB_URL = process.env.DATABASE_URL || "";
const isLocalHost = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
const isProd = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
if (!isLocalHost || isProd) {
  console.error(
    `[create-crm-admin] Refusing to run: DATABASE_URL is not local (${DB_URL || "unset"}) ` +
      `or environment is production. This script is for local dev only.`,
  );
  process.exit(1);
}

// The requested CRM login. NOTE: the login DTO enforces a 10-character minimum
// (PasswordSchema, packages/types/src/common/primitives.ts), so "Admin@123" (9 chars)
// cannot be submitted through the login form — it 422s BEFORE any credential check.
// "Admin@1234" is the closest compliant password (10 chars, letter + digit).
const EMAIL = process.env.CRM_ADMIN_EMAIL || "support.stimuliiq@gmail.com";
const PASSWORD = process.env.CRM_ADMIN_PASSWORD || "Admin@1234";
const NAME = process.env.CRM_ADMIN_NAME || "Support Admin";
const TENANT_SLUG = "stimuliiq";
const ROLE_KEY = "super_admin";

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found — run \`pnpm db:seed\` first.`);

    const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: ROLE_KEY } });
    if (!role) throw new Error(`Role '${ROLE_KEY}' not found — run \`pnpm db:seed\` first.`);

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: EMAIL } },
    });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { name: NAME, passwordHash, status: "active" },
        })
      : await prisma.user.create({
          data: { tenantId: tenant.id, email: EMAIL, name: NAME, passwordHash, status: "active" },
        });

    // super_admin is a GLOBAL role assignment (branchId = null).
    const existingRole = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id, branchId: null },
    });
    if (!existingRole) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, branchId: null } });
    }

    console.log("\n=== CRM super-admin login (real app auth — NOT Supabase) ===\n");
    console.log(`  URL:      http://localhost:3002  (CRM)`);
    console.log(`  Email:    ${EMAIL}`);
    console.log(`  Password: ${PASSWORD}`);
    console.log(`  Role:     ${ROLE_KEY} (scope: all)`);
    console.log(`  Status:   active  (${existing ? "updated existing user" : "created new user"})`);
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
