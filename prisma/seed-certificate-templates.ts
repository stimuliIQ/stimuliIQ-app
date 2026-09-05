/**
 * seed-certificate-templates.ts — the two approved certificate templates, on an EXISTING
 * database.
 *
 * WHY THIS IS SEPARATE FROM `prisma/seed.ts`, like seed-careers / seed-leave / seed-org:
 * the full seed is a dev-fixture script that upserts demo students, sample programmes and
 * campaigns, so running it against a live database injects fake people into a real catalog.
 * The two templates it creates were therefore never on production, and production ran with
 * a single "Stimuliiq Standard Certificate" carrying no `certificateKind` at all.
 *
 * WHAT THAT MEANT IN PRACTICE. `certificateKind` decides which approved artwork is printed.
 * With one kind-less template, EVERY certificate resolved to the same award — so an
 * internship student received a training certificate, and the approved internship artwork
 * that ships in this repo could not be issued at all.
 *
 * THIS SCRIPT WRITES ONLY the two named templates. It is additive and idempotent:
 *
 *   * "Stimuli IQ Internship Certificate"  → certificateKind: internship
 *   * "Stimuli IQ Training Certificate"    → certificateKind: training
 *
 * THE EXISTING "Stimuliiq Standard Certificate" IS DELIBERATELY NOT TOUCHED. Certificates
 * already issued reference it by id, and rewriting the design behind a certificate somebody
 * has already been awarded changes a document that has been sent and may have been printed.
 * It keeps working: a kind-less template resolves to `training` (see `resolveKind` in
 * sync-certificate-pdf.adapter.ts), which is the same answer `certificates.kind` has held in
 * the database since the training/internship split. Retiring it is a decision for whoever
 * owns the catalog, not a side effect of a seed.
 *
 * Re-running is safe: an existing row of the same name has its `design`/`fields` rewritten
 * to the approved values (the seed is the source of truth for the artwork), and nothing else
 * in the table is read or changed.
 *
 * Run:  pnpm db:seed:certificate-templates
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-certificate-templates.ts)
 *
 * Run it AFTER `prisma migrate deploy`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * Kept byte-identical to the block in `prisma/seed.ts`, so a fresh database and a live one
 * end up with the same templates. If one changes, change both — they are the same contract.
 */
const CERT_DESIGN_BASE = {
  orientation: "landscape",
  orgName: "STIMULI IQ",
  accentColor: "#14563C",
  textColor: "#1F2933",
  borderColor: "#14563C",
  backgroundColor: "#FFFFFF",
  signatoryName: "Chandra Sekhar",
  signatoryDesignation: "Founder",
  logoFileName: "logo.png",
  signatureFileName: "ceo-signature.png",
  isoBadgeFileName: "iso-badge.png",
  msmeBadgeFileName: "msme-badge.png",
  footerLines: ["Ministry of MSME, Govt. of India"],
} as const;

const CERT_FIELDS = [
  { key: "student_name", label: "Student Name" },
  { key: "program_title", label: "Program Title" },
  { key: "issued_at", label: "Date of Issue", format: "DD MMMM YYYY" },
  { key: "serial", label: "Certificate ID" },
];

/**
 * ARTWORK MODE. Naming a file here switches the renderer from drawing the certificate in
 * code to printing the APPROVED EXPORT and stamping the student's values onto it.
 *
 * Both files ship in `apps/api/assets/certificate/`. If one is ever missing on a host,
 * `loadCertificateAsset` returns undefined and the adapter falls back to the code-drawn
 * layout rather than failing an issuance — so a bad deploy degrades the design, never the
 * award.
 */
const CERT_ARTWORK: Record<"internship" | "training", string> = {
  internship: "internship-certificate-blank.png",
  training: "training-certificate-blank.png",
};

async function upsertTemplate(
  tenantId: string,
  name: string,
  certificateKind: "internship" | "training",
): Promise<"created" | "updated"> {
  const design = { ...CERT_DESIGN_BASE, certificateKind, artworkFileName: CERT_ARTWORK[certificateKind] };
  const existing = await prisma.certificateTemplate.findFirst({ where: { tenantId, name } });

  if (existing) {
    await prisma.certificateTemplate.update({
      where: { id: existing.id },
      data: { design, fields: CERT_FIELDS, status: "active" },
    });
    return "updated";
  }

  await prisma.certificateTemplate.create({
    data: { tenantId, name, design, fields: CERT_FIELDS, status: "active" },
  });
  return "created";
}

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(`[seed:certificate-templates] no tenant with slug "${TENANT_SLUG}" — nothing to seed.`);
  }

  const results = [
    ["Stimuli IQ Internship Certificate", await upsertTemplate(tenant.id, "Stimuli IQ Internship Certificate", "internship")],
    ["Stimuli IQ Training Certificate", await upsertTemplate(tenant.id, "Stimuli IQ Training Certificate", "training")],
  ] as const;

  for (const [name, action] of results) {
    console.log(`[seed:certificate-templates] ${action.padEnd(7)} ${name}`);
  }

  const all = await prisma.certificateTemplate.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { name: true, design: true, status: true },
    orderBy: { name: "asc" },
  });
  console.log(`[seed:certificate-templates] templates now active: ${all.length}`);
  for (const t of all) {
    const kind = (t.design as { certificateKind?: string } | null)?.certificateKind ?? "(none → training)";
    console.log(`  - ${t.name.padEnd(38)} kind=${kind} status=${t.status}`);
  }
}

main()
  .catch((err) => {
    console.error("[seed:certificate-templates] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
