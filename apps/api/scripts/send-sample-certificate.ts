/**
 * Email a SPECIMEN certificate to one address, for design review.
 *
 * WHY THIS EXISTS AS A SCRIPT. Checking that a certificate looks right in a real inbox —
 * with a real PDF viewer, on a phone — is a review step somebody has to do before the
 * design goes near a student, and the only alternatives were to issue a real certificate to
 * a real person or to trust a screenshot. Neither is acceptable for a document that carries
 * a serial and a verify URL.
 *
 * IT ISSUES NOTHING. No Certificate row, no serial burned, no storage write, no audit of an
 * award that did not happen. It renders through the same CertificatePdfPort the real thing
 * uses, so what lands in the inbox is the document, then throws the bytes away.
 *
 * THE CERTIFICATE ID SAYS SPECIMEN. A sample that carries a plausible serial is one
 * forward to being passed off as real, and this one is rendered on the genuine artwork with
 * the genuine signature. The id therefore reads SPECIMEN and its verify URL resolves to
 * nothing, so the public verify page answers "not found" for it.
 *
 * USAGE (from apps/api):
 *   node -r ts-node/register -r tsconfig-paths/register scripts/send-sample-certificate.ts \
 *     --to someone@example.com --name "Gandi Phanendra" [--program "Clinical Psychology"]
 */
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module";
import { CERTIFICATE_PDF_PORT, type CertificatePdfPort } from "../src/modules/certificates/providers/pdf/certificate-pdf-port.interface";
import { MAIL_PROVIDER, type MailProvider } from "../src/modules/notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml } from "../src/modules/notifications/dispatch/email-layout";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  const value = i > -1 ? process.argv[i + 1] : undefined;
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required ${flag}`);
  }
  return value;
}

/** Deliberately not a plausible serial — see the file header. */
const SPECIMEN_ID = "SPECIMEN-NOT-A-REAL-CERTIFICATE";

async function main(): Promise<void> {
  const to = arg("--to");
  const holderName = arg("--name");
  const programName = arg("--program", "Clinical Psychology");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const pdfPort = app.get<CertificatePdfPort>(CERTIFICATE_PDF_PORT);
    const mail = app.get<MailProvider>(MAIL_PROVIDER);

    // Both approved artworks, so the reviewer can compare them side by side rather than
    // approving one and discovering the other drifted.
    const kinds = ["internship", "training"] as const;
    const attachments = [];
    for (const kind of kinds) {
      const pdf = await pdfPort.render({
        design: { certificateKind: kind },
        fieldDescriptors: [],
        fields: {
          holderName,
          programName,
          issuedAt: new Date(),
          certUid: SPECIMEN_ID,
          serial: "SPECIMEN",
          verifyUrl: `https://www.stimuliiq.com/verify/${SPECIMEN_ID}`,
        },
      });
      attachments.push({
        filename: `SPECIMEN-${kind}-certificate-${holderName.replace(/\s+/g, "-")}.pdf`,
        content: Buffer.from(pdf.bytes),
        contentType: pdf.contentType,
      });
      console.log(`[render] ${kind}: ${(pdf.bytes.byteLength / 1024).toFixed(0)} KB`);
    }

    const result = await mail.send({
      to,
      subject: `Certificate specimen for ${holderName} — for review, not a real award`,
      html: renderBrandedEmail({
        title: "Certificate specimen",
        greeting: `Hi,`,
        paragraphs: [
          `Attached are both approved certificate designs, rendered with the name ` +
            `<strong>${escapeEmailHtml(holderName)}</strong> so the layout can be checked with a real name in it.`,
          `These are SPECIMENS. Nothing has been issued, no serial has been used, and the ` +
            `certificate ID on them reads "${SPECIMEN_ID}", so they will not pass verification.`,
        ],
        details: [
          { label: "Holder name", value: escapeEmailHtml(holderName) },
          { label: "Programme", value: escapeEmailHtml(programName) },
          { label: "Certificate ID", value: SPECIMEN_ID },
        ],
        footnote:
          "Rendered by the same code that issues real certificates, on the approved artwork, " +
          "so what you see here is what a student receives apart from the values above.",
      }),
      attachments,
      tags: [{ name: "category", value: "certificate_specimen" }],
    });

    console.log(`[sent] to=${to} providerMessageId=${result.providerMessageId ?? "(none)"}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("[send-sample-certificate] FAILED:", err);
  process.exit(1);
});
