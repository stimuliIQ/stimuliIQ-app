// apps/api/src/modules/notifications/dispatch/template-registry.ts
//
// Channel-agnostic template registry.
// (docs/plans/phase-6.md task #4; docs/specs/phase-6-engagement.md AC-6, LOCK-D4, Rule C-3)
//
// PURPOSE:
//   Render a NotificationType (or campaign template) + a typed payload → per-channel
//   { subject, body } for each delivery channel.
//
//   The registry:
//     1. Stores per-type, per-channel templates as static config.
//     2. Interpolates {{variable}} placeholders from the typed payload.
//     3. Surfaces DLT template ID passthrough for SMS/WhatsApp:
//          - Each SMS/WhatsApp template definition carries a `dltTemplateId` field.
//          - The rendered result includes dltTemplateId for the dispatcher to pass through.
//          - If a SMS/WhatsApp template has no dltTemplateId, render() returns
//            { missingDlt: true } on the per-channel result — the caller MUST reject the send
//            (Rule C-3, AC-31, AC-78).
//     4. Does NOT call any providers — pure rendering, no side effects.
//
// TEMPLATES:
//   Templates for all P6 NotificationTypes, all channels (in_app/email/sms/whatsapp):
//     grade_ready, certificate_ready, live_reminder, forum_reply, announcement,
//     lead_confirmation, booking_confirmation, payment_receipt, welcome.
//
// VARIABLE INTERPOLATION:
//   Template bodies use {{variableName}} placeholders (double-brace mustache-like syntax).
//   renderTemplate() replaces all {{key}} with payload[key].toString() values.
//   Unknown placeholders → left as-is (safe fallback; logged as warning).
//
// SECURITY:
//   - Templates are SERVER-SIDE ONLY. No template is sent to the client.
//   - Payloads are validated before rendering (caller responsibility).
//   - No secrets (API keys, signing keys) appear in any template or rendered output.
//   - WhatsApp template names are safe metadata (not secrets).
//
// USAGE by #6 (NotificationService):
//   import { TemplateRegistry } from './dispatch/template-registry';
//   const registry = new TemplateRegistry();
//   const rendered = registry.render('grade_ready', 'email', payload);
//   // rendered = { subject: "Your assignment has been graded", body: "<html>...", dltTemplateId: undefined }
//
// USAGE by #7 (CampaignService — campaign templates):
//   Campaign templates are stored in the DB (campaign_templates table) and are rendered
//   using TemplateRegistry.renderRaw(templateBody, variables).
//   The campaign_template.dlt_template_id is passed through to the provider directly.
//
// EXPORTS:
//   - TemplateRegistry class (injectable NestJS provider via @Injectable())
//   - RenderedTemplate type
//   - NOTIFICATION_TEMPLATES constant (for direct use in tests)

import { Injectable, Logger } from "@nestjs/common";
import type { NotificationType } from "@repo/types";

import { renderBrandedEmail } from "./email-layout";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The channel-rendered output for a single channel. */
export interface RenderedTemplate {
  /** Email subject or SMS/WhatsApp summary line. Not applicable for in_app. */
  subject?: string;
  /** Rendered body: HTML string for email, plain text for SMS/WhatsApp/in_app. */
  body: string;
  /**
   * DLT template ID (India TRAI compliance, LOCK-D4, Rule C-3).
   * Present when channel is 'sms' or 'whatsapp' and the template has a registered DLT ID.
   * Callers MUST reject the send if this is undefined/null for those channels (AC-78).
   */
  dltTemplateId?: string;
  /**
   * WhatsApp template name (for WhatsApp Cloud API sendTemplate() calls).
   * Only present for whatsapp channel.
   */
  whatsappTemplateName?: string;
  /**
   * WhatsApp template variable values in order (for sendTemplate() variables param).
   * Only present for whatsapp channel when variables are used.
   */
  whatsappVariables?: string[];
  /**
   * True when the channel is SMS or WhatsApp and no DLT template ID is configured.
   * The caller (NotificationService / CampaignService) MUST:
   *   - NOT call the provider.
   *   - Return/log an error (DLT_TEMPLATE_ID_REQUIRED).
   */
  missingDlt?: boolean;
}

/** A per-channel map of rendered templates for a single notification event. */
export type RenderedTemplateMap = Record<"in_app" | "email" | "sms" | "whatsapp", RenderedTemplate>;

/** A single per-channel template definition (before rendering). */
interface TemplateDefinition {
  /** Plain-text summary (shown in notification bell + in-app list). */
  inAppBody: string;
  /** Email subject template. */
  emailSubject: string;
  /** Email HTML body template. */
  emailBody: string;
  /**
   * SMS body template (max ~160 chars per SMS segment).
   * DLT-registered template body — variables must match the DLT approval.
   */
  smsBody: string;
  /**
   * DLT-registered template ID for SMS (India TRAI compliance).
   * PLACEHOLDER: "DLT_PENDING" indicates a real ID must be registered before production.
   * The service layer MUST reject sends where this is "DLT_PENDING" or empty.
   */
  smsDltTemplateId?: string;
  /**
   * WhatsApp template name as registered in Meta Business Manager.
   */
  whatsappTemplateName?: string;
  /**
   * WhatsApp body template.
   * Used to build the template variables list for sendTemplate().
   */
  whatsappBody: string;
  /**
   * DLT-registered template ID for WhatsApp (India TRAI compliance).
   * Same "DLT_PENDING" sentinel as SMS.
   */
  whatsappDltTemplateId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template definitions for all P6 NotificationTypes + all channels
//
// Variables use {{camelCaseName}} syntax and are replaced from the payload.
//
// DLT IDs: All SMS and WhatsApp templates have smsDltTemplateId / whatsappDltTemplateId
// set to "DLT_PENDING" — a sentinel that signals the real ID must be registered with
// India's DLT portal (Jio/BSNL/Airtel/etc.) before production use.
// The template registry surfaces this via missingDlt=true; the service layer
// enforces the rejection (Rule C-3, AC-31, AC-78).
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_NAME = "stimuliIQ";
const SUPPORT_EMAIL = "support@stimuliiq.com";

/**
 * The notification template catalog.
 * Each NotificationType maps to a TemplateDefinition covering all four channels.
 *
 * IMPORTANT FOR PRODUCTION:
 *   Replace all "DLT_PENDING" sentinels with real DLT-registered template IDs
 *   from the DLT portal before enabling SMS/WhatsApp sends in production.
 */
export const NOTIFICATION_TEMPLATES: Record<NotificationType, TemplateDefinition> = {
  // ─── grade_ready ──────────────────────────────────────────────────────────
  grade_ready: {
    inAppBody: "Your assignment '{{assignmentTitle}}' has been graded. Score: {{score}}.",

    emailSubject: "Your assignment has been graded — {{assignmentTitle}}",
    emailBody: renderBrandedEmail({
      title: "Assignment Graded",
      greeting: "Hi {{studentName}},",
      paragraphs: ["Your assignment <strong>{{assignmentTitle}}</strong> has been graded."],
      details: [
        { label: "Assignment", value: "{{assignmentTitle}}" },
        { label: "Score", value: "{{score}}" },
      ],
      button: { label: "View Feedback", url: "{{lmsUrl}}/assignments/{{submissionId}}" },
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Your assignment {{assignmentTitle}} has been graded. Score: {{score}}. View: {{lmsUrl}}`,
    smsDltTemplateId: "DLT_PENDING", // Replace with real DLT ID from portal

    whatsappTemplateName: "grade_ready_notification",
    whatsappBody: "Your assignment *{{assignmentTitle}}* has been graded. Score: *{{score}}*. View your feedback at {{lmsUrl}}",
    whatsappDltTemplateId: "DLT_PENDING", // Replace with real DLT ID from portal
  },

  // ─── certificate_ready ───────────────────────────────────────────────────
  certificate_ready: {
    inAppBody: "Your certificate for '{{programTitle}}' is ready! Download it now.",

    emailSubject: "Your certificate is ready — {{programTitle}}",
    emailBody: renderBrandedEmail({
      title: "Certificate Ready!",
      greeting: "Hi {{studentName}},",
      paragraphs: ["Congratulations! Your certificate of completion for <strong>{{programTitle}}</strong> is ready."],
      button: { label: "Download Certificate", url: "{{lmsUrl}}/certificates/{{certificateId}}" },
      footnote: "Share your achievement on LinkedIn and other platforms.",
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Congratulations! Your certificate for {{programTitle}} is ready. Download: {{lmsUrl}}/certificates/{{certificateId}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "certificate_ready_notification",
    whatsappBody: "Congratulations! Your certificate for *{{programTitle}}* is ready. Download it at {{lmsUrl}}/certificates/{{certificateId}}",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── live_reminder ───────────────────────────────────────────────────────
  // LOCK-4: Live-class feature is deferred; this template is the ready path.
  live_reminder: {
    inAppBody: "Reminder: '{{eventTitle}}' starts at {{startsAt}}. Join now!",

    emailSubject: "Live class starting soon — {{eventTitle}}",
    emailBody: renderBrandedEmail({
      title: "Live Class Reminder",
      greeting: "Hi {{studentName}},",
      paragraphs: ["Your live class <strong>{{eventTitle}}</strong> starts at <strong>{{startsAt}}</strong>."],
      button: { label: "Join Now", url: "{{joinUrl}}" },
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Reminder — {{eventTitle}} starts at {{startsAt}}. Join: {{joinUrl}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "live_reminder_notification",
    whatsappBody: "Reminder: *{{eventTitle}}* starts at {{startsAt}}. Join here: {{joinUrl}}",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── forum_reply ─────────────────────────────────────────────────────────
  forum_reply: {
    inAppBody: "{{authorName}} replied to your thread '{{threadTitle}}'.",

    emailSubject: "New reply on your forum thread — {{threadTitle}}",
    emailBody: renderBrandedEmail({
      title: "New Reply",
      greeting: "Hi {{studentName}},",
      paragraphs: ["<strong>{{authorName}}</strong> replied to your thread <em>{{threadTitle}}</em>."],
      button: { label: "View Reply", url: "{{lmsUrl}}/forum/threads/{{threadId}}" },
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: {{authorName}} replied to your thread "{{threadTitle}}". View: {{lmsUrl}}/forum/threads/{{threadId}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "forum_reply_notification",
    whatsappBody: "{{authorName}} replied to your forum thread *{{threadTitle}}*. View: {{lmsUrl}}/forum/threads/{{threadId}}",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── announcement ────────────────────────────────────────────────────────
  announcement: {
    inAppBody: "{{title}}: {{body}}",

    emailSubject: "Announcement: {{title}}",
    emailBody: renderBrandedEmail({
      title: "{{title}}",
      paragraphs: ["{{body}}"],
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: {{title}} — {{body}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "announcement_notification",
    whatsappBody: "*{{title}}*\n\n{{body}}",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── lead_confirmation ───────────────────────────────────────────────────
  lead_confirmation: {
    inAppBody: "Thank you for your interest in {{programTitle}}! Our team will contact you soon.",

    emailSubject: "We received your inquiry — {{programTitle}}",
    emailBody: renderBrandedEmail({
      title: "Thank You!",
      greeting: "Hi {{name}},",
      paragraphs: [
        "We've received your inquiry about <strong>{{programTitle}}</strong>. Our team will contact you within 24–48 hours.",
      ],
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Hi {{name}}, thank you for your interest in {{programTitle}}. Our team will contact you soon.`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "lead_confirmation_notification",
    whatsappBody: "Hi {{name}}! Thank you for your interest in *{{programTitle}}*. Our team will contact you soon.",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── booking_confirmation ────────────────────────────────────────────────
  booking_confirmation: {
    inAppBody: "Your booking for '{{programTitle}}' on {{slotDate}} is confirmed!",

    emailSubject: "Booking confirmed — {{programTitle}} on {{slotDate}}",
    emailBody: renderBrandedEmail({
      title: "Booking Confirmed!",
      greeting: "Hi {{name}},",
      paragraphs: ["Your slot for <strong>{{programTitle}}</strong> on <strong>{{slotDate}}</strong> is confirmed."],
      details: [
        { label: "Program", value: "{{programTitle}}" },
        { label: "Slot", value: "{{slotDate}}" },
        { label: "Booking reference", value: "{{bookingId}}" },
      ],
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Your slot for {{programTitle}} on {{slotDate}} is confirmed. Ref: {{bookingId}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "booking_confirmation_notification",
    whatsappBody: "Your slot for *{{programTitle}}* on {{slotDate}} is confirmed! Reference: {{bookingId}}",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── payment_receipt ─────────────────────────────────────────────────────
  payment_receipt: {
    inAppBody: "Payment of ₹{{amountRupees}} received for your enrollment. Order: {{orderId}}.",

    emailSubject: "Payment receipt — ₹{{amountRupees}} received",
    emailBody: renderBrandedEmail({
      title: "Payment Received",
      greeting: "Hi {{studentName}},",
      paragraphs: ["We've received your payment of <strong>₹{{amountRupees}}</strong>."],
      details: [
        { label: "Order ID", value: "{{orderId}}" },
        { label: "Invoice", value: "{{invoiceNumber}}" },
        { label: "Amount", value: "₹{{amountRupees}}" },
      ],
      closing: ["You are now enrolled. Head to the LMS to begin your program."],
      button: { label: "Go to LMS", url: "{{lmsUrl}}" },
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Payment of Rs.{{amountRupees}} received. Order: {{orderId}}. You are now enrolled!`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "payment_receipt_notification",
    whatsappBody: "Payment of *₹{{amountRupees}}* received for order {{orderId}}. You are enrolled — visit {{lmsUrl}} to start!",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── welcome ─────────────────────────────────────────────────────────────
  welcome: {
    inAppBody: "Welcome to {{brandName}}, {{userName}}! Your learning journey starts now.",

    emailSubject: "Welcome to stimuliIQ, {{userName}}!",
    emailBody: renderBrandedEmail({
      title: `Welcome to ${BRAND_NAME}!`,
      greeting: "Hi {{userName}},",
      paragraphs: ["Your account is ready. Start learning today!"],
      button: { label: "Go to LMS", url: "{{lmsUrl}}" },
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: Welcome, {{userName}}! Your account is ready. Start learning: {{lmsUrl}}`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "welcome_notification",
    whatsappBody: "Welcome to *${BRAND_NAME}*, {{userName}}! Your account is ready. Visit {{lmsUrl}} to start learning.",
    whatsappDltTemplateId: "DLT_PENDING",
  },

  // ─── lead_assigned (STAFF-facing) ────────────────────────────────────────
  // Every other template in this map is written TO A STUDENT. This one is written to a
  // colleague, so it drops the marketing voice entirely and leads with the two facts the
  // rep needs to act: the name and the phone number.
  //
  // The email/sms/whatsapp bodies exist because renderAll() renders all four channels
  // unconditionally, NOT because they are sent — DEFAULT_PREFS_MATRIX disables email for
  // this type and sms/whatsapp are off for every type by default. They are the fallback
  // wording for a rep who deliberately opts a channel on, so they are written to be
  // correct rather than left as placeholders. `lmsUrl` is deliberately absent: staff live
  // in the CRM, and pointing them at the student portal would be a dead end.
  lead_assigned: {
    inAppBody: "New lead assigned to you: {{leadName}} ({{leadPhone}}) — from {{leadSource}}.",

    emailSubject: "New lead assigned to you: {{leadName}}",
    emailBody: renderBrandedEmail({
      title: "A lead is waiting for you",
      greeting: "Hi,",
      paragraphs: [
        "<strong>{{leadName}}</strong> has been assigned to you by {{assignedByName}}. Open the CRM to log your first call.",
      ],
      details: [
        { label: "Name", value: "{{leadName}}" },
        { label: "Phone", value: "{{leadPhone}}" },
        { label: "Source", value: "{{leadSource}}" },
        { label: "Assigned by", value: "{{assignedByName}}" },
      ],
      unsubscribeUrl: "{{unsubscribeUrl}}",
    }),

    smsBody: `${BRAND_NAME}: New lead assigned to you — {{leadName}}, {{leadPhone}} (source: {{leadSource}}).`,
    smsDltTemplateId: "DLT_PENDING",

    whatsappTemplateName: "lead_assigned_notification",
    whatsappBody: "New lead assigned to you: *{{leadName}}* — {{leadPhone}} (source: {{leadSource}}).",
    whatsappDltTemplateId: "DLT_PENDING",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TemplateRegistry — injectable NestJS provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TemplateRegistry — renders NotificationType → per-channel { subject, body, dltTemplateId }.
 *
 * Injectable as a NestJS provider. Used by:
 *   - NotificationService (#6): render for fan-out per-channel
 *   - CampaignService (#7): renderRaw() for campaign templates stored in DB
 *
 * The registry is stateless (no DI dependencies) — it only processes templates.
 */
@Injectable()
export class TemplateRegistry {
  private readonly logger = new Logger(TemplateRegistry.name);

  /**
   * Render a notification type + payload → single-channel { subject, body, dltTemplateId }.
   *
   * @param type - The NotificationType (e.g. 'grade_ready').
   * @param channel - The target channel ('in_app' | 'email' | 'sms' | 'whatsapp').
   * @param payload - The typed payload from the domain event (e.g. { assignmentTitle, score }).
   * @returns RenderedTemplate with interpolated subject/body + DLT passthrough.
   *
   * CALLERS MUST check `result.missingDlt === true` for sms/whatsapp channels and
   * reject the send with DLT_TEMPLATE_ID_REQUIRED. This is Rule C-3 enforcement.
   */
  render(
    type: NotificationType,
    channel: "in_app" | "email" | "sms" | "whatsapp",
    payload: Record<string, unknown>,
  ): RenderedTemplate {
    const template = NOTIFICATION_TEMPLATES[type];

    if (!template) {
      this.logger.warn(`[TemplateRegistry] Unknown notification type "${type}" — using fallback.`);
      return this.fallbackTemplate(type, channel);
    }

    switch (channel) {
      case "in_app":
        return {
          body: this.interpolate(template.inAppBody, payload),
        };

      case "email":
        return {
          subject: this.interpolate(template.emailSubject, payload),
          body: this.interpolate(template.emailBody, payload),
        };

      case "sms": {
        const body = this.interpolate(template.smsBody, payload);
        const dltTemplateId = template.smsDltTemplateId;
        if (!dltTemplateId || dltTemplateId === "DLT_PENDING") {
          this.logger.warn(
            `[TemplateRegistry] SMS template for "${type}" has no registered DLT template ID ` +
              `(smsDltTemplateId="${dltTemplateId ?? "undefined"}"). ` +
              `Set smsDltTemplateId to the TRAI-registered ID before production. ` +
              `Returning missingDlt=true — the service MUST reject this send.`,
          );
          return { body, missingDlt: true };
        }
        return { body, dltTemplateId };
      }

      case "whatsapp": {
        const body = this.interpolate(template.whatsappBody, payload);
        const dltTemplateId = template.whatsappDltTemplateId;
        const whatsappTemplateName = template.whatsappTemplateName;
        // Build the variables array from the payload for sendTemplate() call.
        const whatsappVariables = this.extractWhatsAppVariables(template.whatsappBody, payload);

        if (!dltTemplateId || dltTemplateId === "DLT_PENDING") {
          this.logger.warn(
            `[TemplateRegistry] WhatsApp template for "${type}" has no registered DLT template ID ` +
              `(whatsappDltTemplateId="${dltTemplateId ?? "undefined"}"). ` +
              `Set whatsappDltTemplateId to the TRAI-registered ID. ` +
              `Returning missingDlt=true — the service MUST reject this send.`,
          );
          return { body, whatsappTemplateName, whatsappVariables, missingDlt: true };
        }
        return { body, dltTemplateId, whatsappTemplateName, whatsappVariables };
      }

      default: {
        const _exhaustive: never = channel;
        this.logger.warn(`[TemplateRegistry] Unknown channel: ${String(_exhaustive)}`);
        return { body: "" };
      }
    }
  }

  /**
   * Render all four channels for a notification type + payload.
   * Returns a map of channel → RenderedTemplate.
   * Useful for NotificationService to render all fan-out channels at once.
   */
  renderAll(
    type: NotificationType,
    payload: Record<string, unknown>,
  ): RenderedTemplateMap {
    return {
      in_app: this.render(type, "in_app", payload),
      email: this.render(type, "email", payload),
      sms: this.render(type, "sms", payload),
      whatsapp: this.render(type, "whatsapp", payload),
    };
  }

  /**
   * Render a raw template string (for campaign templates stored in the DB).
   * Used by CampaignService to render campaign_templates.body with variable substitution.
   *
   * @param templateBody - The template body string with {{var}} placeholders.
   * @param variables - Variable key-value pairs for interpolation.
   * @returns The rendered string.
   */
  renderRaw(templateBody: string, variables: Record<string, unknown>): string {
    return this.interpolate(templateBody, variables);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Replaces {{variableName}} placeholders in the template with values from payload.
   * Unknown placeholders are left as-is and a warning is logged.
   * Values are coerced to string; undefined/null → ''.
   */
  private interpolate(template: string, payload: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      if (!(key in payload)) {
        // Key not present in payload at all → leave placeholder as-is (safe fallback).
        this.logger.debug(`[TemplateRegistry] Unknown placeholder "{{${key}}}" in template — leaving as-is.`);
        return match;
      }
      const value = payload[key];
      if (value === undefined) {
        // Explicitly undefined key → leave as-is (caller should fix the payload).
        this.logger.debug(`[TemplateRegistry] Placeholder "{{${key}}}" is undefined in template — leaving as-is.`);
        return match;
      }
      // null and all other values → coerce to string (null → '').
      return value === null ? "" : String(value);
    });
  }

  /**
   * Extracts ordered variable values from the WhatsApp template body.
   * WhatsApp Cloud API uses positional {{1}}, {{2}} ... OR named {{variableName}} variables.
   * This helper maps named variables to ordered string values for the API call.
   *
   * Returns an array of values in the order they appear in the template.
   */
  private extractWhatsAppVariables(template: string, payload: Record<string, unknown>): string[] {
    const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
    const seen = new Set<string>();
    const vars: string[] = [];
    for (const match of matches) {
      const key = match.slice(2, -2); // strip {{ and }}
      if (!seen.has(key)) {
        seen.add(key);
        const value = payload[key];
        vars.push(value !== undefined && value !== null ? String(value) : "");
      }
    }
    return vars;
  }

  /**
   * Fallback template when a NotificationType has no registered template.
   * Returns a minimal renderable template to avoid crashes.
   */
  private fallbackTemplate(type: string, channel: string): RenderedTemplate {
    const body = `You have a new notification (type: ${type}).`;
    if (channel === "sms" || channel === "whatsapp") {
      return { body, missingDlt: true };
    }
    return { body };
  }
}
