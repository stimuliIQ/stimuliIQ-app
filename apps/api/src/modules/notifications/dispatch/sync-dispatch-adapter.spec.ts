// apps/api/src/modules/notifications/dispatch/sync-dispatch-adapter.spec.ts
//
// Unit tests for SyncNotificationDispatchAdapter + SyncCampaignSendAdapter.
// (docs/plans/phase-6.md task #4; AC-27, LOCK-D1, LOCK-D4, Rule C-3)
//
// Covers:
//   - SyncNotificationDispatchAdapter idempotency (same dedupeKey → single dispatch, replay = no-op)
//   - SyncCampaignSendAdapter idempotency (same dedupeKey → no second provider call)
//   - DLT gate: SMS/WhatsApp sends without dltTemplateId rejected (Rule C-3, AC-78)
//   - DLT gate present but set: SMS/WhatsApp calls proceed
//   - All channels route to correct providers (email→mail, sms→sms, whatsapp→whatsapp)
//   - in_app channel returns dispatched=true without calling external providers
//   - Missing recipient (no toEmail / no toPhone) returns error
//   - Provider errors are caught and returned as error strings (no throw to caller)
//   - No provider secret in any returned result (AC-76)
//   - SyncCampaignSendAdapter.throttle() is a no-op

import { SyncNotificationDispatchAdapter } from "./sync-notification-dispatch.adapter";
import { SyncCampaignSendAdapter } from "./sync-campaign-send.adapter";
import type { ChannelSendJob } from "./notification-dispatch.port";
import type { RecipientSendJob } from "./campaign-send.port";
import type { MailProvider } from "../providers/mail/mail-provider.interface";
import type { WhatsAppProvider } from "../providers/whatsapp/whatsapp-provider.interface";
import type { SmsProvider } from "../../auth/providers/sms/sms-provider.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Mock providers (no network calls)
// ─────────────────────────────────────────────────────────────────────────────

function makeMockMail(): jest.Mocked<MailProvider> {
  return {
    send: jest.fn().mockResolvedValue({ providerMessageId: "mail-msg-001" }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };
}

function makeMockWhatsApp(): jest.Mocked<WhatsAppProvider> {
  return {
    sendTemplate: jest.fn().mockResolvedValue({ providerMessageId: "wa-msg-001" }),
    sendSession: jest.fn().mockResolvedValue({ providerMessageId: "wa-session-001" }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };
}

function makeMockSms(): jest.Mocked<SmsProvider> {
  return {
    sendOtp: jest.fn().mockResolvedValue({ delivered: false }),
    sendSms: jest.fn().mockResolvedValue({ providerMessageId: "sms-msg-001", delivered: true }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SyncNotificationDispatchAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe("SyncNotificationDispatchAdapter", () => {
  let mail: jest.Mocked<MailProvider>;
  let whatsapp: jest.Mocked<WhatsAppProvider>;
  let sms: jest.Mocked<SmsProvider>;
  let adapter: SyncNotificationDispatchAdapter;

  beforeEach(() => {
    mail = makeMockMail();
    whatsapp = makeMockWhatsApp();
    sms = makeMockSms();
    // Directly construct to bypass DI in unit tests
    adapter = new SyncNotificationDispatchAdapter(mail, whatsapp, sms);
  });

  // ─── Idempotency (same dedupeKey = no double-dispatch) ────────────────────

  describe("idempotency by dedupeKey", () => {
    it("first dispatch proceeds — dispatched=true", async () => {
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-001:email",
        toEmail: "student@example.com",
        subject: "Test subject",
        body: "<p>Test body</p>",
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(true);
      expect(result.skipped).toBe(false);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it("second dispatch with same dedupeKey → skipped=true, no second provider call", async () => {
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-001:email",
        toEmail: "student@example.com",
        subject: "Test subject",
        body: "<p>Test body</p>",
      };
      await adapter.dispatch(job);
      const second = await adapter.dispatch(job);

      expect(second.dispatched).toBe(false);
      expect(second.skipped).toBe(true);
      // Provider called exactly once (first call only)
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it("different dedupeKeys → both dispatched", async () => {
      const job1: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-001:email",
        toEmail: "s1@example.com",
        subject: "S1",
        body: "body1",
      };
      const job2: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-002:email",
        toEmail: "s2@example.com",
        subject: "S2",
        body: "body2",
      };
      const r1 = await adapter.dispatch(job1);
      const r2 = await adapter.dispatch(job2);

      expect(r1.dispatched).toBe(true);
      expect(r2.dispatched).toBe(true);
      expect(mail.send).toHaveBeenCalledTimes(2);
    });
  });

  // ─── in_app channel ────────────────────────────────────────────────────────

  describe("in_app channel", () => {
    it("returns dispatched=true without calling any external provider", async () => {
      const job: ChannelSendJob = {
        channel: "in_app",
        dedupeKey: "notif-003:in_app",
        userId: "user-001",
        tenantId: "tenant-001",
        body: "You have a new notification",
        notificationType: "grade_ready",
        notificationPayload: { assignmentTitle: "Quiz", score: "90" },
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(true);
      expect(result.skipped).toBe(false);
      expect(mail.send).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
      expect(sms.sendSms).not.toHaveBeenCalled();
    });
  });

  // ─── email channel ────────────────────────────────────────────────────────

  describe("email channel", () => {
    it("calls MailProvider.send with correct params", async () => {
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-004:email",
        toEmail: "student@example.com",
        subject: "Assignment graded",
        body: "<p>Score: 95/100</p>",
        emailTags: [{ name: "type", value: "grade_ready" }],
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(true);
      expect(mail.send).toHaveBeenCalledWith({
        to: "student@example.com",
        subject: "Assignment graded",
        html: "<p>Score: 95/100</p>",
        tags: [{ name: "type", value: "grade_ready" }],
      });
      expect(result.providerMessageId).toBe("mail-msg-001");
    });

    it("returns error when toEmail is missing", async () => {
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-005:email",
        body: "body",
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe("MISSING_RECIPIENT_EMAIL");
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("catches provider error and returns error string", async () => {
      mail.send.mockRejectedValueOnce(new Error("Resend rate limit exceeded"));
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-006:email",
        toEmail: "s@example.com",
        subject: "test",
        body: "body",
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toContain("rate limit");
    });

    it("AC-76: no API key in result when email succeeds", async () => {
      const job: ChannelSendJob = {
        channel: "email",
        dedupeKey: "notif-007:email",
        toEmail: "s@example.com",
        subject: "test",
        body: "body",
      };
      const result = await adapter.dispatch(job);
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain("RESEND_API_KEY");
      expect(serialised).not.toContain("apiKey");
      expect(serialised).not.toContain("secret");
    });
  });

  // ─── sms channel — DLT gate ───────────────────────────────────────────────

  describe("sms channel — DLT gate (Rule C-3, AC-78)", () => {
    it("rejects SMS without dltTemplateId — no provider call", async () => {
      const job: ChannelSendJob = {
        channel: "sms",
        dedupeKey: "notif-008:sms",
        toPhone: "+919876543210",
        body: "Your assignment has been graded.",
        // dltTemplateId: NOT provided
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe("DLT_TEMPLATE_ID_REQUIRED");
      expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it("proceeds with SMS when dltTemplateId is present", async () => {
      const job: ChannelSendJob = {
        channel: "sms",
        dedupeKey: "notif-009:sms",
        toPhone: "+919876543210",
        body: "Your assignment has been graded.",
        dltTemplateId: "1207162000000001234",
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(true);
      expect(sms.sendSms).toHaveBeenCalledWith({
        phone: "+919876543210",
        body: "Your assignment has been graded.",
        dltTemplateId: "1207162000000001234",
      });
      expect(result.providerMessageId).toBe("sms-msg-001");
    });

    it("returns error when toPhone is missing", async () => {
      const job: ChannelSendJob = {
        channel: "sms",
        dedupeKey: "notif-010:sms",
        body: "body",
        dltTemplateId: "123",
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe("MISSING_RECIPIENT_PHONE");
    });
  });

  // ─── whatsapp channel — DLT gate ──────────────────────────────────────────

  describe("whatsapp channel — DLT gate (Rule C-3, AC-78)", () => {
    it("rejects WhatsApp without dltTemplateId — no provider call", async () => {
      const job: ChannelSendJob = {
        channel: "whatsapp",
        dedupeKey: "notif-011:whatsapp",
        toPhone: "+919876543210",
        body: "Your certificate is ready.",
        whatsappTemplateName: "certificate_ready_notification",
        // dltTemplateId: NOT provided
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe("DLT_TEMPLATE_ID_REQUIRED");
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it("proceeds with WhatsApp when dltTemplateId and templateName are present", async () => {
      const job: ChannelSendJob = {
        channel: "whatsapp",
        dedupeKey: "notif-012:whatsapp",
        toPhone: "+919876543210",
        body: "Your certificate for Full Stack Dev is ready.",
        whatsappTemplateName: "certificate_ready_notification",
        dltTemplateId: "WA_DLT_12345",
        whatsappVariables: ["Full Stack Development", "cert-xyz789"],
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(true);
      expect(whatsapp.sendTemplate).toHaveBeenCalledWith({
        to: "+919876543210",
        templateName: "certificate_ready_notification",
        dltTemplateId: "WA_DLT_12345",
        variables: ["Full Stack Development", "cert-xyz789"],
      });
      expect(result.providerMessageId).toBe("wa-msg-001");
    });

    it("returns error when whatsappTemplateName is missing", async () => {
      const job: ChannelSendJob = {
        channel: "whatsapp",
        dedupeKey: "notif-013:whatsapp",
        toPhone: "+919876543210",
        body: "body",
        dltTemplateId: "WA_DLT_12345",
        // whatsappTemplateName: NOT provided
      };
      const result = await adapter.dispatch(job);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe("MISSING_WHATSAPP_TEMPLATE_NAME");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SyncCampaignSendAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe("SyncCampaignSendAdapter", () => {
  let mail: jest.Mocked<MailProvider>;
  let whatsapp: jest.Mocked<WhatsAppProvider>;
  let sms: jest.Mocked<SmsProvider>;
  let adapter: SyncCampaignSendAdapter;

  beforeEach(() => {
    mail = makeMockMail();
    whatsapp = makeMockWhatsApp();
    sms = makeMockSms();
    adapter = new SyncCampaignSendAdapter(mail, whatsapp, sms);
  });

  // ─── throttle() is a no-op ─────────────────────────────────────────────────

  it("throttle() resolves without delay (no-op sync adapter)", async () => {
    const start = Date.now();
    await adapter.throttle("email");
    await adapter.throttle("sms");
    await adapter.throttle("whatsapp");
    const elapsed = Date.now() - start;
    // Should complete near-instantly (< 50ms)
    expect(elapsed).toBeLessThan(50);
  });

  // ─── Idempotency (AC-27) ─────────────────────────────────────────────────

  describe("idempotency by dedupeKey (AC-27)", () => {
    const baseJob: RecipientSendJob = {
      dedupeKey: "campaign-recipient:cr-001",
      campaignRecipientId: "cr-001",
      campaignId: "camp-001",
      tenantId: "tenant-001",
      channel: "email",
      to: "lead@example.com",
      subject: "Special offer",
      body: "<p>Join our program!</p>",
    };

    it("first send → sent=true, provider called once", async () => {
      const result = await adapter.send(baseJob);
      expect(result.sent).toBe(true);
      expect(result.queued).toBe(false);
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(result.providerMessageId).toBe("mail-msg-001");
    });

    it("second send with same dedupeKey → no-op, provider NOT called again", async () => {
      await adapter.send(baseJob);
      const second = await adapter.send(baseJob);

      expect(second.sent).toBe(false);
      expect(second.queued).toBe(false);
      // Provider called only once across both sends
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it("AC-27: replay across 3 recipients → exactly 3 provider calls total (2 original + 1 replay)", async () => {
      const jobs = [
        { ...baseJob, dedupeKey: "cr:r1", campaignRecipientId: "r1", to: "r1@example.com" },
        { ...baseJob, dedupeKey: "cr:r2", campaignRecipientId: "r2", to: "r2@example.com" },
        { ...baseJob, dedupeKey: "cr:r3", campaignRecipientId: "r3", to: "r3@example.com" },
      ];

      // Send all 3
      for (const job of jobs) {
        await adapter.send(job);
      }

      // Replay r1 (same dedupeKey) → should be a no-op
      await adapter.send(jobs[0]!);

      // Total provider calls = 3 (not 4)
      expect(mail.send).toHaveBeenCalledTimes(3);
    });
  });

  // ─── DLT gate ────────────────────────────────────────────────────────────

  describe("DLT gate (Rule C-3, defense-in-depth)", () => {
    it("SMS without dltTemplateId → error=DLT_TEMPLATE_ID_REQUIRED, no provider call", async () => {
      const job: RecipientSendJob = {
        dedupeKey: "cr:sms-001",
        campaignRecipientId: "cr-sms-001",
        campaignId: "camp-001",
        tenantId: "t1",
        channel: "sms",
        to: "+919876543210",
        body: "Join our batch today!",
        // dltTemplateId: NOT provided
      };
      const result = await adapter.send(job);
      expect(result.sent).toBe(false);
      expect(result.error).toBe("DLT_TEMPLATE_ID_REQUIRED");
      expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it("WhatsApp without dltTemplateId → error=DLT_TEMPLATE_ID_REQUIRED, no provider call", async () => {
      const job: RecipientSendJob = {
        dedupeKey: "cr:wa-001",
        campaignRecipientId: "cr-wa-001",
        campaignId: "camp-001",
        tenantId: "t1",
        channel: "whatsapp",
        to: "+919876543210",
        body: "Hello from stimuliIQ!",
        whatsappTemplateName: "welcome_notification",
        // dltTemplateId: NOT provided
      };
      const result = await adapter.send(job);
      expect(result.sent).toBe(false);
      expect(result.error).toBe("DLT_TEMPLATE_ID_REQUIRED");
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it("email without dltTemplateId → proceeds normally (email not DLT-gated)", async () => {
      const job: RecipientSendJob = {
        dedupeKey: "cr:email-001",
        campaignRecipientId: "cr-email-001",
        campaignId: "camp-001",
        tenantId: "t1",
        channel: "email",
        to: "lead@example.com",
        subject: "Campaign email",
        body: "<p>Hello!</p>",
        // dltTemplateId: intentionally absent for email
      };
      const result = await adapter.send(job);
      expect(result.sent).toBe(true);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Channel routing ──────────────────────────────────────────────────────

  describe("channel routing", () => {
    it("email → MailProvider.send", async () => {
      await adapter.send({
        dedupeKey: "cr:ch-e",
        campaignRecipientId: "r1",
        campaignId: "c1",
        tenantId: "t1",
        channel: "email",
        to: "a@b.com",
        subject: "hi",
        body: "body",
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(sms.sendSms).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it("sms → SmsProvider.sendSms", async () => {
      await adapter.send({
        dedupeKey: "cr:ch-s",
        campaignRecipientId: "r2",
        campaignId: "c1",
        tenantId: "t1",
        channel: "sms",
        to: "+91999",
        body: "text",
        dltTemplateId: "DLT123",
      });
      expect(sms.sendSms).toHaveBeenCalledTimes(1);
      expect(mail.send).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it("whatsapp → WhatsAppProvider.sendTemplate", async () => {
      await adapter.send({
        dedupeKey: "cr:ch-w",
        campaignRecipientId: "r3",
        campaignId: "c1",
        tenantId: "t1",
        channel: "whatsapp",
        to: "+91999",
        body: "Hello",
        dltTemplateId: "WA_DLT_123",
        whatsappTemplateName: "campaign_template",
        whatsappVariables: ["John"],
      });
      expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
      expect(mail.send).not.toHaveBeenCalled();
      expect(sms.sendSms).not.toHaveBeenCalled();
    });
  });

  // ─── Provider errors ──────────────────────────────────────────────────────

  describe("provider error handling", () => {
    it("catches MailProvider error and returns sent=false + error string", async () => {
      mail.send.mockRejectedValueOnce(new Error("Resend 429 Too Many Requests"));
      const result = await adapter.send({
        dedupeKey: "cr:err-e",
        campaignRecipientId: "r-err",
        campaignId: "c1",
        tenantId: "t1",
        channel: "email",
        to: "s@example.com",
        subject: "hi",
        body: "body",
      });
      expect(result.sent).toBe(false);
      expect(result.error).toContain("429");
    });

    it("catches SmsProvider error and returns sent=false", async () => {
      sms.sendSms.mockRejectedValueOnce(new Error("MSG91 auth failed"));
      const result = await adapter.send({
        dedupeKey: "cr:err-s",
        campaignRecipientId: "r-err2",
        campaignId: "c1",
        tenantId: "t1",
        channel: "sms",
        to: "+91999",
        body: "msg",
        dltTemplateId: "DLT123",
      });
      expect(result.sent).toBe(false);
      expect(result.error).toContain("auth failed");
    });
  });

  // ─── AC-76: No secret in result ─────────────────────────────────────────

  it("AC-76: result never contains API key material", async () => {
    const result = await adapter.send({
      dedupeKey: "cr:sec-001",
      campaignRecipientId: "r-sec",
      campaignId: "c1",
      tenantId: "t1",
      channel: "email",
      to: "s@example.com",
      subject: "hi",
      body: "body",
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("RESEND_API_KEY");
    expect(serialised).not.toContain("MSG91_AUTH_KEY");
    expect(serialised).not.toContain("WHATSAPP_ACCESS_TOKEN");
    expect(serialised).not.toContain("secret");
  });
});
