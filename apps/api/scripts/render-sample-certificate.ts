/**
 * Render a certificate PDF straight from SyncCertificatePdfAdapter, without a database.
 *
 * WHY: the renderer is the one part of the certificate pipeline with no cheap feedback
 * loop — a unit test can assert "these bytes start with %PDF-" but cannot tell you the
 * ribbon heading wrapped badly or the signature is sitting on top of the ruled line. This
 * script produces a file you can actually open, for both awards, in a couple of seconds.
 *
 * USAGE (from the repo root):
 *   pnpm --filter @stimuliiq/api exec node -r ts-node/register -r tsconfig-paths/register \
 *     scripts/render-sample-certificate.ts --out ./tmp
 *
 *   --name    holder name              (default "Your Name")
 *   --program programme name           (default "Domain")
 *   --kind    internship|training|both (default both)
 *   --serial  certificate id           (default STIQ-SAMPLE-0001)
 *   --issued  issue date, YYYY-MM-DD   (default today)
 *   --out     output directory         (default the current directory)
 *
 * `--issued` exists for `scripts/check-certificate-render.cjs`, which reproduces the
 * specimen's own values and compares the result with the approved design pixel by pixel —
 * a date that changed with the clock would move the one value it is measuring.
 *
 * NOT A CERTIFICATE ISSUER. Nothing here touches the database, so the serial it prints is
 * not registered and will not verify — which is the point: this renders artwork, it does
 * not award anything. Real issuance goes through CertificatesService, which signs a
 * cert_uid, mints a serial and stores the PDF via StorageProvider.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SyncCertificatePdfAdapter } from "../src/modules/certificates/providers/pdf/sync-certificate-pdf.adapter";
import type {
  CertificateDesign,
  CertificateKind,
} from "../src/modules/certificates/providers/pdf/certificate-pdf-port.interface";

/**
 * Mirrors the seeded templates in prisma/seed.ts — keep the two in step.
 *
 * Deliberately names NO artwork. The adapter defaults the approved blank per
 * `certificateKind`, so this renders exactly what a real issuance renders, and a design
 * that only looked right because this script asked for something the database does not
 * would be invisible here.
 */
export const SAMPLE_DESIGN_BASE: CertificateDesign = {
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
};

export async function renderSample(opts: {
  kind: CertificateKind;
  holderName: string;
  programName: string;
  serial: string;
  issuedAt?: Date;
}): Promise<Buffer> {
  const adapter = new SyncCertificatePdfAdapter();
  const { bytes } = await adapter.render({
    design: { ...SAMPLE_DESIGN_BASE, certificateKind: opts.kind },
    fields: {
      holderName: opts.holderName,
      programName: opts.programName,
      issuedAt: opts.issuedAt ?? new Date(),
      // Not a real signed uid — this script never issues. Only verifyUrl reaches the PDF.
      certUid: "sample-render-no-uid",
      serial: opts.serial,
      verifyUrl: "https://stimuliiq.com/verify",
    },
  });
  return Buffer.from(bytes);
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) || fallback;
}

async function main(): Promise<void> {
  const holderName = arg("name", "Your Name");
  const programName = arg("program", "Domain");
  const serial = arg("serial", "STIQ-SAMPLE-0001");
  const issuedRaw = arg("issued", "");
  const issuedAt = issuedRaw ? new Date(`${issuedRaw}T00:00:00Z`) : undefined;
  if (issuedRaw && Number.isNaN(issuedAt!.getTime())) {
    throw new Error(`--issued must be a date, got "${issuedRaw}"`);
  }
  const outDir = resolve(arg("out", "."));
  const requested = arg("kind", "both");
  const kinds: CertificateKind[] =
    requested === "both" ? ["internship", "training"] : [requested as CertificateKind];

  await mkdir(outDir, { recursive: true });

  for (const kind of kinds) {
    const pdf = await renderSample({ kind, holderName, programName, serial, issuedAt });
    const slug = holderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const file = join(outDir, `${slug}-${kind}-certificate.pdf`);
    await writeFile(file, pdf);
    // eslint-disable-next-line no-console
    console.log(`[render] ${kind.padEnd(10)} → ${file} (${(pdf.length / 1024).toFixed(0)} KB)`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
