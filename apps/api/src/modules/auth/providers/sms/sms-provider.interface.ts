// apps/api/src/modules/auth/providers/sms/sms-provider.interface.ts
//
// Vendor-swappable SMS interface (CLAUDE.md §3.7: "all external calls go through a
// provider interface — never call a vendor SDK directly from a feature module").
// AuthService depends ONLY on this interface, injected via the SMS_PROVIDER DI token.
// The default Phase-0 implementation (msg91-sms.provider.ts) is a STUB — it logs the
// OTP instead of calling MSG91 (docs/plans/phase-0.md: "OTP send is stubbed"). Swapping
// to a real MSG91/Twilio integration later means adding a new class implementing this
// interface and rebinding the DI token — zero changes to AuthService.
//
// Phase-6 extension (docs/plans/phase-6.md §2, docs/specs/phase-6-engagement.md
// LOCK-D4 / Rule C-3 / AC-78):
//   Added `sendSms()` for notification fan-out and campaign sends.
//   Parameterized with `dltTemplateId` — REQUIRED for India DLT/TRAI compliance.
//   OTP sends are unchanged (sendOtp still exists and is unaffected).

export interface SendOtpParams {
  phone: string;
  code: string;
}

/**
 * Parameters for a transactional or campaign SMS send.
 *
 * India DLT compliance (Phase 6, LOCK-D4, AC-78, Rule C-3):
 *   dltTemplateId is REQUIRED. Every commercial / transactional SMS in India
 *   must carry the DLT-registered template ID assigned by the operator portal
 *   (Jio DLT, BSNL DLT, Airtel DLT, etc.). The service layer enforces this
 *   before calling the adapter. The adapter passes it to MSG91 as the `template_id`
 *   field in the send payload.
 */
export interface SendSmsParams {
  /** Recipient phone number in E.164 format (e.g. "+919876543210"). */
  phone: string;
  /**
   * Rendered message body to send. Must match the approved DLT template body
   * (variables substituted) — the provider enforces this at the network level.
   * Max 160 chars for a single SMS unit; longer messages may be split by the provider.
   */
  body: string;
  /**
   * India DLT-registered template identifier (REQUIRED — LOCK-D4, AC-78).
   * This is the numeric template ID from the DLT portal, e.g. "1207162xxxxxxxxxx".
   * The service layer rejects sends where this is absent or empty.
   */
  dltTemplateId: string;
}

/** Result returned by SmsProvider.sendSms(). */
export interface SendSmsResult {
  /**
   * Provider-assigned message ID for this SMS.
   * Stored in campaign_recipients.provider_message_id for delivery tracking.
   * NEVER contains credentials, auth keys, or secrets.
   */
  providerMessageId: string;
  /** Whether the provider accepted the message (false for stubs/Noop). */
  delivered: boolean;
}

export interface SmsProvider {
  /** Sends (or, for the stub, logs) a 6-digit OTP to `phone`. Resolves `delivered: false` for stubs. */
  sendOtp(params: SendOtpParams): Promise<{ delivered: boolean }>;

  /**
   * Sends a transactional or campaign SMS via the configured provider.
   * Requires a DLT-registered template ID for India compliance (Rule C-3).
   *
   * The stub implementation (Msg91SmsProvider) logs the params and returns
   * `{ providerMessageId: 'stub-...', delivered: false }` — no real MSG91 call.
   * When real MSG91 credentials land, replace the stub body with the HTTP call.
   */
  sendSms(params: SendSmsParams): Promise<SendSmsResult>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
