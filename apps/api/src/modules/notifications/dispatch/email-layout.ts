// apps/api/src/modules/notifications/dispatch/email-layout.ts
//
// ONE branded HTML shell for every email the platform sends — transactional
// (receipts, credentials, resets, dunning), notification fan-out (template-
// registry) and campaigns all render through `renderBrandedEmail()` so the
// inbox presence is consistent and trustworthy: logo header on a white card,
// brand accent bar, structured details table, a single primary CTA, muted
// footer. Modeled on the classic SaaS invoice-email layout (logo → title →
// button → details list → footer).
//
// EMAIL-CLIENT CONSTRAINTS (why this file looks like 2009):
//   - Tables + inline styles only — Gmail/Outlook strip <style> blocks and
//     don't support flex/grid reliably.
//   - The logo is hot-linked from the public marketing site (email clients
//     can't embed local assets without attachments); alt text carries the
//     brand name for image-blocking clients.
//   - Content strings are treated as RAW HTML fragments: callers either pass
//     fully-static strings, template placeholders ({{var}} — interpolated
//     later by TemplateRegistry), or values they have escaped themselves
//     (use `escapeEmailHtml` for anything user-controlled).

const BRAND_NAME = "StimuliiQ";
const BRAND_COLOR = "#047857"; // --brand-500 (emerald) from packages/ui tokens
const BRAND_COLOR_DARK = "#035f47"; // --brand-600
const LOGO_URL = "https://www.stimuliiq.com/stimuliiq-logo.png";
const SITE_URL = "https://www.stimuliiq.com";
/** Exported so a body can point at the same address the footer already shows. */
export const SUPPORT_EMAIL = "support@stimuliiq.com";

export interface BrandedEmailOptions {
  /** Bold headline under the logo, e.g. "Payment Received". */
  title: string;
  /** Optional greeting line rendered above the paragraphs, e.g. "Hi {{name}}," */
  greeting?: string;
  /** Body copy — each entry is one paragraph (RAW HTML fragment). */
  paragraphs?: string[];
  /** Primary CTA button. Exactly one per email keeps the action obvious. */
  button?: { label: string; url: string };
  /** Key/value rows rendered as a bordered details list (like an invoice). */
  details?: Array<{ label: string; value: string }>;
  /** Paragraphs rendered AFTER the button/details (closing copy). */
  closing?: string[];
  /** Small muted line above the footer (e.g. security note). */
  footnote?: string;
  /** When set, the footer includes an Unsubscribe link (marketing/fan-out mail). */
  unsubscribeUrl?: string;
}

/** Escape a user-controlled string for safe inclusion in the HTML fragments. */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderParagraphs(paragraphs: string[] | undefined): string {
  if (!paragraphs || paragraphs.length === 0) return "";
  return paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#374151;">${p}</p>`)
    .join("");
}

function renderButton(button: BrandedEmailOptions["button"]): string {
  if (!button) return "";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;">
    <tr>
      <td style="border-radius:6px;background:${BRAND_COLOR};mso-padding-alt:12px 28px;">
        <a href="${button.url}" target="_blank"
           style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;background:${BRAND_COLOR};">
          ${button.label}
        </a>
      </td>
    </tr>
  </table>`;
}

function renderDetails(details: BrandedEmailOptions["details"]): string {
  if (!details || details.length === 0) return "";
  const rows = details
    .map(
      (row, i) => `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${row.label}</td>
        <td style="padding:10px 14px;font-size:13px;color:#111827;font-weight:500;word-break:break-word;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${row.value}</td>
      </tr>`,
    )
    .join("");
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
         style="margin:6px 0 22px;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">
    ${rows}
  </table>`;
}

/**
 * Render the full branded email document. Returns a complete `<!doctype html>`
 * string ready to hand to the MailProvider.
 */
export function renderBrandedEmail(options: BrandedEmailOptions): string {
  const { title, greeting, paragraphs, button, details, closing, footnote, unsubscribeUrl } = options;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;border-collapse:separate;overflow:hidden;">
          <!-- brand accent bar -->
          <tr><td style="height:4px;background:${BRAND_COLOR};font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- logo header -->
          <tr>
            <td style="padding:26px 32px 0;">
              <a href="${SITE_URL}" target="_blank" style="text-decoration:none;">
                <img src="${LOGO_URL}" alt="${BRAND_NAME}" height="30"
                     style="display:block;height:30px;width:auto;border:0;outline:none;"/>
              </a>
            </td>
          </tr>
          <!-- content -->
          <tr>
            <td style="padding:24px 32px 8px;">
              ${title ? `<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#111827;font-weight:700;">${title}</h1>` : ""}
              ${greeting ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#374151;">${greeting}</p>` : ""}
              ${renderParagraphs(paragraphs)}
              ${renderButton(button)}
              ${renderDetails(details)}
              ${renderParagraphs(closing)}
              ${footnote ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#9ca3af;">${footnote}</p>` : ""}
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:18px 32px 24px;">
              <hr style="margin:0 0 16px;border:none;border-top:1px solid #e5e7eb;"/>
              <p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#9ca3af;">
                <strong style="color:#6b7280;">${BRAND_NAME}</strong> — Industry-grade internship training across software, data, cloud, and design.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
                Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR_DARK};text-decoration:none;">${SUPPORT_EMAIL}</a>
                &nbsp;·&nbsp; <a href="${SITE_URL}" style="color:${BRAND_COLOR_DARK};text-decoration:none;">${SITE_URL.replace("https://", "")}</a>${
                  unsubscribeUrl
                    ? `\n                &nbsp;·&nbsp; <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>`
                    : ""
                }
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Wrap an ALREADY-RENDERED HTML fragment (e.g. a campaign body authored in the
 * CRM) in the branded shell — logo header + footer around the author's content.
 */
export function wrapInBrandedShell(bodyHtml: string, opts?: { title?: string; unsubscribeUrl?: string }): string {
  return renderBrandedEmail({
    title: opts?.title ?? "",
    paragraphs: [bodyHtml],
    unsubscribeUrl: opts?.unsubscribeUrl,
  });
}
