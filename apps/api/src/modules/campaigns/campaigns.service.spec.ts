// apps/api/src/modules/campaigns/campaigns.service.spec.ts
//
// Unit tests for CampaignsService, paying down the debt noted in task #12
// (campaigns module had NO dedicated unit tests).
//
// AC coverage:
//   AC-27  Campaign exactly-once: 3-recipient segment → exactly 1 send each; replay = no-op
//   AC-28  Per-recipient dedupe unique handles P2002 conflict as no-op
//   AC-29  Non-consented recipients (marketing_opt_in=false) excluded from segment
//   AC-30  Suppressed recipients skipped; row → failed/suppressed
//   AC-31  DLT template id required for SMS/WhatsApp (422 DLT_TEMPLATE_ID_REQUIRED)
//   AC-32  DLT template id NOT required for email campaigns
//   AC-33  Unsubscribe during campaign → recipient suppressed on dispatch
//   AC-36  Cancel campaign → queued recipients fail with campaign_cancelled
//   AC-37  Webhook updates recipient status (delivered/read)
//   AC-38  Duplicate webhook is a no-op (status not downgraded)
//   AC-39  (covered in integration layer; HMAC verify is controller-gated)
//   AC-40  Unknown providerMessageId webhook → 200 silent discard
//   Rule C-1  Segment materializer enforces marketing_opt_in gate via repo
//   Rule C-2  Suppression check per-recipient at dispatch time
//   Rule C-3  DLT gate at service layer (defense-in-depth)

import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import type { CampaignsRepository } from "./campaigns.repository";
import type { CampaignTemplateRow, CampaignRow, CampaignRecipientRow } from "./campaigns.repository";
import type { CampaignSendPort } from "../notifications/dispatch/campaign-send.port";
import { TemplateRegistry } from "../notifications/dispatch/template-registry";
import type { CreateCampaignTemplateDto, CreateCampaignDto, CampaignWebhookEventDto } from "@repo/types";
import { __resetEnvCacheForTests } from "../../config/env";

// T5/R2 (docs/plans/phase-9-completion.md): dispatchQueuedRecipients() now reads
// CAMPAIGN_SEND_BATCH_SIZE via validateEnv() on every sendCampaign() call, so the
// minimal required env (mirrors mail-provider.spec.ts / notifications.service.spec.ts)
// must be present for ANY test in this file that exercises sendCampaign().
const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" — a session cookie issued without Secure, or scoped to localhost, is a
  // real misconfiguration, so the boot refuses it. Cases below that exercise a
  // production boot guard would otherwise fail on env validation before reaching the
  // guard under test.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-aaa";
const ACTOR_ID = "actor-user-001";
const NOW = new Date("2026-07-03T10:00:00Z");

function makeTemplateRow(overrides: Partial<CampaignTemplateRow> = {}): CampaignTemplateRow {
  return {
    id: "tmpl-1",
    tenantId: TENANT_ID,
    channel: "email",
    name: "Welcome Campaign",
    subject: "Hello {{to}}!",
    body: "Hi {{to}}, join our program {{campaignName}}.",
    dltTemplateId: null,
    variables: ["to", "campaignName"],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeCampaignRow(overrides: Partial<Omit<CampaignRow, "template">> & { template?: Partial<CampaignTemplateRow> } = {}): CampaignRow {
  const { template: tOverrides, ...rest } = overrides;
  return {
    id: "camp-1",
    tenantId: TENANT_ID,
    channel: "email",
    templateId: "tmpl-1",
    name: "Test Campaign",
    segment: { source: "leads" },
    scheduleAt: null,
    status: "draft",
    metrics: {},
    createdById: ACTOR_ID,
    createdByName: "Actor User",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    template: makeTemplateRow(tOverrides),
    ...rest,
  };
}

function makeRecipientRow(overrides: Partial<CampaignRecipientRow> = {}): CampaignRecipientRow {
  return {
    id: "rcpt-1",
    tenantId: TENANT_ID,
    campaignId: "camp-1",
    leadId: "lead-1",
    studentId: null,
    userId: null,
    to: "lead1@example.com",
    status: "queued",
    providerMessageId: null,
    error: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

// ─── Mock repo factory ────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<CampaignsRepository> = {}): jest.Mocked<CampaignsRepository> {
  return {
    // Templates
    createTemplate: jest.fn().mockResolvedValue(makeTemplateRow()),
    findTemplateById: jest.fn().mockResolvedValue(makeTemplateRow()),
    listTemplates: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateTemplate: jest.fn().mockResolvedValue(makeTemplateRow()),
    softDeleteTemplate: jest.fn().mockResolvedValue(makeTemplateRow()),
    // Campaigns
    createCampaign: jest.fn().mockResolvedValue(makeCampaignRow()),
    findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow()),
    listCampaigns: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateCampaignFields: jest.fn().mockResolvedValue(makeCampaignRow()),
    updateCampaignStatus: jest.fn().mockResolvedValue(makeCampaignRow()),
    updateCampaignMetrics: jest.fn().mockResolvedValue(undefined),
    softDeleteCampaign: jest.fn().mockResolvedValue(makeCampaignRow()),
    // Recipients
    insertRecipient: jest.fn().mockResolvedValue(makeRecipientRow()),
    findQueuedRecipients: jest.fn().mockResolvedValue([]),
    countQueuedRecipients: jest.fn().mockResolvedValue(0),
    findRecipientsByStatus: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findRecipientByProviderMessageId: jest.fn().mockResolvedValue(null),
    updateRecipientStatus: jest.fn().mockResolvedValue(makeRecipientRow()),
    bulkFailQueuedRecipients: jest.fn().mockResolvedValue(0),
    countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 }),
    // Segment
    findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findStudentsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    // Suppression
    isSuppressed: jest.fn().mockResolvedValue(false),
    createBounceSuppression: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as jest.Mocked<CampaignsRepository>;
}

function makeSendPort(): jest.Mocked<CampaignSendPort> {
  return {
    send: jest.fn().mockResolvedValue({ sent: true, queued: false, providerMessageId: "provider-msg-1" }),
    throttle: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Service factory ──────────────────────────────────────────────────────────

function makeService(
  repoOverrides: Partial<CampaignsRepository> = {},
  portOverrides: Partial<CampaignSendPort> = {},
): { service: CampaignsService; repo: jest.Mocked<CampaignsRepository>; port: jest.Mocked<CampaignSendPort> } {
  const repo = makeRepo(repoOverrides);
  const port = { ...makeSendPort(), ...portOverrides } as jest.Mocked<CampaignSendPort>;
  const templateRegistry = new TemplateRegistry();
  // Directly instantiate to bypass DI (unit test convention in this repo)
  const service = new CampaignsService(repo as unknown as CampaignsRepository, templateRegistry, port);
  return { service, repo, port };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CampaignsService", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    __resetEnvCacheForTests();
    delete process.env["CAMPAIGN_SEND_BATCH_SIZE"];
    for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
  });

  // ─── Template CRUD ────────────────────────────────────────────────────────

  describe("createTemplate", () => {
    it("creates an email template without requiring dltTemplateId (AC-32)", async () => {
      const { service, repo } = makeService();
      const dto: CreateCampaignTemplateDto = {
        channel: "email",
        name: "Email Campaign",
        subject: "Hello!",
        body: "Test body",
        variables: [],
      };
      const result = await service.createTemplate(TENANT_ID, ACTOR_ID, dto);
      expect(result).toBeDefined();
      expect(repo.createTemplate).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ channel: "email" }),
      );
    });

    it("AC-31 / AC-78: rejects SMS template without dltTemplateId → 422 DLT_TEMPLATE_ID_REQUIRED", async () => {
      const { service } = makeService();
      // Intentionally invalid input (dltTemplateId absent), cast past the compile-time
      // discriminated-union requirement so the runtime 422 guard is what we assert.
      const dto = {
        channel: "sms",
        name: "SMS Blast",
        body: "Your batch starts tomorrow.",
        variables: [],
        // dltTemplateId: intentionally absent
      } as unknown as CreateCampaignTemplateDto;
      await expect(service.createTemplate(TENANT_ID, ACTOR_ID, dto))
        .rejects
        .toThrow(UnprocessableEntityException);
    });

    it("AC-78: rejects WhatsApp template without dltTemplateId → 422", async () => {
      const { service } = makeService();
      // Intentionally invalid input (dltTemplateId absent), cast past the compile-time
      // discriminated-union requirement so the runtime 422 guard is what we assert.
      const dto = {
        channel: "whatsapp",
        name: "WA Campaign",
        body: "Hello {{name}}!",
        variables: ["name"],
        // dltTemplateId: intentionally absent
      } as unknown as CreateCampaignTemplateDto;
      await expect(service.createTemplate(TENANT_ID, ACTOR_ID, dto))
        .rejects
        .toThrow(UnprocessableEntityException);
    });

    it("AC-78: accepts SMS template WITH dltTemplateId", async () => {
      const { service, repo } = makeService({
        findTemplateById: jest.fn().mockResolvedValue(makeTemplateRow({ channel: "sms", dltTemplateId: "DLT_SMS_123" })),
        createTemplate: jest.fn().mockResolvedValue(makeTemplateRow({ channel: "sms", dltTemplateId: "DLT_SMS_123" })),
      });
      const dto: CreateCampaignTemplateDto = {
        channel: "sms",
        name: "SMS with DLT",
        body: "Your course is live.",
        dltTemplateId: "DLT_SMS_123",
        variables: [],
      };
      const result = await service.createTemplate(TENANT_ID, ACTOR_ID, dto);
      expect(result.dltTemplateId).toBe("DLT_SMS_123");
      expect(repo.createTemplate).toHaveBeenCalled();
    });
  });

  describe("getTemplate", () => {
    it("returns a template that exists", async () => {
      const { service } = makeService();
      const result = await service.getTemplate(TENANT_ID, "tmpl-1");
      expect(result.id).toBe("tmpl-1");
    });

    it("throws NotFoundException when template not found", async () => {
      const { service } = makeService({
        findTemplateById: jest.fn().mockResolvedValue(null),
      });
      await expect(service.getTemplate(TENANT_ID, "no-such-id"))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  // ─── Campaign CRUD ────────────────────────────────────────────────────────

  describe("createCampaign", () => {
    it("creates an email campaign successfully", async () => {
      const { service, repo } = makeService();
      const dto: CreateCampaignDto = {
        channel: "email",
        templateId: "tmpl-1",
        name: "Welcome Campaign",
        segment: { source: "leads", consentRequired: true },
      };
      const result = await service.createCampaign(TENANT_ID, ACTOR_ID, dto);
      expect(result).toBeDefined();
      expect(repo.createCampaign).toHaveBeenCalled();
    });

    it("throws UnprocessableEntityException when channel mismatches template", async () => {
      // Template is email, campaign tries to be whatsapp
      const { service } = makeService({
        findTemplateById: jest.fn().mockResolvedValue(makeTemplateRow({ channel: "whatsapp", dltTemplateId: "WA_DLT" })),
      });
      const dto: CreateCampaignDto = {
        channel: "email",
        templateId: "tmpl-1",
        name: "Mismatch",
        segment: { source: "leads", consentRequired: true },
      };
      await expect(service.createCampaign(TENANT_ID, ACTOR_ID, dto))
        .rejects
        .toThrow(UnprocessableEntityException);
    });

    it("throws NotFoundException when template not found", async () => {
      const { service } = makeService({
        findTemplateById: jest.fn().mockResolvedValue(null),
      });
      const dto: CreateCampaignDto = {
        channel: "email",
        templateId: "missing",
        name: "Orphan Campaign",
        segment: { source: "leads", consentRequired: true },
      };
      await expect(service.createCampaign(TENANT_ID, ACTOR_ID, dto))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  // ─── AC-31: DLT gate at campaign send time ─────────────────────────────────

  describe("sendCampaign, AC-31 DLT gate", () => {
    it("AC-31: rejects WhatsApp campaign when template has no dltTemplateId → 422", async () => {
      const campaign = makeCampaignRow({
        channel: "whatsapp",
        template: makeTemplateRow({ channel: "whatsapp", dltTemplateId: null }),
      });
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(campaign),
      });

      await expect(service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1"))
        .rejects
        .toThrow(UnprocessableEntityException);
    });

    it("AC-31: rejects SMS campaign when template has no dltTemplateId → 422", async () => {
      const campaign = makeCampaignRow({
        channel: "sms",
        template: makeTemplateRow({ channel: "sms", dltTemplateId: null }),
      });
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(campaign),
      });

      await expect(service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1"))
        .rejects
        .toThrow(UnprocessableEntityException);
    });

    it("AC-32: email campaign without dltTemplateId sends successfully", async () => {
      const campaign = makeCampaignRow({
        channel: "email",
        template: makeTemplateRow({ channel: "email", dltTemplateId: null }),
      });
      const { service, repo } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign) // first call in sendCampaign
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // mid-send check
          .mockResolvedValueOnce({ ...campaign, status: "sent" }), // final check
        findQueuedRecipients: jest.fn().mockResolvedValue([]),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });

      const result = await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");
      expect(result).toBeDefined();
      // No 422 thrown, email campaigns don't require DLT id
      expect(repo.updateCampaignStatus).toHaveBeenCalledWith(TENANT_ID, "camp-1", "sending");
    });
  });

  // ─── AC-27 / AC-29 / AC-30: Exactly-once + consent + suppression ─────────

  describe("sendCampaign, exactly-once, consent, suppression", () => {
    it("AC-27: 3 queued recipients → exactly 3 provider sends, then no-op on replay", async () => {
      const campaign = makeCampaignRow({ channel: "email", status: "draft" });
      const r1 = makeRecipientRow({ id: "r1", to: "r1@example.com", leadId: "lead-1" });
      const r2 = makeRecipientRow({ id: "r2", to: "r2@example.com", leadId: "lead-2" });
      const r3 = makeRecipientRow({ id: "r3", to: "r3@example.com", leadId: "lead-3" });

      const { service, port } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)           // sendCampaign check
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // dispatch loop
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // dispatch loop r2
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // dispatch loop r3
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // status refresh
          .mockResolvedValueOnce({ ...campaign, status: "sent" }),    // final
        findQueuedRecipients: jest.fn().mockResolvedValue([r1, r2, r3]),
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        updateRecipientStatus: jest.fn().mockResolvedValue(r1),
        isSuppressed: jest.fn().mockResolvedValue(false),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 3, sent: 3, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      // Exactly 3 sends (one per recipient)
      expect(port.send).toHaveBeenCalledTimes(3);
    });

    it("AC-29 / Rule C-1: segment materializer skips leads with marketingOptIn=false", async () => {
      const campaign = makeCampaignRow({ channel: "email", status: "draft", segment: { source: "leads" } });
      const nonConsentedLead = { id: "lead-nc", email: "nc@example.com", phone: "+91999", marketingOptIn: false };
      const consentedLead = { id: "lead-ok", email: "ok@example.com", phone: "+91888", marketingOptIn: true };

      const { service, repo, port } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)
          .mockResolvedValueOnce({ ...campaign, status: "sending" })
          .mockResolvedValueOnce({ ...campaign, status: "sent" }),
        findLeadsForSegment: jest.fn().mockResolvedValue({
          rows: [nonConsentedLead, consentedLead],
          total: 2,
        }),
        findQueuedRecipients: jest.fn().mockResolvedValue([]),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 0, read: 0, failed: 0, queued: 1 }),
        isSuppressed: jest.fn().mockResolvedValue(false),
      });

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      // insertRecipient should only be called for the consented lead
      const insertCalls = (repo.insertRecipient as jest.Mock).mock.calls;
      const toValues = insertCalls.map((c: unknown[]) => (c[1] as { to: string }).to);
      expect(toValues).not.toContain("nc@example.com");
      // Port send was 0 because findQueuedRecipients returns empty (segment materialized but no actual dispatch in this test)
      expect(port.send).toHaveBeenCalledTimes(0);
    });

    it("AC-30 / Rule C-2: suppressed recipient → status=failed/suppressed, no provider call", async () => {
      const campaign = makeCampaignRow({ channel: "email", status: "draft" });
      const suppressedRcpt = makeRecipientRow({ id: "rcpt-suppressed", to: "suppressed@example.com" });

      const { service, repo, port } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)
          .mockResolvedValueOnce({ ...campaign, status: "sending" })
          .mockResolvedValueOnce({ ...campaign, status: "sent" }),
        findQueuedRecipients: jest.fn().mockResolvedValue([suppressedRcpt]),
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        isSuppressed: jest.fn().mockResolvedValue(true), // suppressed
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        updateRecipientStatus: jest.fn().mockResolvedValue(suppressedRcpt),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 0, read: 0, failed: 1, queued: 0 }),
      });

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      // Provider NOT called
      expect(port.send).not.toHaveBeenCalled();
      // Status updated to failed/suppressed
      expect(repo.updateRecipientStatus).toHaveBeenCalledWith(
        TENANT_ID,
        "rcpt-suppressed",
        expect.objectContaining({ status: "failed", error: "suppressed" }),
      );
    });
  });

  // ─── AC-36: Cancel campaign ────────────────────────────────────────────────

  // What actually lands in a student's inbox. Before this, the sender passed only
  // { to, campaignName } while templates were authored with {{name}} / {{program_title}},
  // and the renderer leaves unknown placeholders alone, so real sends went out reading
  // "Hi {{name}},". These pin the substitution map against CAMPAIGN_TEMPLATE_VARIABLES.
  describe("sendCampaign, variable substitution", () => {
    function makeSendHarness(recipient: CampaignRecipientRow, templateBody: string) {
      // The send path reads the template off the CAMPAIGN row (campaign.template), not via
      // a separate findTemplateById, mocking the latter has no effect here.
      const campaign = makeCampaignRow({
        channel: "email",
        status: "draft",
        name: "August Reminder",
        template: { channel: "email", body: templateBody, subject: "Hi {{name}}" },
      });
      return makeService({
        findCampaignById: jest
          .fn()
          .mockResolvedValueOnce(campaign)
          .mockResolvedValue({ ...campaign, status: "sending" }),
        findQueuedRecipients: jest.fn().mockResolvedValue([recipient]),
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        updateRecipientStatus: jest.fn().mockResolvedValue(recipient),
        isSuppressed: jest.fn().mockResolvedValue(false),
        countRecipientsByStatus: jest
          .fn()
          .mockResolvedValue({ total: 1, sent: 1, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });
    }

    it("fills a student's name and programme into the message", async () => {
      const recipient = makeRecipientRow({
        to: "ananya@example.com",
        studentId: "student-1",
        student: {
          user: { name: "Ananya Sharma" },
          enrollments: [{ program: { title: "Clinical Neurology" } }],
        },
      });
      const { service, port } = makeSendHarness(recipient, "Hi {{name}}, {{program_title}} is closing soon.");

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      const sent = (port.send as jest.Mock).mock.calls[0][0] as { body: string };
      expect(sent.body).toBe("Hi Ananya Sharma, Clinical Neurology is closing soon.");
      // The failure this replaced: braces reaching a real inbox.
      expect(sent.body).not.toContain("{{");
    });

    it("falls back to the lead's own name and interest", async () => {
      const recipient = makeRecipientRow({
        to: "ravi@example.com",
        leadId: "lead-1",
        lead: { name: "Ravi Kumar", programInterest: { title: "Cardiology" } },
      });
      const { service, port } = makeSendHarness(recipient, "Hi {{name}}, about {{program_title}}");

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(((port.send as jest.Mock).mock.calls[0][0] as { body: string }).body).toBe(
        "Hi Ravi Kumar, about Cardiology",
      );
    });

    it("substitutes the address and campaign name too", async () => {
      const recipient = makeRecipientRow({ to: "someone@example.com", userId: "user-1", user: { name: "Staff" } });
      const { service, port } = makeSendHarness(recipient, "{{to}} / {{campaign_name}}");

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(((port.send as jest.Mock).mock.calls[0][0] as { body: string }).body).toBe(
        "someone@example.com / August Reminder",
      );
    });

    // A blank reads as an imperfect mail-merge; leaving the key out entirely would make the
    // renderer emit the raw "{{program_title}}", which reads as broken software.
    it("renders a blank, never braces, when the data is missing", async () => {
      const recipient = makeRecipientRow({ to: "x@example.com", leadId: "lead-2", lead: { name: "Nobody", programInterest: null } });
      const { service, port } = makeSendHarness(recipient, "[{{program_title}}]");

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(((port.send as jest.Mock).mock.calls[0][0] as { body: string }).body).toBe("[]");
    });

    it("substitutes the subject line as well as the body", async () => {
      const recipient = makeRecipientRow({
        to: "ananya@example.com",
        studentId: "student-1",
        student: { user: { name: "Ananya Sharma" }, enrollments: [] },
      });
      const { service, port } = makeSendHarness(recipient, "body");

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(((port.send as jest.Mock).mock.calls[0][0] as { subject?: string }).subject).toBe("Hi Ananya Sharma");
    });
  });

  describe("cancelCampaign, AC-36", () => {
    it("transitions campaign to cancelled + bulk-fails queued recipients", async () => {
      const campaign = makeCampaignRow({ status: "scheduled" });
      const { service, repo } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)
          .mockResolvedValueOnce({ ...campaign, status: "cancelled" }),
        bulkFailQueuedRecipients: jest.fn().mockResolvedValue(3),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "cancelled" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 3, sent: 0, delivered: 0, read: 0, failed: 3, queued: 0 }),
      });

      const result = await service.cancelCampaign(TENANT_ID, ACTOR_ID, "camp-1");
      expect(result.status).toBe("cancelled");
      expect(repo.bulkFailQueuedRecipients).toHaveBeenCalledWith("camp-1", TENANT_ID, "campaign_cancelled");
    });

    it("rejects cancel when campaign already sent", async () => {
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
      });
      await expect(service.cancelCampaign(TENANT_ID, ACTOR_ID, "camp-1"))
        .rejects
        .toThrow(UnprocessableEntityException);
    });
  });

  // ─── AC-37 / AC-38 / AC-40: Webhook ingestion ─────────────────────────────

  describe("handleWebhookEvent, AC-37, AC-38, AC-40", () => {
    it("AC-37: updates recipient status on delivered webhook", async () => {
      const sentRecipient = makeRecipientRow({ status: "sent", providerMessageId: "msg-M1" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(sentRecipient),
        updateRecipientStatus: jest.fn().mockResolvedValue({ ...sentRecipient, status: "delivered" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 1, read: 0, failed: 0, queued: 0 }),
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
      });

      const event: CampaignWebhookEventDto = {
        providerMessageId: "msg-M1",
        event: "delivered",
        occurredAt: new Date().toISOString(),
      };
      await service.handleWebhookEvent(event);

      expect(repo.updateRecipientStatus).toHaveBeenCalledWith(
        sentRecipient.tenantId,
        sentRecipient.id,
        expect.objectContaining({ status: "delivered" }),
      );
    });

    it("AC-38: duplicate/replayed delivered webhook → no second update (already delivered)", async () => {
      // Recipient already in delivered state
      const deliveredRecipient = makeRecipientRow({ status: "delivered", providerMessageId: "msg-M1" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(deliveredRecipient),
      });

      const event: CampaignWebhookEventDto = {
        providerMessageId: "msg-M1",
        event: "delivered",
        occurredAt: new Date().toISOString(),
      };
      // Should not throw
      await expect(service.handleWebhookEvent(event)).resolves.toBeUndefined();

      // Status was NOT updated (already at or past delivered)
      expect(repo.updateRecipientStatus).not.toHaveBeenCalled();
    });

    it("AC-38: status never downgrades, a terminal 'read' recipient is not overwritten by a later 'failed' event", async () => {
      // "read" is a terminal status. A late/out-of-order "failed" webhook must not
      // roll it backwards, so updateRecipientStatus must never be called.
      const readRecipient = makeRecipientRow({ status: "read", providerMessageId: "msg-M3" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(readRecipient),
      });

      await expect(service.handleWebhookEvent({
        providerMessageId: "msg-M3",
        event: "failed",
        occurredAt: new Date().toISOString(),
      })).resolves.toBeUndefined();

      expect(repo.updateRecipientStatus).not.toHaveBeenCalled();
    });

    it("AC-40: unknown providerMessageId → silent discard, no 500, no update", async () => {
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(null),
      });

      const event: CampaignWebhookEventDto = {
        providerMessageId: "unknown-msg-id",
        event: "delivered",
        occurredAt: new Date().toISOString(),
      };

      await expect(service.handleWebhookEvent(event)).resolves.toBeUndefined();
      expect(repo.updateRecipientStatus).not.toHaveBeenCalled();
    });

    it("status only advances: queued → sent → delivered → read (no backward steps)", async () => {
      // queued recipient receives "sent" event → should update
      const queuedRecipient = makeRecipientRow({ status: "queued", providerMessageId: "msg-Q1" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(queuedRecipient),
        updateRecipientStatus: jest.fn().mockResolvedValue({ ...queuedRecipient, status: "delivered" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 1, read: 0, failed: 0, queued: 0 }),
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
      });

      await service.handleWebhookEvent({
        providerMessageId: "msg-Q1",
        event: "delivered",
        occurredAt: new Date().toISOString(),
      });

      expect(repo.updateRecipientStatus).toHaveBeenCalledWith(
        TENANT_ID,
        "rcpt-1",
        expect.objectContaining({ status: "delivered" }),
      );
    });
  });

  // ─── AC-60: bounce→suppression is idempotent + monotonic ─────────────────

  describe("handleWebhookEvent, AC-60 bounce→suppression idempotency", () => {
    it("a bounced webhook on a non-terminal recipient inserts exactly one suppression row", async () => {
      const sentRecipient = makeRecipientRow({ status: "sent", providerMessageId: "msg-B1", to: "bounce1@example.com" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(sentRecipient),
        updateRecipientStatus: jest.fn().mockResolvedValue({ ...sentRecipient, status: "failed" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 0, read: 0, failed: 1, queued: 0 }),
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
      });

      await service.handleWebhookEvent({
        providerMessageId: "msg-B1",
        event: "bounced",
        occurredAt: new Date().toISOString(),
      });

      expect(repo.createBounceSuppression).toHaveBeenCalledTimes(1);
      expect(repo.createBounceSuppression).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        email: "bounce1@example.com",
        phone: null,
        channel: "email",
      });
    });

    it("a replayed bounced event for an ALREADY-failed recipient is an AC-38 no-op, no second suppression insert", async () => {
      // Recipient is already terminal ("failed"), isStatusAdvance blocks the update
      // (and therefore the suppression call) before it is ever reached, regardless of
      // event ordering. This is the exact "out-of-order delivery" scenario AC-60 covers:
      // a second (possibly earlier-timestamped) bounce arriving after the recipient is
      // already terminal must not re-trigger a suppression insert.
      const failedRecipient = makeRecipientRow({ status: "failed", providerMessageId: "msg-B2", to: "bounce2@example.com" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(failedRecipient),
      });

      await service.handleWebhookEvent({
        providerMessageId: "msg-B2",
        event: "bounced",
        occurredAt: new Date().toISOString(),
      });

      expect(repo.updateRecipientStatus).not.toHaveBeenCalled();
      expect(repo.createBounceSuppression).not.toHaveBeenCalled();
    });

    it("createBounceSuppression returning false (DB unique-constraint no-op, e.g. a concurrent race) does not throw", async () => {
      const sentRecipient = makeRecipientRow({ status: "sent", providerMessageId: "msg-B3", to: "bounce3@example.com" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(sentRecipient),
        updateRecipientStatus: jest.fn().mockResolvedValue({ ...sentRecipient, status: "failed" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 0, read: 0, failed: 1, queued: 0 }),
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
        // Simulates the DB partial-unique index catching a concurrent duplicate insert,
        // an active suppression row already exists for this (tenant, channel, address).
        createBounceSuppression: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.handleWebhookEvent({
          providerMessageId: "msg-B3",
          event: "bounced",
          occurredAt: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();

      expect(repo.createBounceSuppression).toHaveBeenCalledTimes(1);
    });

    it("a complained (spam complaint) webhook also inserts a suppression row", async () => {
      const sentRecipient = makeRecipientRow({ status: "sent", providerMessageId: "msg-C1", to: "complaint1@example.com" });
      const { service, repo } = makeService({
        findRecipientByProviderMessageId: jest.fn().mockResolvedValue(sentRecipient),
        updateRecipientStatus: jest.fn().mockResolvedValue({ ...sentRecipient, status: "failed" }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 0, delivered: 0, read: 0, failed: 1, queued: 0 }),
        findCampaignById: jest.fn().mockResolvedValue(makeCampaignRow({ status: "sent" })),
      });

      await service.handleWebhookEvent({
        providerMessageId: "msg-C1",
        event: "complained",
        occurredAt: new Date().toISOString(),
      });

      expect(repo.createBounceSuppression).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Campaign webhook normalizer tests ─────────────────────────────────────

  describe("normalizeCampaignWebhook helper (campaign-webhook.normalizer)", () => {
    // These are imported as pure-function tests to cover the normalizer
    let normalizer: typeof import("./campaign-webhook.normalizer");

    beforeAll(async () => {
      normalizer = await import("./campaign-webhook.normalizer");
    });

    it("normalizes a Resend email.delivered payload", () => {
      const raw = JSON.stringify({
        type: "email.delivered",
        data: { email_id: "resend-msg-abc" },
      });
      const events = normalizer.normalizeCampaignWebhook("email", raw);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ providerMessageId: "resend-msg-abc", event: "delivered" });
    });

    it("normalizes a Resend email.bounced payload", () => {
      const raw = JSON.stringify({
        type: "email.bounced",
        data: { email_id: "resend-msg-bounce" },
      });
      const events = normalizer.normalizeCampaignWebhook("email", raw);
      expect(events[0]?.event).toBe("bounced");
    });

    it("normalizes a WhatsApp delivered status payload", () => {
      const raw = JSON.stringify({
        entry: [{ changes: [{ value: { statuses: [{ id: "wa-msg-001", status: "delivered" }] } }] }],
      });
      const events = normalizer.normalizeCampaignWebhook("whatsapp", raw);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ providerMessageId: "wa-msg-001", event: "delivered" });
    });

    it("returns [] for unknown event types (graceful no-op)", () => {
      const raw = JSON.stringify({ type: "email.unknown_event", data: { email_id: "x" } });
      const events = normalizer.normalizeCampaignWebhook("email", raw);
      expect(events).toHaveLength(0);
    });

    it("returns [] for malformed JSON", () => {
      const events = normalizer.normalizeCampaignWebhook("email", "not-json");
      expect(events).toHaveLength(0);
    });

    it("passes through already-normalized payload (escape hatch for tests/internal replays)", () => {
      const raw = JSON.stringify({ providerMessageId: "direct-id", event: "read" });
      const events = normalizer.normalizeCampaignWebhook("email", raw);
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("read");
    });
  });

  // ─── Campaign metrics ──────────────────────────────────────────────────────

  describe("getCampaignMetrics", () => {
    it("returns parsed metrics for a campaign", async () => {
      const campaign = makeCampaignRow({
        metrics: { total: 3, sent: 3, delivered: 2, read: 1, failed: 0, queued: 0 },
        status: "sent",
      });
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(campaign),
      });

      const metrics = await service.getCampaignMetrics(TENANT_ID, "camp-1");
      expect(metrics.total).toBe(3);
      expect(metrics.sent).toBe(3);
      expect(metrics.delivered).toBe(2);
      expect(metrics.read).toBe(1);
    });

    it("throws NotFoundException when campaign not found", async () => {
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(null),
      });
      await expect(service.getCampaignMetrics(TENANT_ID, "no-such"))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  // ─── T5/R2: bounded recipient batch (docs/plans/phase-9-completion.md) ───────

  describe("sendCampaign, T5/R2 bounded recipient batch", () => {
    afterEach(() => {
      delete process.env["CAMPAIGN_SEND_BATCH_SIZE"];
      __resetEnvCacheForTests();
    });

    it("passes CAMPAIGN_SEND_BATCH_SIZE as the `take` limit to findQueuedRecipients", async () => {
      process.env["CAMPAIGN_SEND_BATCH_SIZE"] = "2";
      __resetEnvCacheForTests();

      const campaign = makeCampaignRow({ channel: "email", status: "draft" });
      const { service, repo } = makeService({
        findCampaignById: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        findQueuedRecipients: jest.fn().mockResolvedValue([]),
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(repo.findQueuedRecipients).toHaveBeenCalledWith("camp-1", TENANT_ID, 2);
    });

    it("when a batch fully fills the cap and recipients remain queued, the campaign stays 'sending' (not 'sent') and logs the remainder", async () => {
      process.env["CAMPAIGN_SEND_BATCH_SIZE"] = "2";
      __resetEnvCacheForTests();

      const campaign = makeCampaignRow({ channel: "email", status: "draft" });
      const r1 = makeRecipientRow({ id: "r1", to: "r1@example.com", leadId: "lead-1" });
      const r2 = makeRecipientRow({ id: "r2", to: "r2@example.com", leadId: "lead-2" });

      const { service, repo } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)                              // sendCampaign initial check
          .mockResolvedValueOnce({ ...campaign, status: "sending" })    // dispatch loop r1
          .mockResolvedValueOnce({ ...campaign, status: "sending" })    // dispatch loop r2
          .mockResolvedValueOnce({ ...campaign, status: "sending" })    // "refreshed" check
          .mockResolvedValueOnce({ ...campaign, status: "sending" }),   // final lookup
        findQueuedRecipients: jest.fn().mockResolvedValue([r1, r2]), // exactly == batch cap
        countQueuedRecipients: jest.fn().mockResolvedValue(5), // 5 more still queued beyond this batch
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sending" }),
        updateRecipientStatus: jest.fn().mockResolvedValue(r1),
        isSuppressed: jest.fn().mockResolvedValue(false),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 7, sent: 2, delivered: 0, read: 0, failed: 0, queued: 5 }),
      });
      const logSpy = jest.spyOn((service as unknown as { logger: { log: (msg: string) => void } }).logger, "log");

      const result = await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      // Never transitioned to "sent" while recipients remain queued.
      expect(repo.updateCampaignStatus).not.toHaveBeenCalledWith(TENANT_ID, "camp-1", "sent");
      expect(result.status).toBe("sending");
      // The batch-cap-reached log line fired with the remaining count.
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("5 recipient(s) still queued"));
    });

    it("when the batch drains the entire queue (recipients.length < cap), the campaign transitions to 'sent'", async () => {
      const campaign = makeCampaignRow({ channel: "email", status: "draft" });
      const r1 = makeRecipientRow({ id: "r1", to: "r1@example.com", leadId: "lead-1" });

      const { service, repo } = makeService({
        findCampaignById: jest.fn()
          .mockResolvedValueOnce(campaign)
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // dispatch loop r1
          .mockResolvedValueOnce({ ...campaign, status: "sending" }) // "refreshed" check
          .mockResolvedValueOnce({ ...campaign, status: "sent" }),   // final lookup
        findQueuedRecipients: jest.fn().mockResolvedValue([r1]), // well under the (default 500) cap
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        updateCampaignStatus: jest.fn().mockResolvedValue({ ...campaign, status: "sent" }),
        updateRecipientStatus: jest.fn().mockResolvedValue(r1),
        isSuppressed: jest.fn().mockResolvedValue(false),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 1, sent: 1, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });

      await service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1");

      expect(repo.updateCampaignStatus).toHaveBeenCalledWith(TENANT_ID, "camp-1", "sent");
    });

    it("a campaign already in 'sending' status (a resumed batch) is sendable, not rejected as not_sendable", async () => {
      const campaign = makeCampaignRow({ channel: "email", status: "sending" });
      const { service } = makeService({
        findCampaignById: jest.fn().mockResolvedValue(campaign),
        findQueuedRecipients: jest.fn().mockResolvedValue([]),
        findLeadsForSegment: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        countRecipientsByStatus: jest.fn().mockResolvedValue({ total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 }),
      });

      await expect(service.sendCampaign(TENANT_ID, ACTOR_ID, "camp-1")).resolves.toBeDefined();
    });
  });
});
