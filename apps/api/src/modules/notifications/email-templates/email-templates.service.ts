// Resolve, render, edit and reset the CRM-editable transactional emails.
//
// The contract in one line: the DEFAULT prose lives in EMAIL_TEMPLATE_DEFAULTS, a row in
// `email_templates` overrides it, and every send site for a covered key renders through
// `renderForSend`, so what staff read in the CRM is what students receive.
//
// WHY THE SEND SITES MUST NOT DIVERGE. Before this, the enrolment email was written inline
// in CommerceService and the receipt inside TemplateRegistry, so "what do we send when
// somebody pays?" was answerable only by reading two files. A key listed in the CRM that
// some service still composes by hand is the worst outcome available here — staff would
// carefully edit text that never ships — which is why adding a key without moving its send
// site across is called out as a mistake in email-template-defaults.ts.
import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  EMAIL_TEMPLATE_KEYS,
  findUnknownEmailTemplateVariables,
  type EmailTemplate,
  type EmailTemplateKey,
  type EmailTemplatePreviewResponse,
  type UpdateEmailTemplateRequest,
} from "@repo/types";

import { EmailTemplatesRepository } from "./email-templates.repository";
import { EMAIL_TEMPLATE_DEFAULTS, allowedVariableKeys } from "./email-template-defaults";
import { renderBrandedEmail, escapeEmailHtml } from "../dispatch/email-layout";

/** The parts a send site owns and the editor cannot reach. */
export interface EmailTemplateFixedParts {
  details?: { label: string; value: string }[];
  button?: { label: string; url: string };
}

/** Resolved prose for one key: the override if there is one, otherwise the shipped text. */
interface ResolvedTemplate {
  subject: string;
  heading: string;
  body: string;
  footnote: string | null;
  isCustomised: boolean;
  updatedAt: Date | null;
}

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly repository: EmailTemplatesRepository) {}

  // ── reading ────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<EmailTemplate[]> {
    const rows = await this.repository.findAll(tenantId);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return EMAIL_TEMPLATE_KEYS.map((key) => this.toDto(key, byKey.get(key) ?? null));
  }

  async get(tenantId: string, key: EmailTemplateKey): Promise<EmailTemplate> {
    return this.toDto(key, await this.repository.findByKey(tenantId, key));
  }

  // ── writing ────────────────────────────────────────────────────────────────

  /**
   * Save an override.
   *
   * Placeholders are validated against the key's declared variables, and a save carrying an
   * unknown one is REJECTED rather than accepted and left to fail quietly. The renderer
   * leaves an unresolved `{{studnetName}}` exactly as typed, so the typo would reach a real
   * student as literal braces in an email nobody proofreads twice.
   */
  async update(
    tenantId: string,
    key: EmailTemplateKey,
    body: UpdateEmailTemplateRequest,
  ): Promise<EmailTemplate> {
    const allowed = allowedVariableKeys(key);
    const unknown = findUnknownEmailTemplateVariables(
      [body.subject, body.heading, body.body, body.footnote ?? ""].join("\n"),
      allowed,
    );
    if (unknown.length > 0) {
      throw new UnprocessableEntityException({
        code: "email_templates.unknown_variable",
        title: "Unknown placeholder",
        detail:
          `This email does not provide ${unknown.map((u) => `{{${u}}}`).join(", ")}. ` +
          `Available: ${allowed.map((a) => `{{${a}}}`).join(", ")}.`,
      });
    }

    const footnote = body.footnote?.trim() ? body.footnote.trim() : null;
    await this.repository.upsert(tenantId, key, {
      subject: body.subject,
      heading: body.heading,
      body: body.body,
      footnote,
    });
    return this.get(tenantId, key);
  }

  /** Drop the override; the shipped text takes over again on the next send. */
  async reset(tenantId: string, key: EmailTemplateKey): Promise<{ reset: true }> {
    const row = await this.repository.findByKey(tenantId, key);
    // Already the default. 404 rather than a silent success, so pressing Reset on an
    // unedited template cannot report that it undid something.
    if (!row) {
      throw new NotFoundException({
        code: "email_templates.not_customised",
        title: "Nothing to reset",
        detail: "This email is already using its default text.",
      });
    }
    await this.repository.remove(row.id);
    return { reset: true };
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  /**
   * The email a send site should actually send.
   *
   * `values` are interpolated and HTML-ESCAPED: they carry student-supplied data such as a
   * name. The template prose is NOT escaped — it is written by staff holding
   * `settings.edit`, and escaping it would render a plain apostrophe as `&#39;` in every
   * email the company sends.
   */
  async renderForSend(
    tenantId: string,
    key: EmailTemplateKey,
    values: Record<string, string>,
    fixed: EmailTemplateFixedParts = {},
  ): Promise<{ subject: string; html: string }> {
    const resolved = await this.resolve(tenantId, key);
    return this.compose(resolved, values, fixed);
  }

  /** The same render, with each variable's documented sample value, for the CRM preview. */
  async preview(tenantId: string, key: EmailTemplateKey): Promise<EmailTemplatePreviewResponse> {
    const resolved = await this.resolve(tenantId, key);
    const values = Object.fromEntries(
      EMAIL_TEMPLATE_DEFAULTS[key].variables.map((v) => [v.key, v.sample]),
    );
    return this.compose(resolved, values, this.sampleFixedParts(key));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async resolve(tenantId: string, key: EmailTemplateKey): Promise<ResolvedTemplate> {
    const row = await this.repository.findByKey(tenantId, key);
    const fallback = EMAIL_TEMPLATE_DEFAULTS[key];
    if (!row) {
      return {
        subject: fallback.subject,
        heading: fallback.heading,
        body: fallback.body,
        footnote: fallback.footnote,
        isCustomised: false,
        updatedAt: null,
      };
    }
    return {
      subject: row.subject,
      heading: row.heading,
      body: row.body,
      footnote: row.footnote,
      isCustomised: true,
      updatedAt: row.updatedAt,
    };
  }

  private compose(
    resolved: ResolvedTemplate,
    values: Record<string, string>,
    fixed: EmailTemplateFixedParts,
  ): { subject: string; html: string } {
    const fill = (text: string) => interpolate(text, values);
    return {
      // A subject is plain text in a mail header — interpolated but never HTML-escaped, or a
      // name with an apostrophe would arrive as "Hi Sam&#39;s".
      subject: interpolate(resolved.subject, values, { escape: false }),
      html: renderBrandedEmail({
        title: fill(resolved.heading),
        // A blank line is the paragraph break, which is the only formatting a plain textarea
        // can express. Single newlines become <br/>, so a list of lines stays a list.
        paragraphs: fill(resolved.body)
          .split(/\n\s*\n/)
          .map((p) => p.trim().replace(/\n/g, "<br/>"))
          .filter(Boolean),
        ...(fixed.details ? { details: fixed.details } : {}),
        ...(fixed.button ? { button: fixed.button } : {}),
        ...(resolved.footnote ? { footnote: fill(resolved.footnote) } : {}),
      }),
    };
  }

  /** Stand-ins for the code-owned parts, so a preview reads like the real email. */
  private sampleFixedParts(key: EmailTemplateKey): EmailTemplateFixedParts {
    if (key === "enrollment_welcome") {
      return {
        details: [
          { label: "LMS username", value: "student@example.com" },
          { label: "Temporary password", value: "••••••••" },
        ],
        button: { label: "Sign in to the LMS", url: "#" },
      };
    }
    return { button: { label: "Go to LMS", url: "#" } };
  }

  private toDto(
    key: EmailTemplateKey,
    row: Awaited<ReturnType<EmailTemplatesRepository["findByKey"]>>,
  ): EmailTemplate {
    const fallback = EMAIL_TEMPLATE_DEFAULTS[key];
    return {
      key,
      name: fallback.name,
      description: fallback.description,
      subject: row?.subject ?? fallback.subject,
      heading: row?.heading ?? fallback.heading,
      body: row?.body ?? fallback.body,
      footnote: row ? row.footnote : fallback.footnote,
      variables: fallback.variables,
      fixedPartsNote: fallback.fixedPartsNote,
      isCustomised: Boolean(row),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}

/**
 * Replace `{{key}}` with `values[key]`.
 *
 * An unknown placeholder is LEFT AS-IS rather than blanked, matching TemplateRegistry. A
 * save cannot introduce one (update() rejects it), so the only route here is a variable
 * removed from a key's declaration while an old override still uses it — and visible braces
 * in a preview are how that gets noticed, where a silently empty gap is not.
 */
function interpolate(
  text: string,
  values: Record<string, string>,
  opts: { escape?: boolean } = {},
): string {
  const escape = opts.escape ?? true;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    const value = values[key];
    if (value === undefined) return whole;
    return escape ? escapeEmailHtml(value) : value;
  });
}
