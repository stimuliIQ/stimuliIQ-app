/**
 * seed-course-types.ts — stands up CRM-managed course types on an EXISTING database.
 * Spec: docs/specs/course-types.md, ADR-0068.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason `seed-careers.ts`,
 * `seed-leave.ts` and `seed-onboarding.ts` are: the full seed is a dev-fixture script that
 * upserts demo students, sample programs and campaigns, so running it against a live
 * database injects fake data into a real catalog. This script writes ONLY:
 *
 *   1. the `course_types.manage` permission
 *   2. its role grants (super_admin + admin)
 *   3. a safety net — a `course_types` row for any key students in this tenant already
 *      hold that has no option yet. The migration
 *      (`20260827120000_course_types_crm_managed`) already does exactly this, so on a
 *      normal deploy it writes nothing; it exists for a database restored from an older
 *      dump, where a student would otherwise carry a key with no editable option behind it.
 *
 * NO NEW OPTIONS ARE INVENTED, on purpose — the same judgement `seed-careers.ts` makes
 * about job openings and `seed-leave.ts` makes about public holidays. Which qualifications
 * a company recruits for is a live business fact; seeding a plausible-looking list would
 * put "MBA" in front of staff as though somebody had decided it, and a wrong option is
 * chosen silently by whoever is in a hurry. Staff author the real list in
 * CRM ▸ Admin ▸ Course types.
 *
 * Idempotent and non-destructive: permissions and grants are upserts, options are only ever
 * created when missing, and an existing option's label/order is never overwritten (a rename
 * by staff is the point of the feature and must survive a re-run).
 *
 * Run:  pnpm db:seed:course-types
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-course-types.ts)
 *
 * Run it AFTER `prisma migrate deploy` has applied
 * `20260827120000_course_types_crm_managed`.
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * ONE key, held by admin AND super_admin.
 *
 * Maintaining the list of qualifications is operational configuration, not authority over a
 * person — unlike `leave.approve` or `marketing_targets.manage`, which are narrowed to
 * super_admin precisely because they decide something about a member of staff. There is no
 * `course_types.view`: reading the list is gated on `students.view`, so every role that can
 * open the student directory already has what it needs to render the picker.
 */
const PERMISSION = { key: "course_types.manage", label: "Manage Course Types" } as const;

const ROLE_KEYS_WITH_MANAGE = ["super_admin", "admin"] as const;

/** Titlecase a legacy key for its first label: "b_tech" -> "B Tech". Staff rename it after. */
function labelFromKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The labels the CRM has always shown for the six keys of the enum this feature replaced. */
const LEGACY_ENUM_LABELS: Record<string, string> = {
  btech: "B.Tech",
  degree: "Degree",
  diploma: "Diploma",
  mca: "MCA",
  mba: "MBA",
  other: "Other",
};

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-course-types] tenant "${TENANT_SLUG}" not found`);

  const permission = await prisma.permission.upsert({
    where: { key: PERMISSION.key },
    update: { label: PERMISSION.label },
    create: { key: PERMISSION.key, label: PERMISSION.label },
  });

  let grantsWritten = 0;
  for (const roleKey of ROLE_KEYS_WITH_MANAGE) {
    const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
    if (!role) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-course-types] role "${roleKey}" not found — skipping its grant`);
      continue;
    }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { scope: RolePermissionScope.all, deletedAt: null },
      create: { roleId: role.id, permissionId: permission.id, scope: RolePermissionScope.all },
    });
    grantsWritten += 1;
  }

  // Safety net — see the file header. Nothing to do on a normally-migrated database.
  const inUse = await prisma.studentProfile.findMany({
    where: { tenantId: tenant.id, deletedAt: null, courseType: { not: null } },
    select: { courseType: true },
    distinct: ["courseType"],
  });
  const existing = await prisma.courseType.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { key: true },
  });
  const known = new Set(existing.map((row) => row.key));
  const missing = inUse.map((row) => row.courseType).filter((key): key is string => !!key && !known.has(key));

  let created = 0;
  for (const [index, key] of missing.entries()) {
    await prisma.courseType.create({
      data: {
        tenantId: tenant.id,
        key,
        label: LEGACY_ENUM_LABELS[key] ?? labelFromKey(key),
        sortOrder: known.size + index + 1,
        active: true,
      },
    });
    created += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed-course-types] done — permission upserted, ${grantsWritten} role grants written, ` +
      `${created} option${created === 1 ? "" : "s"} recovered from existing student records.\n` +
      `[seed-course-types] No course types were invented (see this file's header). ` +
      `Author the real list in CRM ▸ Admin ▸ Course types — renaming an option updates every screen at once; ` +
      `hide one to retire it without changing what existing students are recorded as.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-course-types] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
