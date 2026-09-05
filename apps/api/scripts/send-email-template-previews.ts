/**
 * Email every automatic template to one address, exactly as a student would receive it.
 *
 * WHY. CRM ▸ Automatic Emails renders a preview in an iframe, which proves the wording but
 * not the thing that actually goes wrong with email: how it survives a real mail client.
 * Gmail rewrites CSS, Outlook re-flows tables, and a phone shows a different width. The only
 * honest check is to receive the message.
 *
 * It sends the SAME render the send sites use — EmailTemplatesService.renderForSend, with
 * each template's declared sample values and the same fixed parts (credentials table, LMS
 * button) the real caller passes. So what arrives is the email, not a mock of it.
 *
 * NOTHING IS ISSUED OR RECORDED. No enrolment, no payment, no notification row. The subject
 * of each message is prefixed so a recipient cannot mistake a preview for the real thing
 * arriving out of nowhere.
 *
 * USAGE (from apps/api):
 *   node -r ts-node/register -r tsconfig-paths/register scripts/send-email-template-previews.ts \
 *     --to someone@example.com [--name "Gandi Phanendra"]
 */
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module";
import { EmailTemplatesService } from "../src/modules/notifications/email-templates/email-templates.service";
import { EMAIL_TEMPLATE_DEFAULTS } from "../src/modules/notifications/email-templates/email-template-defaults";
import { MAIL_PROVIDER, type MailProvider } from "../src/modules/notifications/providers/mail/mail-provider.interface";
import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "@repo/types";
import { validateEnv } from "../src/config/env";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  const value = i > -1 ? process.argv[i + 1] : undefined;
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required ${flag}`);
  }
  return value;
}

/**
 * The parts the SEND SITE owns, mirrored here per key.
 *
 * Deliberately duplicated from the real callers rather than imported: if these drift, the
 * preview stops matching what students receive, and that is exactly the failure this script
 * exists to catch. Kept side by side with the real values so a reviewer can see them.
 */
function fixedPartsFor(key: EmailTemplateKey, env: ReturnType<typeof validateEnv>) {
  if (key === "enrollment_welcome") {
    return {
      details: [
        { label: "LMS username", value: "student@example.com" },
        { label: "Temporary password", value: "Tmp-8fK2xQ" },
      ],
      button: { label: "Sign in to the LMS", url: `${env.LMS_APP_URL}/login` },
    };
  }
  return { button: { label: "Go to LMS", url: env.LMS_APP_URL } };
}

async function main(): Promise<void> {
  const to = arg("--to");
  const holderName = arg("--name", "Gandi Phanendra");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const templates = app.get(EmailTemplatesService);
    const mail = app.get<MailProvider>(MAIL_PROVIDER);
    const env = validateEnv();
    // The tenant only decides whether an OVERRIDE exists; with none saved this renders the
    // shipped defaults, which is what production currently sends.
    const tenantId = arg("--tenant", "00000000-0000-0000-0000-000000000000");

    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = EMAIL_TEMPLATE_DEFAULTS[key];
      const values = Object.fromEntries(
        def.variables.map((v) => [v.key, v.key === "studentName" ? holderName : v.sample]),
      );
      const { subject, html } = await templates.renderForSend(
        tenantId,
        key,
        values,
        fixedPartsFor(key, env),
      );

      await mail.send({
        to,
        subject: `[PREVIEW] ${subject}`,
        html,
        tags: [{ name: "category", value: "email_template_preview" }],
      });
      console.log(`[sent] ${key.padEnd(20)} subject="${subject}"`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("[send-email-template-previews] FAILED:", err);
  process.exit(1);
});
