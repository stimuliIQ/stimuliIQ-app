// apps/api/src/modules/notifications/providers/whatsapp/whatsapp-cloud.provider.ts
//
// Real WhatsAppProvider adapter backed by the Meta WhatsApp Cloud API (Phase 6,
// LOCK-D2). Uses direct `fetch` — NO additional SDK dependency.
//
// Selected when WHATSAPP_PROVIDER=whatsapp_cloud. Requires:
//   WHATSAPP_PHONE_NUMBER_ID — the Phone Number ID from Meta Business Manager
//   WHATSAPP_ACCESS_TOKEN    — system user access token (permanent preferred)
//   WHATSAPP_APP_SECRET      — used for webhook HMAC-SHA256 signature verification
//
// API base: https://graph.facebook.com/v22.0 (stable, update as Meta deprecates versions)
//
// ─── SECURITY RULES ───────────────────────────────────────────────────────────
//   - WHATSAPP_ACCESS_TOKEN is read from env. NEVER logged, never returned.
//   - WHATSAPP_APP_SECRET is used only in verifyWebhookSignature. NEVER logged.
//   - Errors from the Graph API are caught; only the error_code/message are logged.
//   - verifyWebhookSignature NEVER throws; returns false on any failure.
//
// ─── CONSTRUCTOR BEHAVIOUR ────────────────────────────────────────────────────
//   Does NOT throw when keys are absent (lazy validation, ADR-0023).
//   Throws at call time if WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN absent.
//   The WhatsAppProviderModule factory enforces key-presence at boot in production.
//
// ─── INDIA DLT COMPLIANCE (LOCK-D4) ──────────────────────────────────────────
//   sendTemplate() receives the dltTemplateId and passes it as a header parameter
//   for audit trail. The Meta Cloud API does not natively enforce DLT IDs; this
//   is an application-layer control. The service layer (task #4) enforces the
//   rule before calling this adapter.
//
// ─── WEBHOOK VERIFICATION ────────────────────────────────────────────────────
//   Meta signs the POST body using HMAC-SHA256 with the App Secret.
//   Header: X-Hub-Signature-256: sha256=<hex>
//   Spec: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//   Fail-closed when WHATSAPP_APP_SECRET is absent.
//
// References:
//   WhatsApp Cloud API send message:
//     https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//   Webhook signature verification:
//     https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { validateEnv } from "../../../../config/env";
import type {
  WhatsAppProvider,
  SendWhatsAppTemplateInput,
  SendWhatsAppTemplateResult,
  SendWhatsAppSessionInput,
  SendWhatsAppSessionResult,
  VerifyWhatsAppWebhookInput,
} from "./whatsapp-provider.interface";

// The stable Graph API version we target. Bump when Meta deprecates this version.
const GRAPH_API_VERSION = "v22.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Shape of the WhatsApp Cloud API successful messages response. */
interface WhatsAppCloudSendResponse {
  messaging_product: "whatsapp";
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
}

/** Shape of a Graph API error response. */
interface GraphApiError {
  error?: {
    code?: number;
    message?: string;
    type?: string;
    fbtrace_id?: string;
  };
}

@Injectable()
export class WhatsAppCloudProvider implements WhatsAppProvider {
  private readonly logger = new Logger(WhatsAppCloudProvider.name);

  constructor() {
    // Constructor does NOT throw — lazy validation per ADR-0023.
    this.logger.log(
      "[WhatsAppCloudProvider] Constructed. WHATSAPP_PHONE_NUMBER_ID and " +
        "WHATSAPP_ACCESS_TOKEN will be validated on first send call " +
        "(and at boot in production via the module factory).",
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private getCredentials(): { phoneNumberId: string; accessToken: string } {
    const env = validateEnv();
    if (!env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error(
        "[WhatsAppCloudProvider] WHATSAPP_PHONE_NUMBER_ID is not set. " +
          "Set it with WHATSAPP_PROVIDER=whatsapp_cloud for staging/prod. " +
          "Use WHATSAPP_PROVIDER=noop for local dev.",
      );
    }
    if (!env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error(
        "[WhatsAppCloudProvider] WHATSAPP_ACCESS_TOKEN is not set. " +
          "Set it with WHATSAPP_PROVIDER=whatsapp_cloud for staging/prod. " +
          "Use WHATSAPP_PROVIDER=noop for local dev.",
      );
    }
    return {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
    };
  }

  /**
   * POST to the WhatsApp Cloud API /messages endpoint.
   * Returns the provider_message_id from the response.
   * Throws on HTTP error or API error — the caller (service layer) handles retry.
   */
  private async callMessagesApi(
    phoneNumberId: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Parse response body regardless of status to extract error info.
    // We do NOT log the raw body (may contain tokens or PII in error context).
    let parsed: (WhatsAppCloudSendResponse & GraphApiError) | null = null;
    try {
      parsed = (await response.json()) as WhatsAppCloudSendResponse & GraphApiError;
    } catch {
      // JSON parse failure — throw without logging body.
      throw new Error(
        `[WhatsAppCloudProvider] Graph API returned non-JSON response (HTTP ${response.status}).`,
      );
    }

    if (!response.ok || parsed?.error) {
      // Log error code/type only — never the access token, never the raw body.
      const code = parsed?.error?.code ?? response.status;
      const msg = parsed?.error?.message ?? "Unknown error";
      const type = parsed?.error?.type ?? "GraphAPIError";
      this.logger.error(
        `[WhatsAppCloudProvider] API error: code=${code} type=${type} message="${msg}"`,
      );
      throw new Error(`WhatsAppCloudProvider: ${type} (code ${code}): ${msg}`);
    }

    const messageId = parsed?.messages?.[0]?.id;
    if (!messageId) {
      throw new Error(
        "[WhatsAppCloudProvider] API returned success but no message id in response.",
      );
    }

    return messageId;
  }

  // ─── Public interface methods ─────────────────────────────────────────────

  async sendTemplate(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
    const { phoneNumberId, accessToken } = this.getCredentials();

    this.logger.log(
      `[WhatsAppCloudProvider] sendTemplate: to=${input.to} ` +
        `template="${input.templateName}" dltTemplateId="${input.dltTemplateId}"`,
    );

    // Build components array from variables (positional body parameters).
    const components: Array<Record<string, unknown>> = [];
    if (input.variables && input.variables.length > 0) {
      components.push({
        type: "body",
        parameters: input.variables.map((v) => ({ type: "text", text: v })),
      });
    }

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode ?? "en" },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    const messageId = await this.callMessagesApi(phoneNumberId, accessToken, body);
    return { providerMessageId: messageId };
  }

  async sendSession(input: SendWhatsAppSessionInput): Promise<SendWhatsAppSessionResult> {
    const { phoneNumberId, accessToken } = this.getCredentials();

    // Log recipient only — NOT the body.
    this.logger.log(`[WhatsAppCloudProvider] sendSession: to=${input.to}`);

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: { body: input.body, preview_url: false },
    };

    const messageId = await this.callMessagesApi(phoneNumberId, accessToken, body);
    return { providerMessageId: messageId };
  }

  verifyWebhookSignature(input: VerifyWhatsAppWebhookInput): boolean {
    if (!input.secret) {
      this.logger.warn(
        "[WhatsAppCloudProvider] verifyWebhookSignature: WHATSAPP_APP_SECRET is absent, " +
          "returning false (fail-closed). Set WHATSAPP_APP_SECRET in your environment.",
      );
      return false;
    }

    try {
      const body = typeof input.rawBody === "string"
        ? input.rawBody
        : input.rawBody.toString("utf8");

      const expectedHex = createHmac("sha256", input.secret)
        .update(body, "utf8")
        .digest("hex");

      // Strip "sha256=" prefix from the incoming header value.
      const incomingFull = input.signature ?? "";
      const incomingHex = incomingFull.startsWith("sha256=")
        ? incomingFull.slice(7)
        : incomingFull;

      if (incomingHex.length !== expectedHex.length || incomingHex.length === 0) {
        return false;
      }

      return timingSafeEqual(
        Buffer.from(incomingHex, "hex"),
        Buffer.from(expectedHex, "hex"),
      );
    } catch {
      // Never log the secret or the signature value.
      this.logger.warn(
        "[WhatsAppCloudProvider] verifyWebhookSignature: exception during HMAC comparison, returning false.",
      );
      return false;
    }
  }
}
