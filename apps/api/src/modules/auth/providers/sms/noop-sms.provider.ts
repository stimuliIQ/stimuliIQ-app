// apps/api/src/modules/auth/providers/sms/noop-sms.provider.ts
//
// Test / sandbox double for SmsProvider (docs/plans/phase-9-completion.md T16 / B3).
// Used in unit tests, integration tests, and local dev environments where no real
// MSG91 credentials are present or desired. Selected automatically when
// SMS_PROVIDER=noop (the default) or when no SMS_PROVIDER env var is set.
//
// SECURITY: this class NEVER logs the OTP code or the full message body — even in
// the no-op/dev path. It logs only that a send WOULD have happened, with the phone
// number masked. This mirrors the "STOP logging the OTP code in plaintext" DoD for
// T16 — the previous Phase-0 stub (msg91-sms.provider.ts) logged the raw code, which
// this class deliberately does not replicate.
//
// This class is NEVER bound in production — SmsProviderModule binds the real
// Msg91SmsProvider when SMS_PROVIDER=msg91 (and fails closed if that selector is
// missing credentials in production).

import { Injectable, Logger } from "@nestjs/common";
import type { SendOtpParams, SendSmsParams, SendSmsResult, SmsProvider } from "./sms-provider.interface";

/** Masks a phone number for safe structured logging: "+919876543210" → "+91***3210". */
function maskPhone(phone: string): string {
  if (phone.length > 7) {
    return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
  }
  return `${phone.slice(0, 2)}***`;
}

@Injectable()
export class NoopSmsProvider implements SmsProvider {
  private readonly logger = new Logger(NoopSmsProvider.name);

  constructor() {
    this.logger.warn(
      "[NoopSmsProvider] Running with the no-op/test SMS provider. No real SMS is sent " +
        "and OTP codes are NEVER logged. Do NOT use this in production. Set " +
        "SMS_PROVIDER=msg91 with real credentials for production/staging.",
    );
  }

  async sendOtp({ phone }: SendOtpParams): Promise<{ delivered: boolean }> {
    // SECURITY: the `code` param is intentionally NOT destructured/logged here.
    this.logger.debug(`[NoopSmsProvider] sendOtp: to=${maskPhone(phone)} (no real SMS sent)`);
    return { delivered: false };
  }

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    this.logger.debug(
      `[NoopSmsProvider] sendSms: to=${maskPhone(params.phone)} ` +
        `dltTemplateId="${params.dltTemplateId}" (no real SMS sent, body not logged)`,
    );
    const providerMessageId = `noop-msg91-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return { providerMessageId, delivered: false };
  }
}
