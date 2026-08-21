// Campaign contracts — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Covers WS-2 (Campaigns):
//   - CampaignTemplateDto          — per-channel campaign template (incl. dlt_template_id for SMS/WA)
//   - CreateCampaignTemplateDtoSchema — POST /campaigns/templates input
//   - UpdateCampaignTemplateDtoSchema — PATCH /campaigns/templates/:id input
//   - SegmentDefDto                — audience filter definition (leads + students filters)
//   - CampaignDto                  — campaign summary (list view)
//   - CampaignDetailDto            — campaign detail (author view)
//   - CreateCampaignDtoSchema      — POST /campaigns input
//   - UpdateCampaignDtoSchema      — PATCH /campaigns/:id input
//   - CampaignRecipientDto         — per-recipient delivery status row
//   - CampaignMetricsDto           — aggregate send/deliver/read/fail metrics
//   - UnsubscribeTokenPayload       — internal (server-side only; NOT a response DTO)
//
// Architecture decisions (LOCKED per docs/specs/phase-6-engagement.md):
//   LOCK-D4: India DLT/DPDP — dlt_template_id is REQUIRED on sms/whatsapp templates.
//            The zod schema encodes this as a discriminated type (channel-conditional required).
//   LOCK-D1: Dispatch = sync-seam. Campaign send is behind CampaignSendPort DI token.
//
// Security assertions at the bottom:
//   - CampaignTemplateDto MUST NOT carry the actual dlt_template_id in a way that
//     could be used to reverse-engineer India DLT credentials. The template ID is
//     DATA (the approved ID issued by TRAI/DLT platform), not a secret — so it IS
//     safe to include in the DTO. However, provider API keys (whatsappAccessToken,
//     resendApiKey, msgAuthKey) MUST NEVER appear in any campaign response DTO.
//   - CampaignRecipientDto MUST NOT carry raw suppression-list internals or provider
//     secrets. It may carry recipient `to` (email/phone) for display in the CRM UI
//     but MUST NOT carry API keys, signing secrets, or webhook secrets.
//   - The public UnsubscribeDto (used by both the notification and campaign unsubscribe
//     paths) is defined in notifications.schemas.ts. This file focuses on CRM-facing DTOs.
//
// All schemas are .strict() — global ZodValidationPipe strips extras (CLAUDE.md §3.2).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma CampaignChannel, CampaignStatus, RecipientStatus)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Delivery channel for a campaign. `in_app` is NOT a campaign channel —
 * campaigns go to external channels only. Matches Prisma `CampaignChannel`.
 */
export const CampaignChannelSchema = z.enum(["email", "whatsapp", "sms"]);
export type CampaignChannel = z.infer<typeof CampaignChannelSchema>;

/**
 * Lifecycle status for a bulk campaign. Matches Prisma `CampaignStatus`.
 *   draft      → being authored, not sent
 *   scheduled  → will send at schedule_at
 *   sending    → actively dispatching to recipients
 *   sent       → all recipients processed (success or failed)
 *   paused     → paused mid-send (AC-35); resumable
 *   cancelled  → cancelled (AC-36); queued recipients set to failed
 *   failed     → fatal dispatch failure
 */
export const CampaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "sent",
  "paused",
  "cancelled",
  "failed",
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

/**
 * Per-recipient delivery state within a campaign. Matches Prisma `RecipientStatus`.
 *   queued    → row created, not yet dispatched
 *   sent      → provider accepted the message
 *   delivered → provider confirmed delivery (via webhook, AC-37)
 *   read      → provider confirmed read receipt (AC-37, WhatsApp/email open)
 *   failed    → send failed (includes suppressed: error='suppressed', AC-30)
 */
export const RecipientStatusSchema = z.enum(["queued", "sent", "delivered", "read", "failed"]);
export type RecipientStatus = z.infer<typeof RecipientStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CampaignTemplateDto — reusable per-channel campaign template
//
// India DLT gating (LOCK-D4, AC-78):
//   - For channel = 'sms' or 'whatsapp': dlt_template_id is REQUIRED (non-empty).
//   - For channel = 'email': dlt_template_id is NOT required (null allowed, AC-32).
//
// This requirement is encoded as a zod discriminated-union so the frontend
// and backend both get the same validation rule without a runtime branch.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The variables a campaign send actually substitutes — the single source of truth for both
 * the sender (CampaignsService#dispatchSingleRecipient builds exactly these) and the CRM's
 * template editor, which lists them and warns about anything else.
 *
 * That pairing is the point. Before this list existed the two had drifted completely: the
 * seeded templates wrote `{{name}}`, `{{program_title}}`, `{{deadline}}` and `{{cta_url}}`,
 * the sender substituted only `to` and `campaignName`, and unknown placeholders are left
 * as-is by design — so campaigns went out to students reading "Hi {{name}}," literally.
 * Anything added here MUST be populated in the dispatch path, and vice versa.
 *
 * `description` is what the editor shows staff; keep it in their words, not the schema's.
 */
export const CAMPAIGN_TEMPLATE_VARIABLES = [
  { key: "name", description: "The recipient's name" },
  { key: "to", description: "Their email address or phone number" },
  { key: "program_title", description: "The programme they're enrolled in or enquired about" },
  { key: "campaign_name", description: "The name of this campaign" },
] as const satisfies ReadonlyArray<{ key: string; description: string }>;

/** Just the keys — for validation and for building the substitution map. */
export const CAMPAIGN_TEMPLATE_VARIABLE_KEYS: readonly string[] = CAMPAIGN_TEMPLATE_VARIABLES.map(
  (variable) => variable.key,
);

/**
 * Placeholders in `body`/`subject` that the sender will NOT replace, so the message would
 * go out with the braces showing. Shared so the CRM can warn while someone is still typing
 * rather than after a campaign has been sent.
 */
export function findUnknownTemplateVariables(text: string): string[] {
  const found = [...text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((match) => match[1]!);
  return [...new Set(found.filter((key) => !CAMPAIGN_TEMPLATE_VARIABLE_KEYS.includes(key)))];
}

/** Shared base fields for all campaign template channels. */
const CampaignTemplateBaseSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  name: z.string().min(1).max(128).describe("Human-readable template name."),
  /** The body of the message. Variable placeholders use {{variable_name}} syntax. */
  body: z.string().min(1).max(4096).describe("Template body. Use {{var}} for variables."),
  /** JSON array of variable names used in the body/subject, e.g. ['firstName', 'programTitle']. */
  variables: z.array(z.string().min(1)).describe("Variable placeholders in the template."),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Email template — dlt_template_id is optional (India DLT does not apply to email). */
export const EmailCampaignTemplateDtoSchema = CampaignTemplateBaseSchema.extend({
  channel: z.literal("email"),
  /** Email subject line. Required for email templates. */
  subject: z.string().min(1).max(256).describe("Email subject line."),
  /** Optional HTML version of the body (rendered by MailProvider). */
  htmlBody: z.string().max(65536).nullable().optional(),
  /** DLT template ID — not required for email campaigns (AC-32). */
  dltTemplateId: z.string().nullable().describe("DLT template ID. Not required for email."),
}).strict();
export type EmailCampaignTemplateDto = z.infer<typeof EmailCampaignTemplateDtoSchema>;

/**
 * WhatsApp/SMS template — dlt_template_id is REQUIRED (non-empty string).
 *
 * LOCK-D4 / AC-78 / Rule C-3: A campaign_templates row with channel='sms' or
 * channel='whatsapp' MUST have a non-empty dlt_template_id. The zod schema
 * enforces this at both the NestJS validation pipe (backend) and the frontend
 * form validation (react-hook-form + zod resolver).
 *
 * The dlt_template_id is the approved template ID issued by the DLT platform
 * (TRAI-registered). It is DATA (not a secret) and is safe to include in
 * response DTOs — it identifies the pre-approved message template.
 */
export const DltCampaignTemplateDtoSchema = CampaignTemplateBaseSchema.extend({
  channel: z.enum(["whatsapp", "sms"]),
  /** DLT-registered template ID — REQUIRED for WhatsApp/SMS (AC-78, LOCK-D4). */
  dltTemplateId: z
    .string()
    .min(1)
    .describe(
      "India DLT-approved template ID (REQUIRED for sms/whatsapp). " +
        "Issued by the TRAI DLT platform. Not a secret. The approved message template identifier.",
    ),
  /** No subject for SMS/WhatsApp. */
  subject: z.null().optional(),
  htmlBody: z.null().optional(),
}).strict();
export type DltCampaignTemplateDto = z.infer<typeof DltCampaignTemplateDtoSchema>;

/**
 * Discriminated union for any campaign template.
 * Use `channel` to narrow to EmailCampaignTemplateDto or DltCampaignTemplateDto.
 */
export const CampaignTemplateDtoSchema = z.discriminatedUnion("channel", [
  EmailCampaignTemplateDtoSchema,
  DltCampaignTemplateDtoSchema.extend({ channel: z.literal("whatsapp") }),
  DltCampaignTemplateDtoSchema.extend({ channel: z.literal("sms") }),
]);
export type CampaignTemplateDto = z.infer<typeof CampaignTemplateDtoSchema>;

/** Input for POST /api/v1/campaigns/templates — create a new campaign template. */
export const CreateCampaignTemplateDtoSchema = z
  .discriminatedUnion("channel", [
    z
      .object({
        channel: z.literal("email"),
        name: z.string().min(1).max(128),
        subject: z.string().min(1).max(256),
        body: z.string().min(1).max(4096),
        htmlBody: z.string().max(65536).nullable().optional(),
        variables: z.array(z.string().min(1)).default([]),
        dltTemplateId: z.string().nullable().optional(),
      })
      .strict(),
    z
      .object({
        channel: z.literal("whatsapp"),
        name: z.string().min(1).max(128),
        body: z.string().min(1).max(4096),
        variables: z.array(z.string().min(1)).default([]),
        /** REQUIRED for whatsapp (AC-78). */
        dltTemplateId: z.string().min(1, "dlt_template_id is required for WhatsApp templates"),
      })
      .strict(),
    z
      .object({
        channel: z.literal("sms"),
        name: z.string().min(1).max(128),
        body: z.string().min(1).max(1024),
        variables: z.array(z.string().min(1)).default([]),
        /** REQUIRED for sms (AC-78). */
        dltTemplateId: z.string().min(1, "dlt_template_id is required for SMS templates"),
      })
      .strict(),
  ]);
export type CreateCampaignTemplateDto = z.infer<typeof CreateCampaignTemplateDtoSchema>;

/** Input for PATCH /api/v1/campaigns/templates/:id — update a campaign template. */
export const UpdateCampaignTemplateDtoSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    subject: z.string().min(1).max(256).optional().describe("Email only. Ignored for sms/whatsapp."),
    body: z.string().min(1).max(4096).optional(),
    htmlBody: z.string().max(65536).nullable().optional(),
    variables: z.array(z.string().min(1)).optional(),
    /**
     * For email: nullable (can be cleared). For sms/whatsapp: must be non-empty.
     * Re-validated by the service against the template's channel (LOCK-D4 defense-in-depth).
     */
    dltTemplateId: z.string().nullable().optional(),
  })
  .strict();
export type UpdateCampaignTemplateDto = z.infer<typeof UpdateCampaignTemplateDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// SegmentDefDto — audience filter definition for campaign recipient build
//
// The segment is materialized server-side into campaign_recipients rows.
// Filters apply over leads + students with AND semantics.
// Non-consented recipients (marketing_opt_in=false/null) are excluded
// regardless of other filters (Rule C-1, AC-29, AC-42).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Audience filter definition for a campaign.
 *
 * Stored as `campaigns.segment` JSON and materialized at send time.
 * The backend service ALWAYS applies:
 *   1. `marketing_opt_in = true` filter (non-bypassable, AC-42).
 *   2. Suppression list exclusion (non-bypassable, AC-30).
 *
 * Source types: 'leads' | 'students' | 'both' — which records to query.
 */
export const SegmentDefDtoSchema = z
  .object({
    /** Which record type to include in the audience. */
    source: z.enum(["leads", "students", "both"]).describe("Audience source type."),
    /**
     * Filter by lead pipeline stage(s). Applies only when source includes 'leads'.
     * Empty array = no stage filter (all stages).
     */
    stages: z
      .array(z.string().min(1))
      .optional()
      .describe("Lead stage filter (e.g. ['new', 'follow_up']). Empty = all stages."),
    /**
     * Filter by program interest (leads) or enrolled program (students).
     * Values are program IDs (UUIDs).
     */
    programIds: z
      .array(UuidSchema)
      .optional()
      .describe("Program filter. Leads interested in or students enrolled in these programs."),
    /** Filter by batch ID (for students). */
    batchIds: z
      .array(UuidSchema)
      .optional()
      .describe("Batch filter. Students enrolled in these batches."),
    /**
     * Filter by enrollment or lead status.
     * For leads: status values from the CRM pipeline.
     * For students: enrollment status ('active', 'completed', etc.).
     */
    statuses: z.array(z.string().min(1)).optional().describe("Status filter values."),
    /**
     * Filter by lead source (e.g. 'website', 'referral', 'campaign').
     * Applies only when source includes 'leads'.
     */
    sources: z.array(z.string().min(1)).optional().describe("Lead source filter."),
    /**
     * Only include records where marketing_opt_in = true.
     * This field is INFORMATIONAL — the service ALWAYS enforces consent
     * regardless of whether this is true or false (AC-42, non-bypassable).
     * Always stored as true; included here so the UI can reflect the consent gate.
     */
    consentRequired: z
      .literal(true)
      .default(true)
      .describe("Always true. The consent gate is non-bypassable (Rule C-1, AC-42)."),
  })
  .strict();
export type SegmentDefDto = z.infer<typeof SegmentDefDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CampaignMetricsDto — aggregate campaign delivery metrics
// ─────────────────────────────────────────────────────────────────────────

/**
 * Aggregate metrics for a campaign. Stored as `campaigns.metrics` JSON.
 * Updated by the webhook handler as provider delivery/read receipts arrive (AC-37).
 *
 * All counts are cumulative (not rates). The frontend derives rates from these.
 */
export const CampaignMetricsDtoSchema = z
  .object({
    /** Total recipients materialized into campaign_recipients. */
    total: z.number().int().min(0),
    /** Recipients in 'queued' state (not yet dispatched). */
    queued: z.number().int().min(0),
    /** Recipients where the provider accepted the send (status='sent'). */
    sent: z.number().int().min(0),
    /** Recipients where the provider confirmed delivery (status='delivered'). */
    delivered: z.number().int().min(0),
    /** Recipients where the provider confirmed read/open (status='read'). */
    read: z.number().int().min(0),
    /** Recipients that failed (status='failed'; includes suppressed + provider errors). */
    failed: z.number().int().min(0),
    /** Recipients explicitly suppressed (subset of failed). error='suppressed'. */
    suppressed: z.number().int().min(0),
  })
  .strict();
export type CampaignMetricsDto = z.infer<typeof CampaignMetricsDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CampaignDto (list summary) and CampaignDetailDto (author/detail view)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Campaign list summary — returned in GET /api/v1/campaigns.
 * Minimal fields for the CRM Marketing campaign list view.
 */
export const CampaignDtoSchema = z
  .object({
    id: UuidSchema,
    name: z.string().min(1),
    channel: CampaignChannelSchema,
    status: CampaignStatusSchema,
    scheduleAt: IsoDateTimeSchema.nullable().describe("Scheduled send time. Null = immediate."),
    metrics: CampaignMetricsDtoSchema,
    createdAt: IsoDateTimeSchema,
    /** Author display name (safe — no email/phone, first+last name only for CRM display). */
    createdByName: z.string().describe("Author's display name (first + last)."),
  })
  .strict();
export type CampaignDto = z.infer<typeof CampaignDtoSchema>;

/**
 * Campaign detail — returned by GET /api/v1/campaigns/:id.
 * Includes the full template and segment definition for the author view.
 *
 * SECURITY: Does NOT include raw provider credentials, webhook secrets,
 * or suppression list contents. Template dltTemplateId is DATA, not a secret.
 */
export const CampaignDetailDtoSchema = CampaignDtoSchema.extend({
  /** Audience segment definition. */
  segment: SegmentDefDtoSchema,
  /** The campaign template at the time of detail view (may differ from send-time snapshot). */
  template: CampaignTemplateDtoSchema,
  /** ISO-8601 datetime when send was initiated. Null if not yet sent. */
  sentAt: IsoDateTimeSchema.nullable(),
  /** ISO-8601 datetime when the campaign was paused. Null if not paused. */
  pausedAt: IsoDateTimeSchema.nullable(),
  /** ISO-8601 datetime when the campaign was cancelled. Null if not cancelled. */
  cancelledAt: IsoDateTimeSchema.nullable(),
}).strict();
export type CampaignDetailDto = z.infer<typeof CampaignDetailDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CreateCampaignDto / UpdateCampaignDto — input DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for POST /api/v1/campaigns — create a new campaign.
 * Permission: campaigns.create (all-scope — Marketing/Admin/Owner).
 * Idempotency-Key header required on POST.
 */
export const CreateCampaignDtoSchema = z
  .object({
    name: z.string().min(1).max(128).describe("Campaign name."),
    channel: CampaignChannelSchema,
    /** FK to campaign_templates.id. The template's channel MUST match this campaign's channel. */
    templateId: UuidSchema.describe("FK to campaign_templates. Must match channel."),
    segment: SegmentDefDtoSchema.describe("Audience filter definition."),
    /**
     * Optional scheduled send time. Null or absent = send immediately on trigger.
     * Must be in the future when provided.
     */
    scheduleAt: IsoDateTimeSchema.nullable().optional().describe("Scheduled send time. Null = immediate."),
  })
  .strict();
export type CreateCampaignDto = z.infer<typeof CreateCampaignDtoSchema>;

/** Input for PATCH /api/v1/campaigns/:id — update a draft campaign. */
export const UpdateCampaignDtoSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    templateId: UuidSchema.optional(),
    segment: SegmentDefDtoSchema.optional(),
    scheduleAt: IsoDateTimeSchema.nullable().optional(),
  })
  .strict();
export type UpdateCampaignDto = z.infer<typeof UpdateCampaignDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CampaignRecipientDto — per-recipient delivery status row
// ─────────────────────────────────────────────────────────────────────────

/**
 * One campaign recipient row — returned in GET /api/v1/campaigns/:id/recipients.
 * Represents the per-recipient delivery state for the CRM metrics view.
 *
 * SECURITY: This DTO may carry the `to` field (email address or phone) for
 * display in the CRM staff interface. However, it MUST NOT carry:
 *   - Provider API keys or webhook secrets.
 *   - Raw suppression-list internal fields.
 *   - Internal provider session IDs beyond providerMessageId (for webhook correlation).
 *
 * `providerMessageId` is included because:
 *   1. It is needed for the CRM delivery tracking display (which message was sent).
 *   2. It is NOT a secret — it is the public message ID returned by the provider.
 * The compile-time assertion below confirms no secret fields slip through.
 */
export const CampaignRecipientDtoSchema = z
  .object({
    id: UuidSchema,
    campaignId: UuidSchema,
    /** Lead ID if the recipient was sourced from the leads table. Null if student. */
    leadId: UuidSchema.nullable(),
    /** Student ID if the recipient was sourced from the students table. Null if lead. */
    studentId: UuidSchema.nullable(),
    /**
     * Resolved delivery address — email or phone number.
     * Shown in the CRM delivery report. Staff-only endpoint (requires campaigns.view).
     */
    to: z.string().describe("Resolved delivery address (email or phone)."),
    status: RecipientStatusSchema,
    /** Provider-assigned message ID for webhook correlation. NOT a secret. */
    providerMessageId: z
      .string()
      .nullable()
      .describe("Provider message ID for webhook correlation. Null until sent."),
    /** Error reason if status='failed'. E.g. 'suppressed', 'bounce', 'provider_error'. */
    error: z.string().nullable().describe("Failure reason. Null unless status='failed'."),
    sentAt: IsoDateTimeSchema.nullable(),
    deliveredAt: IsoDateTimeSchema.nullable(),
    readAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type CampaignRecipientDto = z.infer<typeof CampaignRecipientDtoSchema>;

/** Query params for GET /api/v1/campaigns/:id/recipients (paginated by status). */
export const ListCampaignRecipientsQuerySchema = z
  .object({
    status: RecipientStatusSchema.optional().describe("Filter by recipient status."),
    ...PageQuerySchema.shape,
  })
  .strict();
export type ListCampaignRecipientsQuery = z.infer<typeof ListCampaignRecipientsQuerySchema>;

/** Query params for GET /api/v1/campaigns (list all campaigns for the tenant). */
export const ListCampaignsQuerySchema = z
  .object({
    status: CampaignStatusSchema.optional(),
    channel: CampaignChannelSchema.optional(),
    ...PageQuerySchema.shape,
  })
  .strict();
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>;

/** Query params for GET /api/v1/campaigns/templates */
export const ListCampaignTemplatesQuerySchema = z
  .object({
    channel: CampaignChannelSchema.optional(),
    ...PageQuerySchema.shape,
  })
  .strict();
export type ListCampaignTemplatesQuery = z.infer<typeof ListCampaignTemplatesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Webhook input (POST /campaigns/webhooks/:channel — HMAC-verified, internal)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Inbound webhook payload from a mail/WhatsApp provider.
 * The actual shape varies by provider; the backend normalises it.
 * This DTO represents the NORMALISED shape after HMAC verification.
 *
 * SECURITY (AC-39): The endpoint validates `verifyWebhookSignature(...)` before
 * processing. A forged webhook is rejected with 401. This DTO is the normalised
 * form AFTER verification — never raw provider payload exposed to the client.
 *
 * AC-38 (idempotency): Duplicate webhook → row already in final state → 200 no-op.
 * AC-40 (race): Unknown providerMessageId → 200 discard (not 500).
 */
export const CampaignWebhookEventDtoSchema = z
  .object({
    /** The provider-assigned message ID matching campaign_recipients.provider_message_id. */
    providerMessageId: z.string().min(1),
    /** The delivery event type. */
    event: z.enum(["delivered", "read", "failed", "bounced", "complained"]),
    /** ISO-8601 timestamp when the event occurred at the provider. */
    occurredAt: IsoDateTimeSchema.nullable().optional(),
    /** Optional error detail for 'failed' events. NOT a provider secret. */
    errorDetail: z.string().nullable().optional(),
  })
  .strict();
export type CampaignWebhookEventDto = z.infer<typeof CampaignWebhookEventDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time type assertions — no provider secret in campaign DTOs
//
// Hard requirements (docs/specs/phase-6.md task #2, AC-76):
//   - CampaignTemplateDto: dltTemplateId is DATA (approved ID), not a secret.
//     However, API keys, webhook secrets, and signing secrets must NEVER appear.
//   - CampaignRecipientDto: may carry `to` (email/phone) for CRM display,
//     but no API keys, suppression internals, or provider auth.
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenCampaignField =
  | "apiKey"
  | "webhookSecret"
  | "signingSecret"
  | "resendApiKey"
  | "whatsappAccessToken"
  | "msgAuthKey"
  | "whatsappAppSecret"
  | "mailWebhookSecret"
  | "notificationSigningSecret";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertCampaignDtoNoSecret = AssertNoForbiddenFields<CampaignDto, ForbiddenCampaignField>;
type _AssertCampaignDetailDtoNoSecret = AssertNoForbiddenFields<
  CampaignDetailDto,
  ForbiddenCampaignField
>;
type _AssertRecipientDtoNoSecret = AssertNoForbiddenFields<
  CampaignRecipientDto,
  ForbiddenCampaignField
>;
type _AssertMetricsDtoNoSecret = AssertNoForbiddenFields<
  CampaignMetricsDto,
  ForbiddenCampaignField
>;

const _assertCampaignDto: _AssertCampaignDtoNoSecret = true;
const _assertCampaignDetailDto: _AssertCampaignDetailDtoNoSecret = true;
const _assertRecipientDto: _AssertRecipientDtoNoSecret = true;
const _assertMetricsDto: _AssertMetricsDtoNoSecret = true;

export type {
  _AssertCampaignDtoNoSecret,
  _AssertCampaignDetailDtoNoSecret,
  _AssertRecipientDtoNoSecret,
  _AssertMetricsDtoNoSecret,
};
void _assertCampaignDto;
void _assertCampaignDetailDto;
void _assertRecipientDto;
void _assertMetricsDto;
