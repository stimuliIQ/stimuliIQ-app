// HTTP boundary only (CLAUDE.md §3.3). Mounted at /crm/email-templates*.
//
// PERMISSIONS: `settings.view` / `settings.edit`, reused rather than a new
// `email_templates.*` pair. Two reasons, in order of weight:
//
//   1. A new permission key does nothing until it is seeded on the LIVE database by a
//      standalone script, and until that runs the route 403s for everyone and the nav leaf
//      never renders — a feature that ships broken and looks like a bug. These keys already
//      exist and are already granted.
//   2. The wording of the emails the company sends automatically is company configuration
//      in exactly the sense "View / Edit System Company Settings" describes.
//
// The audience is right too: `settings.edit` sits with the admin roles, and `branch_manager`
// holds only `settings.view` at branch scope, so a branch manager can read what is being
// sent without being able to rewrite what every student receives.
import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { RequirePermission } from "../../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { RequestUser } from "../../auth/lib/request-user";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  EmailTemplateKeySchema,
  UpdateEmailTemplateRequestSchema,
  type EmailTemplate,
  type EmailTemplateKey,
  type EmailTemplatePreviewResponse,
  type ResetEmailTemplateResponse,
  type UpdateEmailTemplateRequest,
} from "@repo/types";

import { EmailTemplatesService } from "./email-templates.service";

@Controller("crm/email-templates")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmailTemplatesController {
  constructor(private readonly service: EmailTemplatesService) {}

  /** Every automatic email this screen governs, default or customised. */
  @Get()
  @RequirePermission("settings.view")
  async list(@CurrentUser() user: RequestUser): Promise<EmailTemplate[]> {
    return this.service.list(user.tenantId);
  }

  @Get(":key")
  @RequirePermission("settings.view")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("key", new ZodValidationPipe(EmailTemplateKeySchema)) key: EmailTemplateKey,
  ): Promise<EmailTemplate> {
    return this.service.get(user.tenantId, key);
  }

  /**
   * The email as a student would receive it, with each variable's sample value.
   *
   * `settings.view`, not `.edit`: the reason this screen exists at all is that nobody could
   * see what was being sent, and reading that should not require the right to change it.
   */
  @Get(":key/preview")
  @RequirePermission("settings.view")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("key", new ZodValidationPipe(EmailTemplateKeySchema)) key: EmailTemplateKey,
  ): Promise<EmailTemplatePreviewResponse> {
    return this.service.preview(user.tenantId, key);
  }

  /** PUT, not PATCH: the editor submits the whole message every time. */
  @Put(":key")
  @RequirePermission("settings.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("key", new ZodValidationPipe(EmailTemplateKeySchema)) key: EmailTemplateKey,
    @Body(new ZodValidationPipe(UpdateEmailTemplateRequestSchema)) body: UpdateEmailTemplateRequest,
  ): Promise<EmailTemplate> {
    return this.service.update(user.tenantId, key, body);
  }

  /** Discard the override and go back to the text the product ships with. */
  @Delete(":key")
  @RequirePermission("settings.edit")
  async reset(
    @CurrentUser() user: RequestUser,
    @Param("key", new ZodValidationPipe(EmailTemplateKeySchema)) key: EmailTemplateKey,
  ): Promise<ResetEmailTemplateResponse> {
    return this.service.reset(user.tenantId, key);
  }
}
