// apps/api/src/modules/auth/providers/sms/msg91-sms.provider.ts
//
// Real MSG91 implementation of `SmsProvider` (docs/plans/phase-9-completion.md T16 / B3,
// docs/04-trd-architecture.md §2.10). Bound to the SMS_PROVIDER DI token when
// SMS_PROVIDER=msg91 (see sms-provider.module.ts). Feature modules NEVER import this
// class directly — they inject SMS_PROVIDER.
//
// ─── OTP SEND STRATEGY ────────────────────────────────────────────────────────
//
//   Our own OtpStore (apps/api/src/modules/auth/lib/otp-store.ts) generates and
//   hashes the OTP code and is the SOLE source of truth for verification — this
//   adapter's job is only to DELIVER that already-generated code via SMS, not to
//   let MSG91 generate or verify its own OTP.
//
//   MSG91's Send OTP API supports an `otp` override parameter for exactly this case
//   ("send your own OTP instead of the system-generated one"):
//
//     POST https://control.msg91.com/api/v5/otp?template_id=<OTP_TEMPLATE_ID>
//            &mobile=<E.164 minus '+'>&otp=<our code>&otp_expiry=<minutes>
//     Headers: { authkey: MSG91_AUTH_KEY }
//     Response: { type: "success" | "error", message: string }
//
// ─── TRANSACTIONAL SMS SEND STRATEGY (sendSms) ────────────────────────────────
//
//   sendSms() receives an ALREADY-RENDERED message body (TemplateRegistry renders
//   server-side — see notifications/dispatch/template-registry.ts) plus a
//   DLT-registered template id (Rule C-3 / AC-78). MSG91's Flow API (api/v5/flow/)
//   expects VARIABLE substitutions against a template, not a pre-rendered string,
//   so this adapter uses MSG91's classic HTTP Send SMS API instead — it accepts a
//   raw `message` string directly alongside a DLT template id passthrough param
//   (`DLT_TE_ID`), which matches our data shape exactly:
//
//     POST https://api.msg91.com/api/sendhttp.php
//            ?authkey=<KEY>&mobiles=<E.164 minus '+'>&message=<urlencoded body>
//            &sender=<MSG91_SENDER>&route=4&country=91&DLT_TE_ID=<dltTemplateId>
//     Response: bare provider request-id string on success (not JSON).
//
//   route=4 is MSG91's transactional route (required for DLT-registered content).
//
//   VERIFY-AT-DEPLOY NOTE: MSG91 periodically updates parameter names/response
//   shapes for this legacy endpoint. When real MSG91_AUTH_KEY/MSG91_SENDER
//   credentials are provisioned, confirm this request shape against the current
//   MSG91 dashboard → API docs before going live (see .env.example for the
//   registration/DLT prerequisites) — the Flow API (api/v5/flow/) is the
//   documented long-term replacement once campaign templates are restructured to
//   named-variable substitution instead of fully-rendered bodies.
//
// ─── SECURITY RULES ───────────────────────────────────────────────────────────
//   - MSG91_AUTH_KEY is read from env at construction. NEVER logged, never
//     returned in any method result, never included in any error message.
//   - The OTP `code` parameter is NEVER logged (T16 DoD: "stop logging the OTP
//     code in plaintext" — the Phase-0 stub violated this; this adapter does not).
//   - The SMS `body` parameter is NEVER logged in full (may carry PII/OTP-adjacent
//     content) — only that a send was attempted, with the phone masked.
//   - All error paths log the phone number MASKED (first 3 + last 4 digits only).
//
// ─── CONSTRUCTOR BEHAVIOUR ────────────────────────────────────────────────────
//   Does NOT throw when keys are absent (lazy validation, ADR-0023 pattern,
//   identical to ResendMailProvider/WhatsAppCloudProvider/RazorpayPaymentProvider).
//   sendOtp() logs an error and returns { delivered: false } when unconfigured —
//   this can only happen outside production, since SmsProviderModule fails closed
//   at boot for SMS_PROVIDER=msg91 with missing credentials in production.
//   sendSms() THROWS when unconfigured or when the DLT template id is missing —
//   mirrors ResendMailProvider.send()/WhatsAppCloudProvider.sendTemplate(), whose
//   callers (SyncNotificationDispatchAdapter/SyncCampaignSendAdapter) already
//   catch provider throws and convert them to a structured `{ error }` result.

import { Injectable, Logger } from "@nestjs/common";
import { validateEnv } from "../../../../config/env";
import type { SendOtpParams, SendSmsParams, SendSmsResult, SmsProvider } from "./sms-provider.interface";

const MSG91_OTP_BASE = "https://control.msg91.com/api/v5/otp";
const MSG91_LEGACY_SMS_BASE = "https://api.msg91.com/api/sendhttp.php";

/** Masks a phone number for safe structured logging: "+919876543210" → "+91***3210". */
function maskPhone(phone: string): string {
  if (phone.length > 7) {
    return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
  }
  return `${phone.slice(0, 2)}***`;
}

/** MSG91 expects mobile numbers WITHOUT a leading '+' (e.g. "919876543210"). */
function toMsg91Mobile(e164Phone: string): string {
  return e164Phone.replace(/^\+/, "");
}

interface Msg91OtpApiResponse {
  type?: "success" | "error";
  message?: string;
}

@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor() {
    // Constructor does NOT throw — lazy validation per ADR-0023. Keys are validated
    // at call time (and enforced at boot in production via SmsProviderModule).
    this.logger.log(
      "[Msg91SmsProvider] Constructed. MSG91_AUTH_KEY/MSG91_SENDER/MSG91_TEMPLATE_ID " +
        "will be validated on first send call (and at boot in production).",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // sendOtp — MSG91 Send OTP API with our own pre-generated code
  // ───────────────────────────────────────────────────────────────────────────

  async sendOtp({ phone, code }: SendOtpParams): Promise<{ delivered: boolean }> {
    const env = validateEnv();
    const maskedPhone = maskPhone(phone);

    if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
      // This can only happen outside production (SmsProviderModule fails closed at
      // boot for SMS_PROVIDER=msg91 with missing creds in production). Fail honestly
      // rather than silently pretending success — SECURITY: `code` is never logged.
      this.logger.error(
        `[Msg91SmsProvider] sendOtp: MSG91_AUTH_KEY/MSG91_TEMPLATE_ID not configured, ` +
          `cannot send OTP to ${maskedPhone}.`,
      );
      return { delivered: false };
    }

    const params = new URLSearchParams({
      template_id: env.MSG91_TEMPLATE_ID,
      mobile: toMsg91Mobile(phone),
      // Override MSG91's auto-generated OTP with OUR code — OtpStore remains the
      // single source of truth for verification (never MSG91's own verify endpoint).
      otp: code,
      otp_expiry: "10",
    });

    try {
      const response = await fetch(`${MSG91_OTP_BASE}?${params.toString()}`, {
        method: "POST",
        headers: { authkey: env.MSG91_AUTH_KEY, "Content-Type": "application/json" },
      });

      if (!response.ok) {
        this.logger.error(`[Msg91SmsProvider] sendOtp failed: to=${maskedPhone} HTTP ${response.status}`);
        return { delivered: false };
      }

      const data = (await response.json()) as Msg91OtpApiResponse;
      const delivered = data.type === "success";
      if (!delivered) {
        // `message` is MSG91's own error description — never contains our OTP code.
        this.logger.error(`[Msg91SmsProvider] sendOtp rejected: to=${maskedPhone} reason="${data.message ?? "unknown"}"`);
      }
      return { delivered };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Msg91SmsProvider] sendOtp network error: to=${maskedPhone} error="${msg}"`);
      return { delivered: false };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // sendSms — MSG91 classic Send SMS API (raw rendered body + DLT template id)
  // ───────────────────────────────────────────────────────────────────────────

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const env = validateEnv();
    const maskedPhone = maskPhone(params.phone);

    if (!env.MSG91_AUTH_KEY || !env.MSG91_SENDER) {
      throw new Error(
        "[Msg91SmsProvider] sendSms: MSG91_AUTH_KEY/MSG91_SENDER not configured. " +
          "Set them with SMS_PROVIDER=msg91 for staging/prod. Use SMS_PROVIDER=noop for local dev.",
      );
    }
    if (!params.dltTemplateId) {
      // Defence-in-depth: the dispatch adapters already reject SMS without a
      // dltTemplateId before calling this method (Rule C-3, AC-78).
      throw new Error(
        "[Msg91SmsProvider] sendSms: dltTemplateId is required (India DLT/TRAI compliance, Rule C-3).",
      );
    }

    const query = new URLSearchParams({
      authkey: env.MSG91_AUTH_KEY,
      mobiles: toMsg91Mobile(params.phone),
      message: params.body,
      sender: env.MSG91_SENDER,
      route: "4", // transactional route (required for DLT-registered content)
      country: "91",
      DLT_TE_ID: params.dltTemplateId,
    });

    let response: Response;
    try {
      response = await fetch(`${MSG91_LEGACY_SMS_BASE}?${query.toString()}`, { method: "POST" });
    } catch (networkErr) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      this.logger.error(`[Msg91SmsProvider] sendSms network error: to=${maskedPhone} error="${msg}"`);
      throw new Error(`[Msg91SmsProvider] Network error calling MSG91 Send SMS API: ${msg}`);
    }

    const responseText = await response.text();

    if (!response.ok) {
      this.logger.error(`[Msg91SmsProvider] sendSms failed: to=${maskedPhone} HTTP ${response.status}`);
      throw new Error(`[Msg91SmsProvider] MSG91 Send SMS API returned HTTP ${response.status}.`);
    }

    // MSG91's legacy endpoint returns a bare provider request-id string on success,
    // or a message containing an error keyword on failure — never structured JSON.
    const looksLikeFailure = /error|invalid|fail/i.test(responseText);
    if (looksLikeFailure) {
      // Log only the first 120 chars — MSG91 error text does not carry our secrets,
      // but we cap it defensively in case of an unexpected echo.
      this.logger.error(
        `[Msg91SmsProvider] sendSms rejected by MSG91: to=${maskedPhone} response="${responseText.slice(0, 120)}"`,
      );
      throw new Error("[Msg91SmsProvider] MSG91 Send SMS API rejected the request.");
    }

    const providerMessageId = responseText.trim() || `msg91-${Date.now()}`;
    return { providerMessageId, delivered: true };
  }
}
