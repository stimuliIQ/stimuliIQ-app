// Typed CRM SDK for the editable transactional emails.
//
// Namespace: client.crm.emailTemplates.*
//
// These are the emails the system sends by itself when something happens (a payment lands,
// a student is enrolled). The DEFAULT wording ships in the API; a save stores an override
// and `reset` removes it, so "reset" restores the shipped text rather than a stored copy of
// it — which is why it is a DELETE and returns `{ reset: true }` instead of a template.

import type {
  EmailTemplate,
  EmailTemplateKey,
  EmailTemplatePreviewResponse,
  ResetEmailTemplateResponse,
  UpdateEmailTemplateRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class EmailTemplatesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/email-templates — permission: settings.view */
  async list(): Promise<EmailTemplate[]> {
    return this.client.request<EmailTemplate[]>("GET", "/api/v1/crm/email-templates");
  }

  /** GET /api/v1/crm/email-templates/:key — permission: settings.view */
  async get(key: EmailTemplateKey): Promise<EmailTemplate> {
    return this.client.request<EmailTemplate>("GET", `/api/v1/crm/email-templates/${key}`);
  }

  /**
   * GET /api/v1/crm/email-templates/:key/preview — permission: settings.view
   *
   * The email as a student receives it, with each variable's sample value filled in.
   * `settings.view` and not `.edit`: reading what is being sent should not require the
   * right to change it.
   */
  async preview(key: EmailTemplateKey): Promise<EmailTemplatePreviewResponse> {
    return this.client.request<EmailTemplatePreviewResponse>(
      "GET",
      `/api/v1/crm/email-templates/${key}/preview`,
    );
  }

  /**
   * PUT /api/v1/crm/email-templates/:key — permission: settings.edit
   *
   * Sends the whole message every time. Rejects 422 `email_templates.unknown_variable` if
   * the text uses a `{{placeholder}}` this email does not supply — the renderer would leave
   * the braces in place and a real student would read them.
   */
  async update(
    key: EmailTemplateKey,
    body: UpdateEmailTemplateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<EmailTemplate> {
    return this.client.request<EmailTemplate>("PUT", `/api/v1/crm/email-templates/${key}`, {
      body,
      idempotencyKey,
    });
  }

  /**
   * DELETE /api/v1/crm/email-templates/:key — permission: settings.edit
   *
   * Discards the override. 404 `email_templates.not_customised` when the template is
   * already the default, so the button cannot claim to have undone nothing.
   */
  async reset(key: EmailTemplateKey): Promise<ResetEmailTemplateResponse> {
    return this.client.request<ResetEmailTemplateResponse>(
      "DELETE",
      `/api/v1/crm/email-templates/${key}`,
    );
  }
}
