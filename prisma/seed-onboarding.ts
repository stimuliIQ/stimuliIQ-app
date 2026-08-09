/**
 * seed-onboarding.ts — stands up the onboarding form on an EXISTING database.
 *
 * Deliberately separate from `prisma/seed.ts`. The full seed is a dev-fixture script: it
 * upserts sample students, demo programs, campaigns and forum threads, so running it
 * against a live database would inject demo data into a real catalog. This script writes
 * ONLY what the onboarding feature needs to function:
 *
 *   1. the four `onboarding.*` permissions + their role grants
 *   2. the nine questions the form asks
 *
 * Idempotent and non-destructive by construction:
 *   - permissions/grants are upserts;
 *   - a question whose `key` already exists is SKIPPED, never updated — once staff have
 *     edited a question in the CRM, that row is theirs and re-running this must not
 *     silently revert their wording, choices or ordering.
 *
 * Run:  pnpm db:seed:onboarding
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-onboarding.ts)
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * `onboarding.fields.manage` is a separate key from the three submission permissions on
 * purpose: someone working the intake queue should not be able to delete the
 * payment-receipt question out of the live form. See ADR-0064.
 */
const PERMISSIONS = [
  { key: "onboarding.view", label: "View Onboarding Submissions" },
  { key: "onboarding.edit", label: "Update Onboarding Submission Status" },
  { key: "onboarding.delete", label: "Delete Onboarding Submissions" },
  { key: "onboarding.fields.manage", label: "Edit the Onboarding Form Fields" },
] as const;

/** Full catalog to admins; queue-only to the roles that actually work the queue. */
const ROLE_GRANTS: Record<string, ReadonlyArray<(typeof PERMISSIONS)[number]["key"]>> = {
  super_admin: PERMISSIONS.map((p) => p.key),
  admin: PERMISSIONS.map((p) => p.key),
  counsellor: ["onboarding.view", "onboarding.edit"],
  support: ["onboarding.view", "onboarding.edit"],
};

/**
 * The questions the previous Google Form asked, in its order — plus a `program` dropdown
 * replacing its hardcoded "Psychology Fellowship Program 2026" header, so one permanent
 * link keeps working as the catalog changes.
 *
 * These carry no special status once inserted: they are ordinary rows staff edit, reorder
 * or delete from CRM ▸ Onboarding ▸ Form fields.
 */
const FIELDS = [
  { key: "full_name", label: "Name", type: "text", required: true, identityRole: "name", placeholder: "Your full name" },
  { key: "email", label: "Email ID", type: "email", required: true, identityRole: "email", placeholder: "you@example.com" },
  { key: "contact_number", label: "Contact Number", type: "phone", required: true, identityRole: "phone" },
  { key: "whatsapp_number", label: "Whatsapp Number", type: "phone", required: true },
  { key: "college_name", label: "College Name", type: "text", required: true },
  { key: "program", label: "Program", helpText: "The program you have enrolled in.", type: "program", required: true },
  {
    key: "month_opted",
    label: "Month Opted",
    helpText: "Enter the preferred month.",
    type: "radio",
    required: true,
    options: ["September", "October", "November", "December"],
    allowOther: true,
  },
  {
    key: "referrals",
    label: "Referrals from the batch",
    helpText: "Contact details of someone you would like to refer to this program.",
    type: "textarea",
    required: false,
  },
  {
    key: "payment_receipt",
    label: "Payment Receipt",
    helpText: "Upload a screenshot or PDF of your payment. Max 10 MB.",
    type: "file",
    required: true,
  },
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-onboarding] tenant "${TENANT_SLUG}" not found`);

  // ── Permissions + grants ────────────────────────────────────────────────
  let grantsWritten = 0;
  for (const perm of PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: { key: perm.key, label: perm.label },
    });

    for (const [roleKey, keys] of Object.entries(ROLE_GRANTS)) {
      if (!keys.includes(perm.key)) continue;
      const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
      if (!role) {
        // eslint-disable-next-line no-console
        console.warn(`[seed-onboarding] role "${roleKey}" not found — skipping its grants`);
        continue;
      }
      // scope=all, not branch: a submission arrives from an anonymous public form and has
      // no branch to be partitioned by; the service fails closed on any narrower scope.
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: { scope: RolePermissionScope.all },
        create: { roleId: role.id, permissionId: permission.id, scope: RolePermissionScope.all },
      });
      grantsWritten += 1;
    }
  }

  // ── Questions ───────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  for (const [index, def] of FIELDS.entries()) {
    const existing = await prisma.onboardingField.findFirst({
      where: { tenantId: tenant.id, key: def.key, deletedAt: null },
    });
    if (existing) {
      skipped += 1; // Staff own this row now — never overwrite their edits.
      continue;
    }
    await prisma.onboardingField.create({
      data: {
        tenantId: tenant.id,
        key: def.key,
        label: def.label,
        helpText: "helpText" in def ? def.helpText : null,
        placeholder: "placeholder" in def ? def.placeholder : null,
        type: def.type,
        required: def.required,
        options: "options" in def ? [...def.options] : undefined,
        allowOther: "allowOther" in def ? def.allowOther : false,
        identityRole: "identityRole" in def ? def.identityRole : "none",
        sortOrder: index,
        active: true,
      },
    });
    created += 1;
  }

  /* eslint-disable no-console */
  console.log(`[seed-onboarding] permissions: ${PERMISSIONS.length} upserted, ${grantsWritten} role grants written`);
  console.log(`[seed-onboarding] questions:   ${created} created, ${skipped} already present (left untouched)`);
  console.log(`[seed-onboarding] done — the form is live at <web>/onboarding`);
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-onboarding] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
